import { serverConfig } from "@/lib/config";
import { errorResponse, isAuthorized } from "@/lib/http";
import { isToolName, runTool } from "@/lib/toolHandler";

/** ElevenLabs server tools: POST /api/tools/<name> with a JSON body and the x-leash-secret header. */
export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params;
  if (!isToolName(tool)) {
    return Response.json({ status: "error", message: `Unknown tool ${tool}` }, { status: 404 });
  }
  try {
    if (!isAuthorized(req, serverConfig().TOOL_SECRET)) {
      return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    }
  } catch (err) {
    return errorResponse(err);
  }
  return runTool(tool, req);
}
