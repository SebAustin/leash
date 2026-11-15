import { describe, expect, test } from "vitest";
import { normalizeEvents, sizeOrder } from "./markets";

const raw = {
  data: [
    {
      id: "262519",
      title: "BTC price today at 4:15pm EST",
      ticker: "BTC15M2611142115",
      category: "Crypto",
      status: "active",
      contracts: [
        {
          label: "Up",
          status: "active",
          marketState: "open",
          instrumentSymbol: "GEMI-BTC15M2611142115-UP",
          expiryDate: "2026-11-14T21:15:00.000Z",
          prices: { buy: { yes: "0.1", no: "0.98" }, bestBid: "0.02", bestAsk: "0.1" },
        },
        {
          label: "Down",
          status: "active",
          marketState: "closed",
          instrumentSymbol: "GEMI-BTC15M2611142115-DOWN",
          expiryDate: "2026-11-14T21:15:00.000Z",
          prices: { buy: { yes: "0.9", no: "0.12" } },
        },
      ],
    },
    { id: "1", title: "Settled", category: "Crypto", status: "settled", contracts: [] },
  ],
};

test("normalizeEvents keeps only tradable contracts, flattened", () => {
  expect(normalizeEvents(raw)).toEqual([
    {
      symbol: "GEMI-BTC15M2611142115-UP",
      eventTicker: "BTC15M2611142115",
      event: "BTC price today at 4:15pm EST",
      outcome: "Up",
      category: "Crypto",
      yesPrice: 0.1,
      noPrice: 0.98,
      expiresAt: "2026-11-14T21:15:00.000Z",
    },
  ]);
});

test("normalizeEvents rejects a payload without a data array", () => {
  expect(() => normalizeEvents({ nope: true })).toThrow();
});

describe("sizeOrder", () => {
  test("buys as many 0.01 contracts as the budget allows at the ask", () => {
    expect(sizeOrder(2_000_000n, 0.1)).toEqual({ quantity: "20.00", price: "0.10", costUnits: 2_000_000n });
    expect(sizeOrder(5_000_000n, 0.61)).toEqual({ quantity: "8.19", price: "0.61", costUnits: 4_995_900n });
  });

  test("rejects prices outside (0, 1)", () => {
    expect(() => sizeOrder(1_000_000n, 0)).toThrow();
    expect(() => sizeOrder(1_000_000n, 1)).toThrow();
  });
});
