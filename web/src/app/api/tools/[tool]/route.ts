import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { errorResponse, isAuthorized, readJson } from "@/lib/http";
import { getTools } from "@/lib/server";

const amount = z.union([z.string(), z.number()]).transform(String);

const schemas = {
  "list-markets": z.object({
    category: z.string().max(40).optional(),
    search: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }),
  "get-budget": z.object({}).passthrough(),
  "place-bet": z.object({
    symbol: z.string().min(3).max(120),
    side: z.enum(["yes", "no"]),
    amountUsd: amount,
  }),
} as const;

type ToolName = keyof typeof schemas;

/** ElevenLabs server tools: POST /api/tools/<name> with a JSON body and the x-leash-secret header. */
export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params;
  if (!(tool in schemas)) {
    return Response.json({ status: "error", message: `Unknown tool ${tool}` }, { status: 404 });
  }
  try {
    if (!isAuthorized(req, serverConfig().TOOL_SECRET)) {
      return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    }
    const tools = getTools();
    const body = await readJson(req);
    switch (tool as ToolName) {
      case "list-markets":
        return Response.json({ markets: await tools.listMarkets(schemas["list-markets"].parse(body)) });
      case "get-budget":
        return Response.json(await tools.getBudget());
      case "place-bet":
        return Response.json(await tools.placeBet(schemas["place-bet"].parse(body)));
    }
  } catch (err) {
    return errorResponse(err);
  }
}
