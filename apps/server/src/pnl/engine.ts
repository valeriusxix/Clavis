// PnL engine (AGENT.md section 9). Pure functions, no I/O. All values in USD, quantities in human
// units (base units / 10^decimals; the caller converts).
//
// For each trade: sell qIn of X (worth vIn at execution), receive qOut of Y (worth vOut).
//   X disposed:  cost = avgCost[X] * qIn if X has a cost basis, else vIn ("funding")
//                realized += vOut - cost; holdings[X] -= qIn; costBasis[X] -= cost (floors at 0)
//   Y acquired:  holdings[Y] += qOut; costBasis[Y] += vOut
//   unrealized = Σ (holdings[a] * price[a] - costBasis[a]); stablecoins have price 1 and no unrealized
//   capital    = peak Σ costBasis over time (min $1); pnlPct = totalPnL / capital
//
// Refinements where section 9 is silent (documented in docs/DECISIONS.md):
//   - Over-selling (qIn > holdings): the held part costs avgCost, the excess costs the trade's own
//     unit price vIn/qIn. Equals the spec in both cases it defines (held = 0 -> vIn; qIn <= held).
//   - Win rate counts only disposals that CLOSE a position: the disposed asset is not a stablecoin
//     and had a cost basis. Buying with stablecoins or a funding sale is not a "sell" for win rate,
//     though its fees/slippage still count in realized PnL.
//   - pnl30d re-runs the same calc over the last 30 days, starting from the day -30 holdings marked
//     to market at day -30 prices (that mark becomes the starting cost basis).

export type PnlTrade = {
  /** Settlement time, ms since epoch. */
  t: number;
  sell: string;
  qIn: number;
  vIn: number;
  buy: string;
  qOut: number;
  vOut: number;
};

/** Historical USD price of an asset at time t (ms), or undefined if unknown. */
export type PriceAt = (assetId: string, t: number) => number | undefined;

export type PnlOptions = {
  isStable: (assetId: string) => boolean;
  /** Price used to mark holdings "now" (or at `asOf`). */
  priceAt: PriceAt;
  /** Mark-to-market time (ms). Defaults to the last trade time. */
  asOf?: number;
};

export type Position = { qty: number; costBasis: number };

export type PnlResult = {
  tradeCount: number;
  realizedUsd: number;
  unrealizedUsd: number;
  totalPnlUsd: number;
  capitalUsd: number;
  pnlPct: number;
  wins: number;
  closes: number;
  /** wins / closes, or null when nothing was closed yet. */
  winRate: number | null;
  positions: Record<string, Position>;
};

export type EquityPoint = { t: number; equityUsd: number };

const EPS = 1e-12;

type State = {
  positions: Map<string, Position>;
  realized: number;
  wins: number;
  closes: number;
  peakCapital: number;
};

function newState(initial?: Map<string, Position>): State {
  const positions = new Map<string, Position>();
  for (const [a, p] of initial ?? []) positions.set(a, { ...p });
  const s: State = { positions, realized: 0, wins: 0, closes: 0, peakCapital: 0 };
  s.peakCapital = totalCostBasis(s);
  return s;
}

function totalCostBasis(s: State): number {
  let sum = 0;
  for (const p of s.positions.values()) sum += p.costBasis;
  return sum;
}

function applyTrade(s: State, tr: PnlTrade, isStable: (a: string) => boolean): void {
  // --- dispose X
  const x = s.positions.get(tr.sell) ?? { qty: 0, costBasis: 0 };
  const held = Math.max(0, x.qty);
  const hasBasis = held > EPS && x.costBasis > EPS;
  let cost: number;
  if (!hasBasis) {
    cost = tr.vIn; // first time we see X = funding
  } else if (tr.qIn <= held) {
    cost = (x.costBasis / held) * tr.qIn;
  } else {
    const unit = tr.qIn > 0 ? tr.vIn / tr.qIn : 0;
    cost = x.costBasis + unit * (tr.qIn - held);
  }
  const pnl = tr.vOut - cost;
  s.realized += pnl;
  if (hasBasis && !isStable(tr.sell)) {
    s.closes += 1;
    if (pnl > 0) s.wins += 1;
  }
  x.qty = Math.max(0, x.qty - tr.qIn);
  x.costBasis = Math.max(0, x.costBasis - cost);
  if (x.qty <= EPS) {
    x.qty = 0;
    x.costBasis = 0;
  }
  s.positions.set(tr.sell, x);

  // --- acquire Y
  const y = s.positions.get(tr.buy) ?? { qty: 0, costBasis: 0 };
  y.qty += tr.qOut;
  y.costBasis += tr.vOut;
  s.positions.set(tr.buy, y);

  s.peakCapital = Math.max(s.peakCapital, totalCostBasis(s));
}

function unrealizedAt(s: State, t: number, opts: Pick<PnlOptions, "isStable" | "priceAt">): number {
  let u = 0;
  for (const [asset, p] of s.positions) {
    if (p.qty <= EPS || opts.isStable(asset)) continue; // stablecoins: price 1, no unrealized PnL
    const price = opts.priceAt(asset, t);
    if (price === undefined) continue; // unknown price: carry at cost
    u += p.qty * price - p.costBasis;
  }
  return u;
}

