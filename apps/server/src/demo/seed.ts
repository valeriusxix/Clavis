// Deterministic demo seed (AGENT.md section 10.1), seed = 2026.
//
// Determinism matters: the seeded logs are hash-chained and their heads are committed on NEAR
// testnet once (`pnpm seed:chain`). Every machine and every boot must produce byte-identical logs, so:
//   - the timeline is FIXED: 45 days ending SEED_END (not "now"); trades are only revealed once their
//     time has passed, so nothing is ever future-dated;
//   - generation uses only + - * / and integer PRNG ops (no Math.exp/log/pow), which IEEE-754 rounds
//     exactly, so output is identical across JS engines and Node versions;
//   - numbers are stored as fixed-precision strings (toFixed), which is fully specified.
//
// Each trader follows a personality strategy against a seeded random-walk price path. A single small
// "execution edge" per trader (fill prices slightly better or worse than the hourly path, like limit
// orders inside the hour) is then binary-searched so total PnL lands on the outcome AGENT.md asks for.
// Every fill still loses the 0.2% swap fee in USD terms, like a real swap.
import { computePnl, type PnlTrade } from "../pnl/engine";

export const SEED = 2026;
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const SEED_END = Date.UTC(2026, 10, 11); // 2026-11-11T00:00:00Z
export const SEED_DAYS = 45;
export const SEED_START = SEED_END - SEED_DAYS * DAY;
const HOURS = SEED_DAYS * 24;
/** 1Click-like swap fee applied to every simulated fill. */
const FEE = 0.002;
/** Seeded traders are testnet subaccounts of the Clavis contract account (registered by seed:chain). */
export const SEED_PARENT = "clavis-app.testnet";
/** <handle>[-<version>].<parent>. A new version means fresh accounts (docs/DECISIONS.md, "Re-seeding"). */
export type SeedAccounts = { parent: string; version?: string };
export const DEFAULT_SEED_ACCOUNTS: SeedAccounts = { parent: SEED_PARENT };
export const simTraderId = (handle: string, accounts: SeedAccounts = DEFAULT_SEED_ACCOUNTS) =>
  `${handle}${accounts.version ? `-${accounts.version}` : ""}.${accounts.parent}`;

export type AssetKey = "NEAR" | "BTC" | "ETH" | "SOL" | "ZEC" | "USDC";

/**
 * Real 1Click assets. startPrice = path start, not a live price.
 * NEAR/USDC: seen in live GET /v0/tokens (2026-11-01). BTC/ETH: docs "Making a Request" example.
 * SOL/ZEC: 1Click was down (HTTP 521) on 2026-11-02, so verified via ft_metadata of the token contracts
 * on NEAR mainnet (sol.omft.near: SOL/9, zec.omft.near: ZEC/8); re-confirm against /v0/tokens.
 */
export const SEED_ASSETS: Record<AssetKey, { assetId: string; symbol: string; decimals: number; startPrice: number }> = {
  NEAR: { assetId: "nep141:wrap.near", symbol: "wNEAR", decimals: 24, startPrice: 3.6 },
  BTC: { assetId: "nep141:btc.omft.near", symbol: "BTC", decimals: 8, startPrice: 104_000 },
  ETH: { assetId: "nep141:eth.omft.near", symbol: "ETH", decimals: 18, startPrice: 3_900 },
  SOL: { assetId: "nep141:sol.omft.near", symbol: "SOL", decimals: 9, startPrice: 190 },
  ZEC: { assetId: "nep141:zec.omft.near", symbol: "ZEC", decimals: 8, startPrice: 260 },
  USDC: {
    assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    symbol: "USDC",
    decimals: 6,
    startPrice: 1,
  },
};
export const STABLE_KEYS: ReadonlySet<AssetKey> = new Set(["USDC"]);

// ----------------------------------------------------------------------------- PRNG (integer ops only)

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately standard normal: Irwin-Hall sum of 12 uniforms minus 6 (additions only). */
function gauss(rng: () => number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng();
  return s - 6;
}

// ----------------------------------------------------------------------------- price paths

/** Per-asset market story: [fromDay, drift per hour]. Volatility per hour. */
const REGIMES: Record<Exclude<AssetKey, "USDC">, { vol: number; drift: [number, number][] }> = {
  // steady grind up with a mid-window pullback
  BTC: { vol: 0.0035, drift: [[0, 0.00022], [18, -0.0001], [25, 0.00033]] },
  ETH: { vol: 0.0045, drift: [[0, 0.0001], [18, -0.0002], [25, 0.00026]] },
  // choppy, slightly down
  SOL: { vol: 0.006, drift: [[0, 0.0001], [12, -0.00025], [30, 0.00008]] },
  // pump then dump (degen-dora's nightmare)
  NEAR: { vol: 0.006, drift: [[0, 0], [14, 0.0012], [20, -0.001], [30, 0.0001]] },
  // dips, then a strong run (zec-maxi's dream)
  ZEC: { vol: 0.007, drift: [[0, -0.0004], [10, 0.0006], [22, -0.0005], [27, 0.0009]] },
};

