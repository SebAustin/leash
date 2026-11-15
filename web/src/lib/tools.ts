import type { Address, Hex } from "viem";
import { formatUsdc, toUsdcUnits } from "./usdc";
import { decideSpend, type RejectReason, type VaultState } from "./policy";
import { sizeOrder, type Market } from "./markets";

/** How long an owner approval stays valid onchain. */
export const APPROVAL_TTL_SECONDS = 600;

export type Authorized = { positionId: bigint; txHash: Hex | string };

export type OrderRequest = {
  symbol: string;
  outcome: "yes" | "no";
  quantity: string;
  price: string;
};

export type OrderResult = { orderId: string; status: string; simulated: boolean; fallbackReason?: string };

export type ToolDeps = {
  markets: {
    list(q: { category?: string; search?: string }): Promise<Market[]>;
    get(symbol: string): Promise<Market | null>;
  };
  vault: {
    address: Address;
    chainId: number;
    state(): Promise<VaultState & { approvalNonce: bigint }>;
    spend(market: string, outcomeYes: boolean, amount: bigint): Promise<Authorized>;
    spendWithApproval(
      market: string,
      outcomeYes: boolean,
      amount: bigint,
      deadline: bigint,
      signature: Hex | string,
    ): Promise<Authorized>;
  };
  exchange: { placeOrder(o: OrderRequest): Promise<OrderResult> };
  now(): number;
};

export type BetInput = { symbol: string; side: "yes" | "no"; amountUsd: string | number };

export type ApprovedBetInput = {
  market: string;
  outcomeYes: boolean;
  amount: string;
  deadline: string;
  signature: Hex | string;
};

type Rejection = { status: "rejected"; reason: RejectReason | "market_unavailable" | "too_small"; message: string };

export function createTools(deps: ToolDeps) {
  async function listMarkets(q: { category?: string; search?: string; limit?: number }) {
    const markets = await deps.markets.list(q);
    return markets.slice(0, q.limit ?? 8).map(describeMarket);
  }

  async function getBudget() {
    const s = await deps.vault.state();
    return {
      autoApproveMaxUsd: formatUsdc(s.limits.autoApproveMax),
      perTradeCapUsd: formatUsdc(s.limits.perTradeCap),
      dailyBudgetUsd: formatUsdc(s.limits.dailyBudget),
      remainingTodayUsd: formatUsdc(s.remainingToday),
      vaultBalanceUsd: formatUsdc(s.balance),
      paused: s.paused,
    };
  }

  async function placeBet(input: BetInput) {
    const market = await deps.markets.get(input.symbol);
    if (!market) {
      return rejection("market_unavailable", "That market isn't open for trading right now.");
    }
    const outcomeYes = input.side === "yes";
    const size = sizeOrder(toUsdcUnits(input.amountUsd), outcomeYes ? market.yesPrice : market.noPrice);
    if (size.costUnits === 0n) {
      return rejection("too_small", "That's too small to buy even a fraction of a contract.");
    }

    const state = await deps.vault.state();
    const decision = decideSpend(size.costUnits, state);
    if (decision.kind === "reject") {
      return rejection(decision.reason, explain(decision.reason, size.costUnits, state));
    }
    if (decision.kind === "needs_approval") {
      const deadline = BigInt(Math.floor(deps.now() / 1000) + APPROVAL_TTL_SECONDS);
      return {
        status: "needs_approval" as const,
        message: `That's ${spoken(size.costUnits)}, above your $${formatUsdc(
          state.limits.autoApproveMax,
        )} auto-approve limit. I need your signature.`,
        approval: {
          vault: deps.vault.address,
          chainId: deps.vault.chainId,
          market: market.symbol,
          outcomeYes,
          amount: size.costUnits.toString(),
          nonce: state.approvalNonce.toString(),
          deadline: deadline.toString(),
        },
        preview: { ...describeMarket(market), quantity: size.quantity, price: size.price },
      };
    }

    const auth = await deps.vault.spend(market.symbol, outcomeYes, size.costUnits);
    return settle(market, outcomeYes, size.costUnits, auth, false);
  }

  async function executeApproval(input: ApprovedBetInput) {
    const market = await deps.markets.get(input.market);
    if (!market) return rejection("market_unavailable", "That market closed before the trade went through.");
    const amount = BigInt(input.amount);
    const auth = await deps.vault.spendWithApproval(
      input.market,
      input.outcomeYes,
      amount,
      BigInt(input.deadline),
      input.signature,
    );
    return settle(market, input.outcomeYes, amount, auth, true);
  }

  /** Authorize-then-execute: only called after the vault transaction confirmed. */
  async function settle(market: Market, outcomeYes: boolean, amount: bigint, auth: Authorized, ownerApproved: boolean) {
    const size = sizeOrder(amount, outcomeYes ? market.yesPrice : market.noPrice);
    const order = await deps.exchange.placeOrder({
      symbol: market.symbol,
      outcome: outcomeYes ? "yes" : "no",
      quantity: size.quantity,
      price: size.price,
    });
    const side = outcomeYes ? "YES" : "NO";
    return {
      status: "placed" as const,
      message: `Done: ${size.quantity} ${side} on "${market.outcome}" at $${size.price}, $${formatUsdc(amount)} from the vault${
        order.simulated ? " (simulated fill)" : ""
      }.`,
      positionId: auth.positionId.toString(),
      txHash: auth.txHash,
      ownerApproved,
      amountUsd: formatUsdc(amount),
      quantity: size.quantity,
      price: size.price,
      order,
      market: describeMarket(market),
    };
  }

  return { listMarkets, getBudget, placeBet, executeApproval };
}

function describeMarket(m: Market) {
  return {
    symbol: m.symbol,
    event: m.event,
    outcome: m.outcome,
    category: m.category,
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    expiresAt: m.expiresAt,
  };
}

function rejection(reason: Rejection["reason"], message: string): Rejection {
  return { status: "rejected", reason, message };
}

/** Rounded to cents for speech; the exact amount stays in the structured fields. */
function spoken(units: bigint): string {
  return `$${(Number(units) / 1e6).toFixed(2)}`;
}

function explain(reason: RejectReason, amount: bigint, s: VaultState): string {
  const usd = spoken(amount);
  switch (reason) {
    case "paused":
      return "The vault is paused, so I can't spend anything until you unpause it.";
    case "zero_amount":
      return "The amount has to be more than zero.";
    case "over_per_trade_cap":
      return `${usd} is over your $${formatUsdc(s.limits.perTradeCap)} per-trade cap. The vault won't allow it.`;
    case "over_daily_budget":
      return `${usd} is more than the $${formatUsdc(s.remainingToday)} left in today's budget.`;
    case "insufficient_vault_balance":
      return `The vault only holds $${formatUsdc(s.balance)}, not enough for ${usd}.`;
  }
}
