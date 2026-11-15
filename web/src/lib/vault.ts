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

export const leashVaultAbi = [
  {
    type: "function",
    name: "limits",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "autoApproveMax", type: "uint256" },
      { name: "perTradeCap", type: "uint256" },
      { name: "dailyBudget", type: "uint256" },
    ],
  },
  { type: "function", name: "remainingDailyBudget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "approvalNonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "spend",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "string" },
      { name: "outcomeYes", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "spendWithApproval",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "string" },
      { name: "outcomeYes", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "ownerSig", type: "bytes" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  {
    type: "event",
    name: "PositionAuthorized",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "broker", type: "address", indexed: true },
      { name: "market", type: "string", indexed: false },
      { name: "outcomeYes", type: "bool", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "ownerApproved", type: "bool", indexed: false },
    ],
  },
  { type: "error", name: "NotAgent", inputs: [] },
  { type: "error", name: "VaultPaused", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "InvalidOwnerSignature", inputs: [] },
  { type: "error", name: "ApprovalExpired", inputs: [{ name: "deadline", type: "uint256" }] },
  { type: "error", name: "NeedsOwnerApproval", inputs: [{ name: "amount", type: "uint256" }, { name: "autoApproveMax", type: "uint256" }] },
  { type: "error", name: "OverPerTradeCap", inputs: [{ name: "amount", type: "uint256" }, { name: "perTradeCap", type: "uint256" }] },
  { type: "error", name: "OverDailyBudget", inputs: [{ name: "amount", type: "uint256" }, { name: "remaining", type: "uint256" }] },
] as const;

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