export type PricePaths = Record<AssetKey, Float64Array>;

export function buildPricePaths(seed = SEED): PricePaths {
  const rng = mulberry32(seed);
  const paths = {} as PricePaths;
  for (const key of ["NEAR", "BTC", "ETH", "SOL", "ZEC"] as const) {
    const { vol, drift } = REGIMES[key];
    const path = new Float64Array(HOURS + 1);
    path[0] = SEED_ASSETS[key].startPrice;
    let r = 0;
    for (let h = 1; h <= HOURS; h++) {
      const day = (h / 24) | 0;
      while (r + 1 < drift.length && day >= drift[r + 1]![0]) r++;
      const step = 1 + drift[r]![1] + vol * gauss(rng);
      path[h] = path[h - 1]! * (step > 0.5 ? step : 0.5);
    }
    paths[key] = path;
  }
  paths.USDC = new Float64Array(HOURS + 1).fill(1);
  return paths;
}

export function hourIndex(t: number): number {
  const h = Math.floor((t - SEED_START) / HOUR);
  return h < 0 ? 0 : h > HOURS ? HOURS : h;
}
export const hourTime = (h: number) => SEED_START + h * HOUR;
export const pathPrice = (paths: PricePaths, key: AssetKey, t: number) => paths[key][hourIndex(t)]!;

// ----------------------------------------------------------------------------- strategies

/** What a strategy decides; how much is resolved against the simulated wallet at fill time. */
type Intent = { h: number; sell: AssetKey; buy: AssetKey; size: { usd: number } | { fraction: number } };

export type SimFill = {
  t: number;
  sell: AssetKey;
  buy: AssetKey;
  qIn: string; // human units, fixed precision
  qOut: string;
  vIn: string; // USD, fixed precision
  vOut: string;
};

const QTY_DP = 8; // max human-unit precision stored for quantities
/** Quantity precision per asset: never more decimals than the token has. */
const dp = (k: AssetKey) => Math.min(QTY_DP, SEED_ASSETS[k].decimals);
const USD_DP = 6;

/**
 * Fill price vs. the hourly path: sells fill slightly above it and buys slightly below by `edge`
 * (positive = skilful limit-style fills inside the hour, negative = sloppy fills). Stablecoins are 1.
 */
function execPrice(paths: PricePaths, key: AssetKey, h: number, side: "sell" | "buy", edge: number): number {
  if (STABLE_KEYS.has(key)) return 1;
  return paths[key][h]! * (side === "sell" ? 1 + edge : 1 - edge);
}

/**
 * Execute intents against a wallet. Every fill loses the swap fee in USD terms (vOut = vIn * (1 - fee)),
 * like a real 1Click swap; skill shows up only as better or worse fill prices.
 */
function fill(intents: Intent[], paths: PricePaths, startUsdc: number, edge: number): SimFill[] {
  const wallet = new Map<AssetKey, number>([["USDC", startUsdc]]);
  const fills: SimFill[] = [];
  for (const it of [...intents].sort((a, b) => a.h - b.h)) {
    const t = hourTime(it.h);
    const pSell = execPrice(paths, it.sell, it.h, "sell", edge);
    const pBuy = execPrice(paths, it.buy, it.h, "buy", edge);
    const have = wallet.get(it.sell) ?? 0;
    let qIn = "usd" in it.size ? it.size.usd / pSell : have * it.size.fraction;
    if (qIn > have) qIn = have;
    const qInS = qIn.toFixed(dp(it.sell));
    qIn = Number(qInS);
    if (!(qIn > 0)) continue;
    const vIn = Number((qIn * pSell).toFixed(USD_DP));
    if (vIn < 1) continue; // dust
    const vOut = Number((vIn * (1 - FEE)).toFixed(USD_DP));
    const qOut = Number((vOut / pBuy).toFixed(dp(it.buy)));
    wallet.set(it.sell, Number((have - qIn).toFixed(dp(it.sell))));
    wallet.set(it.buy, Number(((wallet.get(it.buy) ?? 0) + qOut).toFixed(dp(it.buy))));
    fills.push({
      t,
      sell: it.sell,
      buy: it.buy,
      qIn: qInS,
      qOut: qOut.toFixed(dp(it.buy)),
      vIn: vIn.toFixed(USD_DP),
      vOut: vOut.toFixed(USD_DP),
    });
  }
  return fills;
}

