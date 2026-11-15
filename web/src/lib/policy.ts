export type Limits = { autoApproveMax: bigint; perTradeCap: bigint; dailyBudget: bigint };

export type VaultState = {
  limits: Limits;
  remainingToday: bigint;
  paused: boolean;
  balance: bigint;
};

export type RejectReason =
  | "paused"
  | "zero_amount"
  | "over_per_trade_cap"
  | "over_daily_budget"
  | "insufficient_vault_balance";

export type SpendDecision =
  | { kind: "auto" }
  | { kind: "needs_approval" }
  | { kind: "reject"; reason: RejectReason };

/**
 * Predicts which LeashVault path a spend will take, so the agent can explain
 * a rejection before sending a transaction. The contract stays the authority.
 */
export function decideSpend(amount: bigint, s: VaultState): SpendDecision {
  if (s.paused) return reject("paused");
  if (amount <= 0n) return reject("zero_amount");
  if (amount > s.limits.perTradeCap) return reject("over_per_trade_cap");
  if (amount > s.remainingToday) return reject("over_daily_budget");
  if (amount > s.balance) return reject("insufficient_vault_balance");
  return amount <= s.limits.autoApproveMax ? { kind: "auto" } : { kind: "needs_approval" };
}

function reject(reason: RejectReason): SpendDecision {
  return { kind: "reject", reason };
}
