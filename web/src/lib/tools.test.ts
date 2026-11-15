import { beforeEach, describe, expect, test } from "vitest";
import type { Market } from "./markets";
import { createTools, type ToolDeps } from "./tools";

const btcUp: Market = {
  symbol: "GEMI-BTC15M2611142115-UP",
  eventTicker: "BTC15M2611142115",
  event: "BTC price today at 4:15pm EST",
  outcome: "Up",
  category: "Crypto",
  yesPrice: 0.1,
  noPrice: 0.98,
  expiresAt: "2026-11-14T21:15:00.000Z",
};

const NOW = 1_794_744_000_000;
let calls: string[];
let deps: ToolDeps;

beforeEach(() => {
  calls = [];
  deps = {
    markets: {
      list: async () => [btcUp],
      get: async (s) => (s === btcUp.symbol ? btcUp : null),
    },
    vault: {
      address: "0x0D2D3434c50B7df9D368504D9CdC664Da3D24E74",
      chainId: 5042002,
      state: async () => ({
        limits: { autoApproveMax: 2_000_000n, perTradeCap: 10_000_000n, dailyBudget: 20_000_000n },
        remainingToday: 20_000_000n,
        paused: false,
        balance: 15_000_000n,
        approvalNonce: 3n,
      }),
      spend: async (m, yes, amt) => {
        calls.push(`spend:${m}:${yes}:${amt}`);
        return { positionId: 7n, txHash: "0xabc" };
      },
      spendWithApproval: async (m, yes, amt, deadline, sig) => {
        calls.push(`approved:${m}:${yes}:${amt}:${deadline}:${sig}`);
        return { positionId: 8n, txHash: "0xdef" };
      },
    },
    exchange: {
      placeOrder: async (o) => {
        calls.push(`order:${o.symbol}:${o.outcome}:${o.quantity}@${o.price}`);
        return { orderId: "sim-1", status: "open", simulated: true };
      },
    },
    now: () => NOW,
  };
});

describe("placeBet", () => {
  test("auto path authorizes onchain first, then places the order", async () => {
    const res = await createTools(deps).placeBet({ symbol: btcUp.symbol, side: "yes", amountUsd: "2" });
    expect(res).toMatchObject({ status: "placed", positionId: "7", txHash: "0xabc", amountUsd: "2.00" });
    expect(calls).toEqual([`spend:${btcUp.symbol}:true:2000000`, `order:${btcUp.symbol}:yes:20.00@0.10`]);
  });

  test("mid-size bet returns an owner approval request and moves no money", async () => {
    const res = await createTools(deps).placeBet({ symbol: btcUp.symbol, side: "no", amountUsd: "5" });
    expect(res).toMatchObject({
      status: "needs_approval",
      approval: {
        market: btcUp.symbol,
        outcomeYes: false,
        amount: "4998000", // 5.10 contracts × $0.98 (0.01-contract lots)
        nonce: "3",
        deadline: String(NOW / 1000 + 600),
      },
    });
    expect(calls).toEqual([]);
  });

  test("over-cap bet is refused with a reason the agent can say out loud", async () => {
    const res = await createTools(deps).placeBet({ symbol: btcUp.symbol, side: "yes", amountUsd: "25" });
    expect(res).toMatchObject({ status: "rejected", reason: "over_per_trade_cap" });
    expect(res.message).toMatch(/\$10\.00/);
    expect(calls).toEqual([]);
  });

  test("unknown market is refused before touching the vault", async () => {
    const res = await createTools(deps).placeBet({ symbol: "GEMI-NOPE", side: "yes", amountUsd: "1" });
    expect(res).toMatchObject({ status: "rejected", reason: "market_unavailable" });
    expect(calls).toEqual([]);
  });
});

test("executeApproval spends with the owner signature, then orders", async () => {
  const res = await createTools(deps).executeApproval({
    market: btcUp.symbol,
    outcomeYes: true,
    amount: "5000000",
    deadline: "1794744600",
    signature: "0xsig",
  });
  expect(res).toMatchObject({ status: "placed", positionId: "8", ownerApproved: true });
  expect(calls).toEqual([
    `approved:${btcUp.symbol}:true:5000000:1794744600:0xsig`,
    `order:${btcUp.symbol}:yes:50.00@0.10`,
  ]);
});

test("getBudget speaks in dollars", async () => {
  expect(await createTools(deps).getBudget()).toEqual({
    autoApproveMaxUsd: "2.00",
    perTradeCapUsd: "10.00",
    dailyBudgetUsd: "20.00",
    remainingTodayUsd: "20.00",
    vaultBalanceUsd: "15.00",
    paused: false,
  });
});
