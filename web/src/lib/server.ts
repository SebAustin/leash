import { serverConfig } from "./config";
import { createExchangeAdapter, createMarketsAdapter } from "./gemini";
import { createTools } from "./tools";
import { createVaultAdapter } from "./vault";

let tools: ReturnType<typeof createTools> | undefined;

/** Wires the real adapters once per server instance. */
export function getTools() {
  if (tools) return tools;
  const cfg = serverConfig();
  tools = createTools({
    markets: createMarketsAdapter(cfg),
    vault: createVaultAdapter(cfg),
    exchange: createExchangeAdapter(cfg),
    now: () => Date.now(),
  });
  return tools;
}