function toResult(s: State, tradeCount: number, unrealized: number): PnlResult {
  const capital = Math.max(1, s.peakCapital);
  const total = s.realized + unrealized;
  return {
    tradeCount,
    realizedUsd: s.realized,
    unrealizedUsd: unrealized,
    totalPnlUsd: total,
    capitalUsd: capital,
    pnlPct: total / capital,
    wins: s.wins,
    closes: s.closes,
    winRate: s.closes > 0 ? s.wins / s.closes : null,
    positions: Object.fromEntries([...s.positions].filter(([, p]) => p.qty > EPS).map(([a, p]) => [a, { ...p }])),
  };
}

function sortByTime(trades: readonly PnlTrade[]): PnlTrade[] {
  return [...trades].sort((a, b) => a.t - b.t);
}

/** Full-history PnL. Trades should be in seq order; they are re-sorted by time defensively. */
export function computePnl(
  trades: readonly PnlTrade[],
  opts: PnlOptions,
  initial?: Map<string, Position>,
): PnlResult {
  const sorted = sortByTime(trades);
  const s = newState(initial);
  for (const tr of sorted) applyTrade(s, tr, opts.isStable);
  const asOf = opts.asOf ?? sorted.at(-1)?.t ?? 0;
  return toResult(s, sorted.length, unrealizedAt(s, asOf, opts));
}

/** Positions after all trades with t < cutoff. */
export function positionsBefore(
  trades: readonly PnlTrade[],
  cutoff: number,
  isStable: (a: string) => boolean,
): Map<string, Position> {
  const s = newState();
  for (const tr of sortByTime(trades)) {
    if (tr.t >= cutoff) break;
    applyTrade(s, tr, isStable);
  }
  return s.positions;
}

/**
 * PnL over the window [now - days, now]: the same calc, starting from the holdings at the window
 * start marked to market at that time (that mark is the starting cost basis).
 */
export function computeWindowPnl(
  trades: readonly PnlTrade[],
  opts: PnlOptions & { now: number; days?: number },
): PnlResult {
  const start = opts.now - (opts.days ?? 30) * 86_400_000;
  const before = positionsBefore(trades, start, opts.isStable);
  const rebased = new Map<string, Position>();
  for (const [asset, p] of before) {
    if (p.qty <= EPS) continue;
    const mark = opts.isStable(asset) ? 1 : opts.priceAt(asset, start);
    rebased.set(asset, { qty: p.qty, costBasis: mark === undefined ? p.costBasis : p.qty * mark });
  }
  const inWindow = trades.filter((tr) => tr.t >= start && tr.t <= opts.now);
  return computePnl(inWindow, { ...opts, asOf: opts.now }, rebased);
}

/** Daily equity (realized + unrealized) at the end of each UTC day, from the first trade to `now`. */
export function equityCurve(
  trades: readonly PnlTrade[],
  opts: PnlOptions & { now: number },
): EquityPoint[] {
  const sorted = sortByTime(trades);
  if (sorted.length === 0) return [];
  const DAY = 86_400_000;
  const firstDay = Math.floor(sorted[0]!.t / DAY) * DAY;
  const s = newState();
  const points: EquityPoint[] = [];
  let i = 0;
  for (let dayStart = firstDay; dayStart <= opts.now; dayStart += DAY) {
    const dayEnd = Math.min(dayStart + DAY - 1, opts.now);
    while (i < sorted.length && sorted[i]!.t <= dayEnd) applyTrade(s, sorted[i++]!, opts.isStable);
    points.push({ t: dayEnd, equityUsd: s.realized + unrealizedAt(s, dayEnd, opts) });
  }
  return points;
}

/**
 * Price history from trade records: each trade implies a unit price for both legs (v / q).
 * priceAt returns the latest implied price at or before t, else the earliest known one.
 * `latest` (e.g. the live /v0/tokens price) overrides for t >= latestAt.
 */
export function priceHistoryFromTrades(
  trades: readonly PnlTrade[],
  latest?: { prices: Record<string, number>; at: number },
): PriceAt {
  const series = new Map<string, { t: number; p: number }[]>();
  const push = (a: string, t: number, p: number) => {
    if (!Number.isFinite(p) || p <= 0) return;
    const arr = series.get(a) ?? [];
    arr.push({ t, p });
    series.set(a, arr);
  };
  for (const tr of trades) {
    if (tr.qIn > 0) push(tr.sell, tr.t, tr.vIn / tr.qIn);
    if (tr.qOut > 0) push(tr.buy, tr.t, tr.vOut / tr.qOut);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.t - b.t);
  return (asset, t) => {
    if (latest && t >= latest.at && latest.prices[asset] !== undefined) return latest.prices[asset];
    const arr = series.get(asset);
    if (!arr || arr.length === 0) return latest?.prices[asset];
    let lo = 0;
    let hi = arr.length - 1;
    if (t < arr[0]!.t) return arr[0]!.p;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]!.t <= t) lo = mid;
      else hi = mid - 1;
    }
    return arr[lo]!.p;
  };
}
