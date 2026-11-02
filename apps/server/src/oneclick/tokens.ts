import type { Repo } from "../db/db";
import { SEED_ASSETS } from "../demo/seed";
import type { TokenResponse } from "./types";

export type PublicToken = {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price: number;
  priceUpdatedAt: string | null;
};

/** The "sensible top set" served by /api/tokens: NEAR-chain majors (trade origins) + a few native assets. */
const TOP: ReadonlyArray<readonly [blockchain: string, symbol: string]> = [
  ["near", "wNEAR"],
  ["near", "USDC"],
  ["near", "USDT"],
  ["btc", "BTC"],
  ["eth", "ETH"],
  ["sol", "SOL"],
  ["zec", "ZEC"],
];
const STABLES = new Set(["USDC", "USDT", "DAI"]);

type TokenSource = { getTokens(): Promise<TokenResponse[]> };

/**
 * Caches GET /v0/tokens (filtered) and refreshes the `prices` table (the priceRefresher job).
 * If 1Click is unreachable, falls back to the last good list, then to the seed assets, so demo mode
 * never breaks.
 */
export class TokenCache {
  tokens: PublicToken[] = [];
  source: "live" | "seed" = "seed";
  updatedAt: string | null = null;
  lastError: string | null = null;

  constructor(
    private readonly client: TokenSource,
    private readonly repo: Repo,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = seedTokens(repo);
  }

  async refresh(): Promise<void> {
    try {
      const all = await this.client.getTokens();
      const at = new Date(this.now()).toISOString();
      this.repo.transaction(() => {
        for (const t of all) {
          const price = STABLES.has(t.symbol.toUpperCase()) ? 1 : Number(t.price);
          if (Number.isFinite(price) && price > 0) this.repo.upsertPrice(t.assetId, t.symbol, price, at);
        }
      });
      const top = TOP.flatMap(([chain, sym]) => {
        const t = all.find((x) => x.blockchain === chain && x.symbol === sym);
        return t ? [toPublic(t)] : [];
      });
      if (top.length > 0) {
        this.tokens = top;
        this.source = "live";
        this.updatedAt = at;
        this.lastError = null;
      }
    } catch (err) {
      this.lastError = (err as Error).message;
    }
  }

  find(assetId: string): PublicToken | undefined {
    return this.tokens.find((t) => t.assetId === assetId) ?? seedTokens(this.repo).find((t) => t.assetId === assetId);
  }

  start(intervalMs = 60_000): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

function toPublic(t: TokenResponse): PublicToken {
  return {
    assetId: t.assetId,
    symbol: t.symbol,
    blockchain: String(t.blockchain),
    decimals: t.decimals,
    price: STABLES.has(t.symbol.toUpperCase()) ? 1 : Number(t.price),
    priceUpdatedAt: t.priceUpdatedAt ?? null,
  };
}

/** Seed assets with the last stored live price if any (else the seed path start price). */
function seedTokens(repo: Repo): PublicToken[] {
  const stored = new Map(repo.prices().map((p) => [p.asset_id, p]));
  const chainOf: Record<string, string> = { wNEAR: "near", USDC: "near", BTC: "btc", ETH: "eth", SOL: "sol", ZEC: "zec" };
  return Object.values(SEED_ASSETS).map((a) => ({
    assetId: a.assetId,
    symbol: a.symbol,
    blockchain: chainOf[a.symbol] ?? "near",
    decimals: a.decimals,
    price: stored.get(a.assetId)?.price ?? a.startPrice,
    priceUpdatedAt: stored.get(a.assetId)?.updated_at ?? null,
  }));
}
