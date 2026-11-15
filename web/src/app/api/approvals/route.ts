import { z } from "zod";
import { errorResponse, readJson } from "@/lib/http";
import { getTools } from "@/lib/server";

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
  try {
    const input = schema.parse(await readJson(req));
    return Response.json(await getTools().executeApproval(input));
  } catch (err) {
    return errorResponse(err);
  }
}
