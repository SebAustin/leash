import { z } from "zod";
import { errorResponse, readJson } from "@/lib/http";
import { clientKey, createRateLimiter, isSameOrigin } from "@/lib/rateLimit";
import { getTools } from "@/lib/server";

const allow = createRateLimiter(10, 60_000);

const uint = z.string().regex(/^\d{1,78}$/);

const schema = z.object({
  market: z.string().min(3).max(120),
  outcomeYes: z.boolean(),
  amount: uint,
  deadline: uint,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte signature"),
});

/**
 * Called by the browser after the owner signs in MetaMask. No shared secret needed:
 * the vault only accepts the spend if the EIP-712 signature recovers to the owner.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return Response.json({ status: "error", message: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!allow(clientKey(req))) {
    return Response.json({ status: "error", message: "Too many requests, slow down." }, { status: 429 });
  }
  try {
    const input = schema.parse(await readJson(req));
    return Response.json(await getTools().executeApproval(input));
  } catch (err) {
    return errorResponse(err);
  }
}
