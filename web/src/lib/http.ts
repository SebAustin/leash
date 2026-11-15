import { timingSafeEqual } from "node:crypto";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { z } from "zod";

/** Constant-time check of the shared secret ElevenLabs sends with each server-tool call. */
export function isAuthorized(req: Request, secret: string): boolean {
  const given = Buffer.from(req.headers.get("x-leash-secret") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** Maps any failure to a short message the voice agent can say, without leaking internals. */
export function errorResponse(err: unknown): Response {
  if (err instanceof z.ZodError) {
    const detail = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return Response.json({ status: "error", message: `Invalid request. ${detail}` }, { status: 400 });
  }
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "unknown";
      return Response.json(
        { status: "rejected", reason: name, message: `The vault refused the transaction (${name}).` },
        { status: 422 },
      );
    }
  }
  console.error("[leash] tool failure", err);
  const message = err instanceof Error && err.message.startsWith("Gemini") ? err.message : "Something went wrong on the server.";
  return Response.json({ status: "error", message }, { status: 502 });
}
