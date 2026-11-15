"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { approvalTypedData } from "../approval";
import { leashVaultAbi } from "../abi";

/** Public Arc testnet facts the browser needs to add the network to MetaMask. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

/** Approval request exactly as `place-bet` returns it (bigints as decimal strings). */
export type ApprovalRequestJson = {
  vault: Address;
  chainId: number;
  market: string;
  outcomeYes: boolean;
  amount: string;
  nonce: string;
  deadline: string;
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function provider(): EIP1193Provider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet found. Install MetaMask to approve larger bets.");
  }
  return window.ethereum;
}

async function ensureArc(eth: EIP1193Provider) {
  const hexId = `0x${arcTestnet.id.toString(16)}` as const;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: [...arcTestnet.rpcUrls.default.http],
          blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
        },
      ],
    });
  }
}

/**
 * Asks MetaMask for the owner's EIP-712 signature over one specific bet.
 * Checks the connected account is the vault owner first, so a wrong account fails
 * with a clear message instead of an onchain InvalidOwnerSignature.
 */
export async function signOwnerApproval(req: ApprovalRequestJson): Promise<Hex> {
  const eth = provider();
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  if (!account) throw new Error("MetaMask did not share an account.");
  await ensureArc(eth);

  const reader = createPublicClient({ chain: arcTestnet, transport: http() });
  const owner = await reader.readContract({ address: req.vault, abi: leashVaultAbi, functionName: "owner" });
  if (getAddress(owner) !== getAddress(account)) {
    throw new Error(`Switch MetaMask to the vault owner ${owner.slice(0, 6)}…${owner.slice(-4)} to approve.`);
  }

  const wallet = createWalletClient({ account: getAddress(account), chain: arcTestnet, transport: custom(eth) });
  return wallet.signTypedData(
    approvalTypedData({
      vault: req.vault,
      chainId: req.chainId,
      market: req.market,
      outcomeYes: req.outcomeYes,
      amount: BigInt(req.amount),
      nonce: BigInt(req.nonce),
      deadline: BigInt(req.deadline),
    }),
  );
}

/** Owner kill switch: sends pause() or unpause() from MetaMask and waits for the receipt. */
export async function setVaultPaused(vault: Address, paused: boolean): Promise<Hex> {
  const eth = provider();
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  if (!account) throw new Error("MetaMask did not share an account.");
  await ensureArc(eth);
  const wallet = createWalletClient({ account: getAddress(account), chain: arcTestnet, transport: custom(eth) });
  const hash = await wallet.writeContract({ address: vault, abi: leashVaultAbi, functionName: paused ? "pause" : "unpause" });
  const reader = createPublicClient({ chain: arcTestnet, transport: http() });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The pause transaction reverted. Are you the owner?");
  return hash;
}
