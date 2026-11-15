import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ServerConfig } from "./config";
import type { ToolDeps } from "./tools";
import { leashVaultAbi } from "./abi";

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export function arcChain(cfg: Pick<ServerConfig, "ARC_CHAIN_ID" | "ARC_RPC_URL">) {
  return defineChain({
    id: cfg.ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.ARC_RPC_URL] } },
    blockExplorers: { default: { name: "Arcscan", url: "https://explorer.testnet.arc.io" } },
    testnet: true,
  });
}

/** Viem adapter for LeashVault, signing as the agent key. */
export function createVaultAdapter(cfg: ServerConfig): ToolDeps["vault"] {
  const chain = arcChain(cfg);
  const transport = http(cfg.ARC_RPC_URL);
  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(cfg.AGENT_PRIVATE_KEY as Hex);
  const walletClient = createWalletClient({ chain, transport, account });
  const vault = { address: cfg.VAULT_ADDRESS as Address, abi: leashVaultAbi } as const;

  async function send(
    functionName: "spend" | "spendWithApproval",
    args: readonly [string, boolean, bigint] | readonly [string, boolean, bigint, bigint, Hex],
  ) {
    // Simulate first so a contract revert surfaces as a decoded error, not a burned transaction.
    const { request } = await publicClient.simulateContract({
      ...vault,
      functionName,
      args,
      account,
    } as Parameters<typeof publicClient.simulateContract>[0]);
    const txHash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`Vault transaction reverted: ${txHash}`);
    const [event] = parseEventLogs({ abi: leashVaultAbi, eventName: "PositionAuthorized", logs: receipt.logs });
    if (!event) throw new Error(`No PositionAuthorized event in ${txHash}`);
    return { positionId: event.args.positionId, txHash };
  }

  return {
    address: vault.address,
    chainId: chain.id,
    async state() {
      const [limits, remainingToday, paused, approvalNonce, balance] = await Promise.all([
        publicClient.readContract({ ...vault, functionName: "limits" }),
        publicClient.readContract({ ...vault, functionName: "remainingDailyBudget" }),
        publicClient.readContract({ ...vault, functionName: "paused" }),
        publicClient.readContract({ ...vault, functionName: "approvalNonce" }),
        publicClient.readContract({
          address: cfg.USDC_ADDRESS as Address,
          abi: erc20BalanceAbi,
          functionName: "balanceOf",
          args: [vault.address],
        }),
      ]);
      const [autoApproveMax, perTradeCap, dailyBudget] = limits;
      return {
        limits: { autoApproveMax, perTradeCap, dailyBudget },
        remainingToday,
        paused,
        approvalNonce,
        balance,
      };
    },
    spend: (market, outcomeYes, amount) => send("spend", [market, outcomeYes, amount]),
    spendWithApproval: (market, outcomeYes, amount, deadline, signature) =>
      send("spendWithApproval", [market, outcomeYes, amount, deadline, signature as Hex]),
  };
}
