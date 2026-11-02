import type { Repo, TradeRow, TraderRow } from "../db/db";
import { isDemoId } from "../demo/demoAccounts";
import { fromBaseUnits } from "../lib/units";
import {
  computePnl,
  computeWindowPnl,
  equityCurve,
  priceHistoryFromTrades,
  type EquityPoint,
  type PnlTrade,
  type PriceAt,
} from "./engine";

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI"]);

export function toPnlTrade(row: TradeRow): PnlTrade {
  return {
    t: Date.parse(row.settled_at ?? row.created_at),
    sell: row.origin_asset,
    qIn: Number(row.amount_in_formatted),
    vIn: Number(row.amount_in_usd),
    buy: row.dest_asset,
    qOut: Number(row.amount_out_formatted),
    vOut: Number(row.amount_out_usd),
  };
}

/** Price sources, built once per request from the DB. */
export type Pricing = {
  isStable: (assetId: string) => boolean;
  /** Seed price path: marks for the seeded SIMULATED traders. */
  seedPriceAt: PriceAt;
  /** Trade-implied history + latest live /v0/tokens prices: marks for everyone else. */
  livePriceAt: PriceAt;
};

export function buildPricing(repo: Repo): Pricing {
  const symbolOf = new Map<string, string>();
  for (const p of repo.prices()) symbolOf.set(p.asset_id, p.symbol);
  const settled = repo.allSettledTrades();
  for (const t of settled) {
    symbolOf.set(t.origin_asset, t.origin_symbol);
    symbolOf.set(t.dest_asset, t.dest_symbol);
  }
  const isStable = (a: string) => STABLE_SYMBOLS.has((symbolOf.get(a) ?? "").toUpperCase());

  const series = new Map<string, { t: number; price: number }[]>();
  for (const p of repo.priceHistory()) {
    const arr = series.get(p.asset_id) ?? [];
    arr.push({ t: p.t, price: p.price });
    series.set(p.asset_id, arr);
  }
  const seedPriceAt: PriceAt = (asset, t) => {
    const arr = series.get(asset);
    if (!arr || arr.length === 0) return undefined;
    if (t <= arr[0]!.t) return arr[0]!.price;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]!.t <= t) lo = mid;
      else hi = mid - 1;
    }
    return arr[lo]!.price;
  };

  const live = repo.prices();
  const latestAt = live.reduce((m, p) => Math.max(m, Date.parse(p.updated_at) || 0), 0);
  const livePriceAt = priceHistoryFromTrades(
    settled.filter((t) => t.is_simulated === 0 || isDemoId(t.trader_id)).map(toPnlTrade),
    live.length ? { prices: Object.fromEntries(live.map((p) => [p.asset_id, p.price])), at: latestAt } : undefined,
  );
  return { isStable, seedPriceAt, livePriceAt };
}

export type TraderStats = {
  id: string;
  name: string;
  simulated: boolean;
  style: string | null;
  createdAt: string;
  pnl30dPct: number;
  pnl30dUsd: number;
  pnlPct: number;
  pnlTotalUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  capitalUsd: number;
  winRate: number | null;
  tradeCount: number;
  committedCount: number;
  headHash: string | null;
  commitTx: string | null;
  keyPrice: string; // yoctoNEAR
  keyPriceNear: string;
  periodDays: number;
  lastTradeAt: string | null;
};

const round = (n: number, dp = 6) => Number(n.toFixed(dp));

export function traderStats(
  repo: Repo,
  trader: TraderRow,
  pricing: Pricing,
  now: number,
  seededIds: ReadonlySet<string>,
): { stats: TraderStats; curve: EquityPoint[] } {
  const rows = repo.settledTrades(trader.account_id);
  const trades = rows.map(toPnlTrade);
  const priceAt = seededIds.has(trader.account_id) ? pricing.seedPriceAt : pricing.livePriceAt;
  const opts = { isStable: pricing.isStable, priceAt, asOf: now };
  const total = computePnl(trades, opts);
  const w30 = computeWindowPnl(trades, { ...opts, now, days: 30 });
  const head = repo.getChainHead(trader.account_id);
  const curve = equityCurve(trades, { ...opts, now }).map((p) => ({ t: p.t, equityUsd: round(p.equityUsd, 2) }));
  return {
    stats: {
      id: trader.account_id,
      name: trader.display_name,
      // Any simulated fill in the log makes the whole record SIMULATED (AGENT.md hard rule 9, AUDIT H2).
      simulated: trader.is_simulated === 1 || rows.some((r) => r.is_simulated === 1),
      style: trader.style,
      createdAt: trader.created_at,
      pnl30dPct: round(w30.pnlPct),
      pnl30dUsd: round(w30.totalPnlUsd, 2),
      pnlPct: round(total.pnlPct),
      pnlTotalUsd: round(total.totalPnlUsd, 2),
      realizedUsd: round(total.realizedUsd, 2),
      unrealizedUsd: round(total.unrealizedUsd, 2),
      capitalUsd: round(total.capitalUsd, 2),
      winRate: total.winRate === null ? null : round(total.winRate, 4),
      tradeCount: rows.length,
      committedCount: head?.committed_count ?? 0,
      headHash: head?.head_hash ?? null,
      commitTx: head?.commit_tx ?? null,
      keyPrice: trader.key_price_yocto,
      keyPriceNear: fromBaseUnits(trader.key_price_yocto, 24),
      periodDays: trader.period_days,
      lastTradeAt: rows.at(-1)?.settled_at ?? null,
    },
    curve,
  };
}
