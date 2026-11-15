import { createHmac } from "node:crypto";

export type GeminiCredentials = { apiKey: string; apiSecret: string };

/** Gemini private REST auth: base64 JSON payload in a header, HMAC-SHA384 signed, empty body. */
export function signedHeaders(creds: GeminiCredentials, payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = createHmac("sha384", creds.apiSecret).update(encoded).digest("hex");
  return {
    "Content-Type": "text/plain",
    "Content-Length": "0",
    "Cache-Control": "no-cache",
    "X-GEMINI-APIKEY": creds.apiKey,
    "X-GEMINI-PAYLOAD": encoded,
    "X-GEMINI-SIGNATURE": signature,
  } as const;
}
