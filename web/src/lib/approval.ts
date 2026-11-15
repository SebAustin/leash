import type { Address } from "viem";

export const APPROVAL_TYPES = {
  Approval: [
    { name: "market", type: "string" },
    { name: "outcomeYes", type: "bool" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type ApprovalRequest = {
  vault: Address;
  chainId: number;
  market: string;
  outcomeYes: boolean;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
};

/** EIP-712 payload the owner signs to let the agent call `spendWithApproval`. */
export function approvalTypedData(r: ApprovalRequest) {
  return {
    domain: { name: "LeashVault", version: "1", chainId: r.chainId, verifyingContract: r.vault },
    types: APPROVAL_TYPES,
    primaryType: "Approval" as const,
    message: {
      market: r.market,
      outcomeYes: r.outcomeYes,
      amount: r.amount,
      nonce: r.nonce,
      deadline: r.deadline,
    },
  };
}
