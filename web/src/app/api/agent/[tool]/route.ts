import { clientKey, createRateLimiter, isSameOrigin } from "@/lib/rateLimit";
import { isToolName, runTool } from "@/lib/toolHandler";

const allow = createRateLimiter(30, 60_000);

/**
 * Same tools, called by the voice UI's client tools from the browser. There is no secret
 * the browser could keep, so this relies on a same-origin check and a rate limit; the
 * real guard is the vault, which caps what the agent key can ever spend.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params;
  if (!isToolName(tool)) {
    return Response.json({ status: "error", message: `Unknown tool ${tool}` }, { status: 404 });
  }
  if (!isSameOrigin(req)) {
    return Response.json({ status: "error", message: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!allow(clientKey(req))) {
    return Response.json({ status: "error", message: "Too many requests, slow down." }, { status: 429 });
  }
  return runTool(tool, req);
}
