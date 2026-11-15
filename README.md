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
- [ ] Deploy to Arc testnet
- [ ] Agent server tools (Gemini sandbox, vault spend)
- [ ] ElevenLabs voice agent + UI
- [ ] Owner approval flow
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
| LeashVault | _not deployed yet_ |
