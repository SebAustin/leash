import { expect, test } from "vitest";
import { signedHeaders } from "./geminiAuth";

// Expected values computed independently with `base64` + `openssl dgst -sha384 -hmac`.
test("signs the base64 payload with HMAC-SHA384", () => {
  const payload = {
    request: "/v1/prediction-markets/order",
    nonce: "1794744000000",
    symbol: "GEMI-BTC15M2611142115-UP",
    orderType: "limit",
    side: "buy",
    outcome: "yes",
    quantity: "20",
    price: "0.10",
    timeInForce: "good-til-cancel",
  };
  const h = signedHeaders({ apiKey: "account-test", apiSecret: "test-secret-not-real" }, payload);
  expect(h["X-GEMINI-APIKEY"]).toBe("account-test");
  expect(h["X-GEMINI-PAYLOAD"]).toBe(
    "eyJyZXF1ZXN0IjoiL3YxL3ByZWRpY3Rpb24tbWFya2V0cy9vcmRlciIsIm5vbmNlIjoiMTc5NDc0NDAwMDAwMCIsInN5bWJvbCI6IkdFTUktQlRDMTVNMjYxMTE0MjExNS1VUCIsIm9yZGVyVHlwZSI6ImxpbWl0Iiwic2lkZSI6ImJ1eSIsIm91dGNvbWUiOiJ5ZXMiLCJxdWFudGl0eSI6IjIwIiwicHJpY2UiOiIwLjEwIiwidGltZUluRm9yY2UiOiJnb29kLXRpbC1jYW5jZWwifQ==",
  );
  expect(h["X-GEMINI-SIGNATURE"]).toBe(
    "4eee040673d6127536fc775cd663abbd28689fce83f1aeb2ddd5ec4105855bdfece1ca88720f250c58312716d4b98095",
  );
  expect(h["Content-Type"]).toBe("text/plain");
});
