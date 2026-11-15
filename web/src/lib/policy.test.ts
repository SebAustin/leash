import { describe, expect, test } from "vitest";
import { decideSpend, type VaultState } from "./policy";

const state: VaultState = {
  limits: { autoApproveMax: 2_000_000n, perTradeCap: 10_000_000n, dailyBudget: 20_000_000n },
  remainingToday: 20_000_000n,
  paused: false,
  balance: 15_000_000n,
};

describe("decideSpend mirrors LeashVault rules", () => {
  test("small bets are auto-approved", () => {
    expect(decideSpend(2_000_000n, state).kind).toBe("auto");
  });

  test("bets between auto max and cap need the owner", () => {
    expect(decideSpend(2_000_001n, state).kind).toBe("needs_approval");
    expect(decideSpend(10_000_000n, state).kind).toBe("needs_approval");
  });

  test("rejects over the per-trade cap", () => {
    expect(decideSpend(10_000_001n, state)).toMatchObject({ kind: "reject", reason: "over_per_trade_cap" });
  });

  test("rejects over the remaining daily budget", () => {
    const tired = { ...state, remainingToday: 1_000_000n };
    expect(decideSpend(1_500_000n, tired)).toMatchObject({ kind: "reject", reason: "over_daily_budget" });
  });

  test("rejects when paused, zero, or vault too empty", () => {
    expect(decideSpend(1_000_000n, { ...state, paused: true })).toMatchObject({ reason: "paused" });
    expect(decideSpend(0n, state)).toMatchObject({ reason: "zero_amount" });
    expect(decideSpend(1_000_000n, { ...state, balance: 500_000n })).toMatchObject({
      reason: "insufficient_vault_balance",
    });
  });
});
