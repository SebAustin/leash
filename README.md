# Leash

**A voice trading agent on a short onchain leash.**

Talk to Leash and it trades Gemini prediction markets for you. Its USDC lives in a vault contract on
[Arc](https://docs.arc.io/) that enforces spending limits the agent cannot talk its way around: small
bets go through on their own, larger ones need your voice "yes" plus a wallet signature, and anything
over the cap is rejected by the contract itself.

> UBC 2026 Hackathon — Agentic Payments and AI track · Best use of Arc · Gemini Prediction Markets ·
> ElevenLabs · QuickNode Streams

## Status

Work in progress (hackathon week, Nov 13–20, 2026).

- [x] `LeashVault` contract + Foundry test suite
- [x] Deploy to Arc testnet
- [x] Agent server tools (Gemini markets, vault spend, owner-approval execution)
- [x] ElevenLabs voice agent + one-screen console (needs an ElevenLabs key to go live)
- [x] Owner approval flow (MetaMask EIP-712) and pause switch
- [ ] QuickNode Stream → activity feed

## Safety limits (enforced onchain)

| Rule | Default | Where |
|---|---|---|
| Agent may spend on its own up to | $2 per trade | `LeashVault.spend` |
| Owner co-signature (EIP-712) required | $2 – $10 per trade | `LeashVault.spendWithApproval` |
| Hard per-trade cap | $10 | both spend paths |
| Daily budget (resets 00:00 UTC) | $20 | both spend paths |
| Kill switch | owner `pause()` | blocks every agent spend |

The agent's key can only call the two spend functions. Funds always go to the configured broker
address, which only the owner can change. Every authorized position emits `PositionAuthorized`, and
Gemini orders are placed only after that transaction confirms (authorize-then-execute).

### Known limitations (by design, for the hackathon scope)

- **Midnight burst.** The budget uses fixed UTC days, so a compromised agent could spend the full
  daily budget at 23:59:59 and again at 00:00:00 — at most 2× the daily budget in a short window.
  A rolling window would close this at the cost of more storage writes per spend.
- **Market and outcome are labels onchain.** The contract binds the owner's signature to the market,
  outcome and amount, but it cannot check what the broker does with the funds offchain; the server
  places the matching Gemini order only after the `PositionAuthorized` event confirms.
- The owner can cancel every outstanding approval with `revokeApprovals()` and withdraw to any
  address with `withdraw(to, amount)`, which also works while paused.

## Repository layout

```
contracts/   Foundry project: LeashVault.sol, tests, deploy script
web/         Next.js app: voice console, agent tools (src/lib, src/app/api), ElevenLabs setup script
```

## Voice agent

The agent runs on ElevenLabs Agents with Claude Sonnet 5.5 as the LLM. Its prompt, voice and
tools live in `web/src/lib/agentDefinition.ts`; `pnpm setup:agent` creates or updates it.

```bash
cd web
# put ELEVENLABS_API_KEY in .env.local, then:
pnpm setup:agent            # prints ELEVENLABS_AGENT_ID=... to add to .env.local
pnpm dev                    # open http://localhost:3000 and press "Talk to Leash"
```

The agent is private: the page asks our server for a short-lived WebRTC token
(`/api/conversation-token`), so the ElevenLabs key never reaches the browser.

Its four tools are **client tools** that run in the page: `listMarkets`, `getBudget`,
`placeBet` and `requestOwnerApproval`. The first three call the same-origin `/api/agent/*`
routes. When a bet needs the owner, the page keeps the approval request and gives the agent
only an `approvalId`. `requestOwnerApproval` then opens MetaMask on that stored request, so the
agent cannot change the amount you are asked to sign. The page header has the owner's
**Pause agent** switch, which calls `pause()` from MetaMask.

## Agent server tools

ElevenLabs calls these as server tools: `POST /api/tools/<name>` with a JSON body and an
`x-leash-secret` header (`TOOL_SECRET`).

| Tool | Body | Returns |
|---|---|---|
| `list-markets` | `{ category?, search?, limit? }` | open Gemini contracts with yes/no prices |
| `get-budget` | `{}` | limits, today's remaining budget, vault balance, paused |
| `place-bet` | `{ symbol, side: "yes"\|"no", amountUsd }` | `placed`, `needs_approval` (EIP-712 request for the owner) or `rejected` with a spoken reason |

`POST /api/approvals` takes the owner's MetaMask signature for a `needs_approval` request and
executes it via `spendWithApproval`. It needs no shared secret: the vault itself rejects any
signature that doesn't recover to the owner.

Decision loop for one bet: fetch a fresh price → size the order in 0.01-contract lots →
predict the vault's path with the same rules as the contract (`src/lib/policy.ts`) → reject,
ask for the owner's signature, or simulate and send `spend` → wait for `PositionAuthorized` →
only then place the Gemini order.

Market data comes from Gemini's public production API (the sandbox books are empty); orders go
to the sandbox when `GEMINI_API_KEY`/`GEMINI_API_SECRET` are set. Without keys, or if the
sandbox rejects a production symbol, the fill is returned as `simulated: true` with the reason.

```bash
cd web
ln -s ../.env.local .env.local   # once
pnpm install && pnpm test && pnpm dev
```

## Contracts

```bash
git clone --recurse-submodules https://github.com/SebAustin/leash
cd leash/contracts
forge test
```

Deploy to Arc testnet (chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, USDC ERC-20
`0x3600000000000000000000000000000000000000`):

```bash
export OWNER_ADDRESS=0x... AGENT_ADDRESS=0x... BROKER_ADDRESS=0x...
forge script script/DeployLeashVault.s.sol --rpc-url arc_testnet --account <keystore> --broadcast
```

Arc's minimum base fee is 20 gwei; transactions priced below it are dropped without a receipt.

| Contract | Arc testnet address |
|---|---|
| LeashVault | [`0x0D2D3434c50B7df9D368504D9CdC664Da3D24E74`](https://explorer.testnet.arc.io/address/0x0D2D3434c50B7df9D368504D9CdC664Da3D24E74) |
