import { z } from "zod";
import { errorResponse, readJson } from "./http";
import { getTools } from "./server";

const amount = z.union([z.string(), z.number()]).transform(String);

export const toolSchemas = {
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

export type ToolName = keyof typeof toolSchemas;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(toolSchemas, name);
}

/** Validates the body and runs one agent tool. Callers handle authentication. */
export async function runTool(tool: ToolName, req: Request): Promise<Response> {
  try {
    const tools = getTools();
    const body = await readJson(req);
    switch (tool) {
      case "list-markets":
        return Response.json({ markets: await tools.listMarkets(toolSchemas[tool].parse(body)) });
      case "get-budget":
        return Response.json(await tools.getBudget());
      case "place-bet":
        return Response.json(await tools.placeBet(toolSchemas[tool].parse(body)));
    }
  } catch (err) {
    return errorResponse(err);
  }
}
