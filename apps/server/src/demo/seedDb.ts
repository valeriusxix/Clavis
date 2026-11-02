import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Repo, TradeRow, TraderRow } from "../db/db";
import { refreshChainHead } from "../chain/log";
import { toBaseUnits, trimDecimal } from "../lib/units";
import {
  buildPricePaths,
  DEFAULT_SEED_ACCOUNTS,
  generateSeed,
  hourTime,
  SEED_ASSETS,
  SEED_DAYS,
  SEED_START,
  type AssetKey,
  type SeedAccounts,
  type SeededTrader,
  type SimFill,
} from "./seed";

export const REAL_TRADES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "real-trades.json");
/** Written by `pnpm seed:chain`: the seeded traders' testnet accounts and registration transactions. */
export const SEED_CHAIN_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "seed-chain.json");

export type SeedChainFile = {
  network: "testnet";
  contractId: string;
  parent: string;
  version: string | null;
  traders: { handle: string; accountId: string; publicKey: string; registerTx: string | null }[];
};

/** accountId -> registration tx, from seed-chain.json (empty when the file does not exist). */
export function loadSeedRegistrations(path = SEED_CHAIN_PATH): Map<string, string> {
  if (!existsSync(path)) return new Map();
  const file = JSON.parse(readFileSync(path, "utf8")) as SeedChainFile;
  return new Map(file.traders.flatMap((t) => (t.registerTx ? [[t.accountId, t.registerTx] as const] : [])));
}

/** Shape of apps/server/src/demo/real-trades.json (written in Phase 4; public quote data only). */
export type RealTradesFile = {
  traders: TraderRow[];
  trades: TradeRow[];
  /** commit_log transactions for these traders' heads (for explorer links). */
  commits?: { traderId: string; tradeCount: number; tx: string }[];
};

function fillToRow(trader: SeededTrader, fill: SimFill, seq: number): TradeRow {
  const o = SEED_ASSETS[fill.sell];
  const d = SEED_ASSETS[fill.buy];
  const at = new Date(fill.t).toISOString();
  return {
    id: `sim-${trader.handle}-${seq}`,
    trader_id: trader.traderId,
    seq,
    status: "SIMULATED",
    is_simulated: 1,
    origin_asset: o.assetId,
    origin_symbol: o.symbol,
    dest_asset: d.assetId,
    dest_symbol: d.symbol,
    amount_in: toBaseUnits(fill.qIn, o.decimals),
    amount_in_formatted: trimDecimal(fill.qIn),
    amount_in_usd: fill.vIn,
    amount_out: toBaseUnits(fill.qOut, d.decimals),
    amount_out_formatted: trimDecimal(fill.qOut),
    amount_out_usd: fill.vOut,
    confidentiality: "simulated",
    deposit_address: null,
    deposit_memo: null,
    tx_hash: null,
    quote_json: "{}",
    quote_signature: null,
    signature_valid: null,
    created_at: at,
    settled_at: at,
  };
}

export type SeedSummary = { traders: number; trades: number; realTrades: number };

/**
 * (Re)seed demo data. Deletes and rebuilds all SIMULATED traders and their trades, the demo
 * viewer's simulated profile, and demo key purchases. Only trades whose time has passed (`now`) are
 * inserted, so the seeded logs grow deterministically and nothing is future-dated.
 */
export async function seedDatabase(
  repo: Repo,
  now: number,
  realTradesPath = REAL_TRADES_PATH,
  accounts: SeedAccounts = DEFAULT_SEED_ACCOUNTS,
): Promise<SeedSummary> {
  const paths = buildPricePaths();
  const seeded = generateSeed(paths, accounts);
  let trades = 0;

  repo.transaction(() => {
    repo.db.exec(`DELETE FROM demo_access`);
    repo.db.exec(`DELETE FROM trades WHERE is_simulated = 1`);
    repo.db.exec(`DELETE FROM chain_heads WHERE trader_id IN (SELECT account_id FROM traders WHERE is_simulated = 1)`);
    repo.db.exec(`DELETE FROM traders WHERE is_simulated = 1`);

    for (const t of seeded) {
      repo.upsertTrader({
        account_id: t.traderId,
        display_name: t.handle,
        is_simulated: 1,
        created_at: new Date(SEED_START - t.createdDaysBeforeStart * 86_400_000).toISOString(),
        key_price_yocto: toBaseUnits(t.keyPriceNear, 24),
        period_days: 30,
        style: t.style,
      });
      t.fills
        .filter((f) => f.t <= now)
        .forEach((f, i) => {
          repo.insertTrade(fillToRow(t, f, i + 1));
          trades++;
        });
    }

    // Each demo visitor's own SIMULATED profile is created on their first quote (AUDIT M3).

    // Seed price path, every 6 hours, for equity curves and marks of SIMULATED traders.
    const points: { asset_id: string; t: number; price: number }[] = [];
    for (const key of Object.keys(SEED_ASSETS) as AssetKey[]) {
      for (let h = 0; h <= SEED_DAYS * 24; h += 6) {
        points.push({ asset_id: SEED_ASSETS[key].assetId, t: hourTime(h), price: paths[key][h]! });
      }
    }
    repo.db.exec(`DELETE FROM price_history`);
    repo.insertPricePoints(points);
  });

  let realTrades = 0;
  if (existsSync(realTradesPath)) {
    const real = JSON.parse(readFileSync(realTradesPath, "utf8")) as RealTradesFile;
    repo.transaction(() => {
      for (const tr of real.traders) repo.upsertTrader({ ...tr, is_simulated: 0 });
      for (const row of real.trades) {
        if (!repo.getTrade(row.id)) {
          repo.insertTrade({ ...row, is_simulated: 0 });
          realTrades++;
        }
      }
    });
  }

  for (const tr of repo.listTraders()) await refreshChainHead(repo, tr.account_id);
  if (existsSync(realTradesPath)) {
    const real = JSON.parse(readFileSync(realTradesPath, "utf8")) as RealTradesFile;
    for (const c of real.commits ?? []) {
      const head = repo.getChainHead(c.traderId);
      if (head && head.trade_count >= c.tradeCount && head.committed_count < c.tradeCount) repo.markCommitted(c.traderId, c.tradeCount, c.tx);
    }
  }
  return { traders: seeded.length, trades, realTrades };
}
