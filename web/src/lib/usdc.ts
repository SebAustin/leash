export const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

/** Dollars ("2.50" or 2.5) → USDC base units (6 decimals). Throws on bad input. */
export function toUsdcUnits(dollars: string | number): bigint {
  const text = typeof dollars === "number" ? numberToText(dollars) : dollars.trim();
  if (!AMOUNT_RE.test(text)) throw new Error(`Invalid USDC amount: ${String(dollars)}`);
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

function numberToText(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid USDC amount: ${n}`);
  return n.toFixed(USDC_DECIMALS).replace(/\.?0+$/, "") || "0";
}

/** USDC base units → "2.00" (at least two decimals, no trailing zeros beyond that). */
export function formatUsdc(units: bigint): string {
  const whole = units / UNIT;
  const frac = (units % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${frac.padEnd(2, "0")}`;
}