const argMin = (path: Float64Array, from: number, to: number) => {
  let best = from;
  for (let h = from; h <= to; h++) if (path[h]! < path[best]!) best = h;
  return best;
};
const argMax = (path: Float64Array, from: number, to: number) => {
  let best = from;
  for (let h = from; h <= to; h++) if (path[h]! > path[best]!) best = h;
  return best;
};
const clampH = (h: number) => (h < 0 ? 0 : h > HOURS ? HOURS : h);

/** quiet-whale: few large swing trades in BTC/ETH/SOL; buys near lows, sells near highs. */
function quietWhale(paths: PricePaths, rng: () => number): Intent[] {
  const intents: Intent[] = [];
  const assets: AssetKey[] = ["SOL", "ETH", "BTC", "SOL", "ETH"];
  const swings = 14;
  const seg = Math.floor(HOURS / swings);
  for (let i = 0; i < swings; i++) {
    const a = assets[i % assets.length]!;
    const start = i * seg;
    const mid = start + Math.floor(seg / 2);
    // Most swings buy near the low and sell near the high; about one in ten is mistimed (buys high, sells low).
    const miss = rng() < 0.1;
    const end = start + seg - 2;
    // good swing: buy near the segment low, sell near the best price after it; miss: the reverse
    const buyH = clampH((miss ? argMax(paths[a], start, mid) : argMin(paths[a], start, end - 12)) + Math.floor(rng() * 4));
    const sellH = clampH((miss ? argMin(paths[a], mid, end) : argMax(paths[a], Math.min(buyH + 6, end), end)) - Math.floor(rng() * 4));
    if (sellH <= buyH) continue;
    intents.push({ h: buyH, sell: "USDC", buy: a, size: { fraction: 0.92 + rng() * 0.08 } });
    intents.push({ h: sellH, sell: a, buy: "USDC", size: { fraction: 1 } });
  }
  return intents;
}

/** zec-maxi: rotates into ZEC on dips, trims into strength, parks some in NEAR. */
function zecMaxi(paths: PricePaths, rng: () => number): Intent[] {
  const intents: Intent[] = [];
  const zec = paths.ZEC;
  let lastBuy = -999;
  for (let h = 24; h < HOURS - 1 && intents.length < 36; h += 6) {
    const high = zec[argMax(zec, Math.max(0, h - 72), h)]!;
    if (zec[h]! < high * 0.965 && h - lastBuy > 30) {
      intents.push({ h, sell: "USDC", buy: "ZEC", size: { fraction: 0.75 + rng() * 0.2 } });
      const exit = clampH(argMax(zec, h + 12, Math.min(HOURS, h + 120)));
      intents.push({ h: exit, sell: "ZEC", buy: rng() < 0.12 ? "NEAR" : "USDC", size: { fraction: 0.6 + rng() * 0.4 } });
      lastBuy = h;
    }
  }
  // close any NEAR side positions back to USDC near the end of each week
  for (let w = 1; w <= 6; w++) intents.push({ h: clampH(w * 168 - 3), sell: "NEAR", buy: "USDC", size: { fraction: 1 } });
  return intents;
}

/** scalp-sensei: many small round trips with tight take-profits; most of them win. */
function scalpSensei(paths: PricePaths, rng: () => number): Intent[] {
  const intents: Intent[] = [];
  const assets: AssetKey[] = ["NEAR", "SOL", "ETH", "BTC"];
  let h = 6;
  while (h < HOURS - 60 && intents.length < 60) {
    const a = assets[Math.floor(rng() * assets.length)]!;
    const p = paths[a];
    const entry = h;
    let exit = Math.min(HOURS, entry + 36); // time stop
    for (let k = entry + 1; k <= Math.min(HOURS, entry + 36); k++) {
      if (p[k]! >= p[entry]! * 1.009) {
        exit = k;
        break;
      }
    }
    intents.push({ h: entry, sell: "USDC", buy: a, size: { usd: 1500 + Math.floor(rng() * 1500) } });
    intents.push({ h: exit, sell: a, buy: "USDC", size: { fraction: 1 } });
    h = exit + 2 + Math.floor(rng() * 10);
  }
  return intents;
}

