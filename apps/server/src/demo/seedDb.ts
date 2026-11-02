import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Repo, TradeRow, TraderRow } from "../db/db";
import { refreshChainHead } from "../chain/log";
import { toBaseUnits, trimDecimal } from "../lib/units";
import {
  buildPricePaths,
  generateSeed,
  hourTime,
  SEED_ASSETS,
  SEED_DAYS,
  SEED_START,
  type AssetKey,
  type SeededTrader,
  type SimFill,
} from "./seed";

export const DEMO_VIEWER = "demo-viewer";
export const REAL_TRADES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "real-trades.json");

/** Shape of apps/server/src/demo/real-trades.json (written in Phase 4; public quote data only). */
export type RealTradesFile = { traders: TraderRow[]; trades: TradeRow[] };

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
export async function seedDatabase(repo: Repo, now: number, realTradesPath = REAL_TRADES_PATH): Promise<SeedSummary> {
  const paths = buildPricePaths();
  const seeded = generateSeed(paths);
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

    // The demo viewer's own (SIMULATED) trader profile, where "Simulate fill" records trades.
    repo.upsertTrader({
      account_id: DEMO_VIEWER,
      display_name: DEMO_VIEWER,
      is_simulated: 1,
      created_at: new Date(now).toISOString(),
      key_price_yocto: "0",
      period_days: 30,
      style: "your demo profile",
    });

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
  return { traders: seeded.length, trades, realTrades };
}
