import { z } from "zod";

export type Market = {
  symbol: string;
  eventTicker: string;
  event: string;
  outcome: string;
  category: string;
  yesPrice: number;
  noPrice: number;
  expiresAt: string;
};

const contractSchema = z.object({
  label: z.string(),
  status: z.string(),
  marketState: z.string().optional(),
  instrumentSymbol: z.string(),
  expiryDate: z.string(),
  prices: z
    .object({ buy: z.object({ yes: z.string(), no: z.string() }).partial().optional() })
    .optional(),
});

const eventsSchema = z.object({
  data: z.array(
    z.object({
      title: z.string(),
      ticker: z.string().default(""),
      category: z.string().default(""),
      status: z.string(),
      contracts: z.array(z.unknown()).default([]),
    }),
  ),
});

/** Flattens Gemini's events payload into the contracts that can be traded right now. */
export function normalizeEvents(raw: unknown): Market[] {
  const { data } = eventsSchema.parse(raw);
  return data
    .filter((e) => e.status === "active")
    .flatMap((e) =>
      e.contracts.flatMap((c): Market[] => {
        const parsed = contractSchema.safeParse(c);
        if (!parsed.success) return [];
        const k = parsed.data;
        const yes = Number(k.prices?.buy?.yes);
        const no = Number(k.prices?.buy?.no);
        if (k.status !== "active" || k.marketState !== "open") return [];
        if (!(yes > 0 && yes < 1 && no > 0 && no < 1)) return [];
        return [
          {
            symbol: k.instrumentSymbol,
            eventTicker: e.ticker,
            event: e.title,
            outcome: k.label,
            category: e.category,
            yesPrice: yes,
            noPrice: no,
            expiresAt: k.expiryDate,
          },
        ];
      }),
    );
}

export type OrderSize = { quantity: string; price: string; costUnits: bigint };

/**
 * Largest 0.01-contract quantity affordable at `price` (0.01 tick).
 * Integer math in USDC units: one contract at `cents` costs cents * 10_000 units.
 */
export function sizeOrder(amountUnits: bigint, price: number): OrderSize {
  const cents = BigInt(Math.round(price * 100));
  if (cents <= 0n || cents >= 100n) throw new Error(`Price out of range: ${price}`);
  const hundredths = amountUnits / (cents * 100n);
  return {
    quantity: `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`,
    price: `0.${cents.toString().padStart(2, "0")}`,
    costUnits: hundredths * cents * 100n,
  };
}