/** degen-dora: chases pumps (buys after a big 24h move), sells late on the way down. */
function degenDora(paths: PricePaths, rng: () => number): Intent[] {
  const intents: Intent[] = [];
  const assets: AssetKey[] = ["NEAR", "SOL", "ZEC", "NEAR"];
  let h = 30;
  while (h < HOURS - 30 && intents.length < 46) {
    const a = assets[Math.floor(rng() * assets.length)]!;
    const p = paths[a];
    if (p[h]! > p[h - 24]! * 1.025) {
      const entry = clampH(h + 2 + Math.floor(rng() * 4)); // late
      const exit = clampH(argMin(p, entry + 6, Math.min(HOURS, entry + 60)) + Math.floor(rng() * 3)); // panics near lows
      intents.push({ h: entry, sell: "USDC", buy: a, size: { fraction: 0.5 + rng() * 0.4 } });
      intents.push({ h: exit, sell: a, buy: "USDC", size: { fraction: 1 } });
      h = exit + 6;
    } else {
      h += 3;
    }
  }
  return intents;
}

/** steady-eddie: twice-weekly BTC/ETH DCA with a small rebalance now and then. */
function steadyEddie(_paths: PricePaths, rng: () => number): Intent[] {
  const intents: Intent[] = [];
  for (let i = 0; i < 13; i++) {
    const h = clampH(12 + i * 84 + Math.floor(rng() * 4)); // every 3.5 days
    intents.push({ h, sell: "USDC", buy: "BTC", size: { usd: 450 } });
    intents.push({ h: clampH(h + 1), sell: "USDC", buy: "ETH", size: { usd: 750 } });
  }
  intents.push({ h: clampH(HOURS - 48), sell: "ETH", buy: "USDC", size: { fraction: 0.25 } });
  return intents;
}

// ----------------------------------------------------------------------------- traders

export type SeedTraderSpec = {
  handle: string;
  style: string;
  /** Target total PnL % from AGENT.md 10.1. */
  targetPct: number;
  startUsdc: number;
  keyPriceNear: string; // decimal NEAR, e.g. "1.5"
  createdDaysBeforeStart: number;
  strategy: (paths: PricePaths, rng: () => number) => Intent[];
};

export const SEED_TRADERS: SeedTraderSpec[] = [
  { handle: "quiet-whale", style: "few large swing trades", targetPct: 0.38, startUsdc: 250_000, keyPriceNear: "5", createdDaysBeforeStart: 20, strategy: quietWhale },
  { handle: "zec-maxi", style: "rotates into ZEC on dips", targetPct: 0.21, startUsdc: 40_000, keyPriceNear: "2", createdDaysBeforeStart: 12, strategy: zecMaxi },
  { handle: "scalp-sensei", style: "many small trades", targetPct: 0.07, startUsdc: 10_000, keyPriceNear: "1", createdDaysBeforeStart: 9, strategy: scalpSensei },
  { handle: "degen-dora", style: "chases pumps", targetPct: -0.14, startUsdc: 15_000, keyPriceNear: "0.5", createdDaysBeforeStart: 6, strategy: degenDora },
  { handle: "steady-eddie", style: "twice-weekly BTC/ETH DCA", targetPct: 0.11, startUsdc: 20_000, keyPriceNear: "1", createdDaysBeforeStart: 30, strategy: steadyEddie },
];

const isStableKey = (a: string) => STABLE_KEYS.has(a as AssetKey);

export function fillsToPnlTrades(fills: SimFill[]): PnlTrade[] {
  return fills.map((f) => ({
    t: f.t,
    sell: f.sell,
    qIn: Number(f.qIn),
    vIn: Number(f.vIn),
    buy: f.buy,
    qOut: Number(f.qOut),
    vOut: Number(f.vOut),
  }));
}

export function pnlOfFills(fills: SimFill[], paths: PricePaths) {
  return computePnl(fillsToPnlTrades(fills), {
    isStable: isStableKey,
    priceAt: (a, t) => pathPrice(paths, a as AssetKey, t),
    asOf: SEED_END,
  });
}

export type SeededTrader = SeedTraderSpec & { traderId: string; edge: number; fills: SimFill[]; pnlPct: number };

/** Generate all seeded traders (full timeline, before the "reveal up to now" filter). */
export function generateSeed(paths = buildPricePaths(), accounts: SeedAccounts = DEFAULT_SEED_ACCOUNTS): SeededTrader[] {
  return SEED_TRADERS.map((spec, i) => {
    const intents = spec.strategy(paths, mulberry32(SEED * 1000 + i + 1));
    // Binary-search the execution edge so total PnL% hits the target (monotonic in edge).
    let lo = -0.05;
    let hi = 0.05;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      const pct = pnlOfFills(fill(intents, paths, spec.startUsdc, mid), paths).pnlPct;
      if (pct < spec.targetPct) lo = mid;
      else hi = mid;
    }
    const edge = Number(((lo + hi) / 2).toFixed(6));
    const fills = fill(intents, paths, spec.startUsdc, edge);
    return { ...spec, traderId: simTraderId(spec.handle, accounts), edge, fills, pnlPct: pnlOfFills(fills, paths).pnlPct };
  });
}
