import { describe, expect, test } from "vitest";
import { formatUsdc, toUsdcUnits } from "./usdc";

describe("toUsdcUnits", () => {
  test("converts dollars to 6-decimal units", () => {
    expect(toUsdcUnits("2")).toBe(2_000_000n);
    expect(toUsdcUnits("2.5")).toBe(2_500_000n);
    expect(toUsdcUnits(0.75)).toBe(750_000n);
    expect(toUsdcUnits("10.000001")).toBe(10_000_001n);
  });

  test("rejects negative, malformed and over-precise amounts", () => {
    expect(() => toUsdcUnits("-1")).toThrow();
    expect(() => toUsdcUnits("abc")).toThrow();
    expect(() => toUsdcUnits("1.0000001")).toThrow();
    expect(() => toUsdcUnits(Number.NaN)).toThrow();
  });
});

test("formatUsdc renders two decimals minimum", () => {
  expect(formatUsdc(2_000_000n)).toBe("2.00");
  expect(formatUsdc(10_000_001n)).toBe("10.000001");
  expect(formatUsdc(0n)).toBe("0.00");
});
