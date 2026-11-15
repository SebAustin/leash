import { clientKey, createRateLimiter, isSameOrigin } from "@/lib/rateLimit";

const allow = createRateLimiter(6, 60_000);
const TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";

/** Mints a short-lived WebRTC token for the private ElevenLabs agent. The API key never reaches the browser. */
export async function GET(req: Request) {
  if (!isSameOrigin(req) && req.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!allow(clientKey(req))) {
    return Response.json({ error: "Too many sessions started, wait a minute." }, { status: 429 });
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return Response.json(
      { error: "Voice agent not configured: set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID." },
      { status: 503 },
    );
  }
  try {
    const res = await fetch(`${TOKEN_URL}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[leash] ElevenLabs token request failed", res.status, await res.text());
      return Response.json({ error: "Could not start a voice session." }, { status: 502 });
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) return Response.json({ error: "Could not start a voice session." }, { status: 502 });
    return Response.json({ token });
  } catch (err) {
    console.error("[leash] ElevenLabs token request error", err);
    return Response.json({ error: "Could not start a voice session." }, { status: 502 });
  }
}
