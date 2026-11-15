import type { ServerConfig } from "./config";
import { signedHeaders } from "./geminiAuth";
import { normalizeEvents, type Market } from "./markets";
import type { OrderRequest, OrderResult, ToolDeps } from "./tools";

const CACHE_MS = 15_000;
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 25;

/**
 * Public market data. Gemini events are large (full rules text per contract), so we
 * fetch small filtered pages, cache them briefly, and re-read a single event for a
 * fresh price right before a bet.
 */
export function createMarketsAdapter(cfg: ServerConfig): ToolDeps["markets"] {
  const pages = new Map<string, { at: number; markets: Market[] }>();
  const tickerBySymbol = new Map<string, string>();

  async function fetchJson(path: string): Promise<unknown> {
    const res = await fetch(`${cfg.GEMINI_MARKETS_URL}${path}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Gemini market data request failed: HTTP ${res.status}`);
    return res.json();
  }

  function remember(markets: Market[]) {
    for (const m of markets) tickerBySymbol.set(m.symbol, m.eventTicker);
    return markets;
  }

  async function page(category?: string, search?: string): Promise<Market[]> {
    const qs = new URLSearchParams({ status: "active", limit: String(PAGE_SIZE) });
    if (category) qs.set("category", category);
    if (search) qs.set("search", search);
    const key = qs.toString();
    const hit = pages.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.markets;
    const markets = remember(normalizeEvents(await fetchJson(`/v1/prediction-markets/events?${key}`)));
    pages.set(key, { at: Date.now(), markets });
    return markets;
  }

  return {
    list: ({ category, search }) => page(category, search),
    async get(symbol) {
      if (!tickerBySymbol.has(symbol)) await page();
      const ticker = tickerBySymbol.get(symbol);
      if (!ticker) return null;
      const event = await fetchJson(`/v1/prediction-markets/events/${encodeURIComponent(ticker)}`);
      return remember(normalizeEvents({ data: [event] })).find((m) => m.symbol === symbol) ?? null;
    },
  };
}

/**
 * Places a limit order on Gemini (sandbox by default). Without API credentials it
 * returns a clearly-labelled simulated fill so the demo still runs end to end.
 */
export function createExchangeAdapter(cfg: ServerConfig): ToolDeps["exchange"] {
  return {
    async placeOrder(o: OrderRequest): Promise<OrderResult> {
      if (!cfg.GEMINI_API_KEY || !cfg.GEMINI_API_SECRET) {
        return { orderId: `sim-${Date.now()}`, status: "filled", simulated: true };
      }
      const request = "/v1/prediction-markets/order";
      const payload = {
        request,
        nonce: String(Date.now()),
        symbol: o.symbol,
        orderType: "limit",
        side: "buy",
        outcome: o.outcome,
        quantity: o.quantity,
        price: o.price,
        timeInForce: "good-til-cancel",
      };
      const res = await fetch(`${cfg.GEMINI_BASE_URL}${request}`, {
        method: "POST",
        headers: signedHeaders({ apiKey: cfg.GEMINI_API_KEY, apiSecret: cfg.GEMINI_API_SECRET }, payload),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // Funds are already authorized onchain, so record a labelled simulated fill and say why,
        // e.g. the sandbox doesn't list this production market.
        const reason = String(body.reason ?? body.message ?? `HTTP ${res.status}`);
        console.warn(`[leash] Gemini sandbox rejected ${o.symbol}: ${reason}`);
        return { orderId: `sim-${Date.now()}`, status: "filled", simulated: true, fallbackReason: reason };
      }
      return { orderId: String(body.orderId ?? body.id ?? "unknown"), status: String(body.status ?? "open"), simulated: false };
    },
  };
}
