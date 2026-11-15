import { expect, test } from "vitest";
import { createRateLimiter, isSameOrigin } from "./rateLimit";

test("allows up to the limit per window, then resets", () => {
  const allow = createRateLimiter(2, 1000);
  expect([allow("a", 0), allow("a", 10), allow("a", 20)]).toEqual([true, true, false]);
  expect(allow("b", 20)).toBe(true);
  expect(allow("a", 1000)).toBe(true);
});

test("same-origin check compares the Origin host with the Host header", () => {
  const req = (origin?: string) =>
    new Request("http://localhost:3011/api/agent/get-budget", {
      method: "POST",
      headers: { host: "localhost:3011", ...(origin ? { origin } : {}) },
    });
  expect(isSameOrigin(req("http://localhost:3011"))).toBe(true);
  expect(isSameOrigin(req("https://evil.example"))).toBe(false);
  expect(isSameOrigin(req())).toBe(false);
});
