/**
 * The Leash voice agent: prompt, voice, LLM and client tools. Used by
 * scripts/setup-agent.mts to create or update the agent on ElevenLabs.
 * Tool names must match the handlers registered in the browser (src/lib/client/agentTools.ts).
 */

export const CLIENT_TOOL_NAMES = ["listMarkets", "getBudget", "placeBet", "requestOwnerApproval"] as const;
export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];

export const AGENT_NAME = "Leash";
export const AGENT_LLM = "claude-sonnet-5-5";
export const AGENT_VOICE_ID = "cjVigY5qzO86Huf0OWal";
export const AGENT_TTS_MODEL = "eleven_flash_v2_5";

export const FIRST_MESSAGE =
  "Leash here. I can look up prediction markets and bet from your vault, within the limits you set. What are you thinking?";

export const SYSTEM_PROMPT = `You are Leash, a voice trading assistant for Gemini prediction markets.
You spend USDC from the user's vault on the Arc blockchain. The vault contract enforces hard limits you cannot change or get around.

How you work, every time:
1. Find the market. Call listMarkets (a category like Sports, Crypto, Politics, Commodities, and/or a search word). Read back at most three options, short: event, outcome, and the YES price as cents ("Kansas City to win, 76 cents").
2. Confirm intent in one sentence before betting: market, YES or NO, and dollar amount. Wait for a clear yes.
3. Call placeBet with the exact symbol from listMarkets, side "yes" or "no", and amountUsd.
4. Handle the result:
   - status "placed": say it's done in one sentence, including whether the fill was simulated.
   - status "needs_approval": say the amount is above the auto-approve limit, then call requestOwnerApproval with the approvalId. Tell the user to confirm in MetaMask. Report the outcome.
   - status "rejected": read the message, in your own words. Never retry with a split or smaller amount to get around a cap or the daily budget unless the user explicitly asks for that new amount.
5. If asked about budget, limits or balance, call getBudget.

Rules:
- Never invent a market, symbol, price or result. Only use what tools return.
- Prices are probabilities between 0 and 1; say them as cents.
- Keep every reply to one or two short sentences. This is a voice conversation.
- You cannot pause the vault or change limits; only the owner can, from the page.
- This is a hackathon demo on testnet money. Don't give financial advice; you only execute what the user decides.`;

type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: readonly string[] }>;
  required: string[];
};

export type ClientToolConfig = {
  type: "client";
  name: ClientToolName;
  description: string;
  expects_response: true;
  response_timeout_secs: number;
  parameters: JsonSchema;
};

export const CLIENT_TOOLS: readonly ClientToolConfig[] = [
  {
    type: "client",
    name: "listMarkets",
    description: "List open Gemini prediction-market contracts with YES/NO prices.",
    expects_response: true,
    response_timeout_secs: 30,
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Market category",
          enum: ["Sports", "Crypto", "Politics", "Economics", "Commodities", "Entertainment"],
        },
        search: { type: "string", description: "Optional keyword, e.g. a team or asset name" },
      },
      required: [],
    },
  },
  {
    type: "client",
    name: "getBudget",
    description: "Get the vault's limits, today's remaining budget, balance and paused state.",
    expects_response: true,
    response_timeout_secs: 20,
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "client",
    name: "placeBet",
    description:
      "Bet from the vault on one contract. Returns placed, needs_approval (with approvalId) or rejected with a reason.",
    expects_response: true,
    response_timeout_secs: 60,
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Exact contract symbol from listMarkets" },
        side: { type: "string", description: "Which side to buy", enum: ["yes", "no"] },
        amountUsd: { type: "string", description: "Dollar amount, e.g. 2 or 5.50" },
      },
      required: ["symbol", "side", "amountUsd"],
    },
  },
  {
    type: "client",
    name: "requestOwnerApproval",
    description:
      "Ask the owner to sign a pending bet in MetaMask, then execute it. Use the approvalId from placeBet.",
    expects_response: true,
    response_timeout_secs: 120,
    parameters: {
      type: "object",
      properties: { approvalId: { type: "string", description: "approvalId returned by placeBet" } },
      required: ["approvalId"],
    },
  },
];
