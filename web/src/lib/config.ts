import { z } from "zod";

const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

const schema = z.object({
  ARC_RPC_URL: z.url().default("https://rpc.testnet.arc.io"),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  VAULT_ADDRESS: address,
  USDC_ADDRESS: address.default("0x3600000000000000000000000000000000000000"),
  AGENT_PRIVATE_KEY: hexKey,
  /** Public, read-only market data. Production has live prices; the sandbox books are mostly empty. */
  GEMINI_MARKETS_URL: z.url().default("https://api.gemini.com"),
  /** Authenticated order placement (sandbox by default). */
  GEMINI_BASE_URL: z.url().default("https://api.sandbox.gemini.com"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_SECRET: z.string().optional(),
  TOOL_SECRET: z.string().min(16, "TOOL_SECRET must be at least 16 characters"),
});

export type ServerConfig = z.infer<typeof schema>;

let cached: ServerConfig | undefined;

/** Server-side config, validated once. Throws with the names of missing vars, never their values. */
export function serverConfig(): ServerConfig {
  if (cached) return cached;
  const parsed = schema.safeParse({
    ...process.env,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    GEMINI_API_SECRET: process.env.GEMINI_API_SECRET || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
