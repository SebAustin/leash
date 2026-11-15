/**
 * Creates or updates the Leash agent and its client tools on ElevenLabs.
 *   cd web && node --env-file=.env.local scripts/setup-agent.mts
 * Prints the agent id to put in .env.local as ELEVENLABS_AGENT_ID.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  AGENT_LLM,
  AGENT_NAME,
  AGENT_TTS_MODEL,
  AGENT_VOICE_ID,
  CLIENT_TOOLS,
  FIRST_MESSAGE,
  SYSTEM_PROMPT,
} from "../src/lib/agentDefinition.ts";

const API = "https://api.elevenlabs.io/v1/convai";
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("ELEVENLABS_API_KEY is not set in .env.local");
  process.exit(1);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": key as string, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type ToolList = { tools?: { id: string; tool_config?: { name?: string } }[] };

async function upsertTools(): Promise<string[]> {
  const existing = await call<ToolList>("GET", "/tools");
  const byName = new Map((existing.tools ?? []).map((t) => [t.tool_config?.name, t.id]));
  const ids: string[] = [];
  for (const tool of CLIENT_TOOLS) {
    const id = byName.get(tool.name);
    if (id) {
      await call("PATCH", `/tools/${id}`, { tool_config: tool });
      console.log(`updated tool ${tool.name}`);
      ids.push(id);
    } else {
      const created = await call<{ id: string }>("POST", "/tools", { tool_config: tool });
      console.log(`created tool ${tool.name}`);
      ids.push(created.id);
    }
  }
  return ids;
}

const toolIds = await upsertTools();
const body = {
  name: AGENT_NAME,
  conversation_config: {
    agent: {
      first_message: FIRST_MESSAGE,
      language: "en",
      prompt: { prompt: SYSTEM_PROMPT, llm: AGENT_LLM, temperature: 0.3, tool_ids: toolIds },
    },
    tts: { voice_id: AGENT_VOICE_ID, model_id: AGENT_TTS_MODEL },
  },
  // Private agent: the browser gets a short-lived token from our server, never the API key.
  platform_settings: { auth: { enable_auth: true } },
};

const agentId = process.env.ELEVENLABS_AGENT_ID;
if (agentId) {
  await call("PATCH", `/agents/${agentId}`, body);
  console.log(`updated agent ${agentId}`);
} else {
  const created = await call<{ agent_id: string }>("POST", "/agents/create", body);
  console.log(`created agent ${created.agent_id}`);
  const envPath = new URL("../.env.local", import.meta.url);
  const current = readFileSync(envPath, "utf8").split("\n").filter((l) => !l.startsWith("ELEVENLABS_AGENT_ID="));
  writeFileSync(envPath, [...current.filter((l, i) => l || i < current.length - 1), `ELEVENLABS_AGENT_ID=${created.agent_id}`, ""].join("\n"));
  console.log("saved ELEVENLABS_AGENT_ID to .env.local");
}
