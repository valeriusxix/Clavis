import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA_SQL = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");

/** Ordered migrations; index + 1 = schema version. */
const MIGRATIONS: string[] = [
  SCHEMA_SQL,
  // v2 (Phase 4, real trades): the final 1Click status response, where the logged amounts came from
  // ("final" from swapDetails, "quoted" from the quote), and the mainnet account that sent the deposit.
  `ALTER TABLE trades ADD COLUMN status_json TEXT;
   ALTER TABLE trades ADD COLUMN amounts_source TEXT;
   ALTER TABLE trades ADD COLUMN payer TEXT;`,
];
export const SCHEMA_VERSION = MIGRATIONS.length;

/** Open (and create/migrate) the database. Use ":memory:" in tests. */
export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

// ----------------------------------------------------------------------------- rows

export type TraderRow = {
  account_id: string;
  display_name: string;
  is_simulated: number;
  created_at: string;
  key_price_yocto: string;
  period_days: number;
  style: string | null;
};

export type TradeStatus =
  | "QUOTED"
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED"
  | "SIMULATED";

export const SETTLED_STATUSES: readonly TradeStatus[] = ["SUCCESS", "SIMULATED"];
export const TERMINAL_STATUSES: readonly TradeStatus[] = ["SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED", "SIMULATED"];

export type TradeRow = {
  id: string;
  trader_id: string;
  seq: number | null;
  status: TradeStatus;
  is_simulated: number;
  origin_asset: string;
  origin_symbol: string;
  dest_asset: string;
  dest_symbol: string;
  amount_in: string;
  amount_in_formatted: string;
  amount_in_usd: string;
  amount_out: string;
  amount_out_formatted: string;
  amount_out_usd: string;
  confidentiality: "basic" | "advanced" | "simulated";
  deposit_address: string | null;
  deposit_memo: string | null;
  tx_hash: string | null;
  quote_json: string;
  quote_signature: string | null;
  signature_valid: number | null;
  created_at: string;
  settled_at: string | null;
  /** v2: raw final GET /v0/status response (real trades). */
  status_json?: string | null;
  /** v2: "final" (status swapDetails) or "quoted" (quote amounts). */
  amounts_source?: "final" | "quoted" | null;
  /** v2: mainnet account that sent the deposit (real trades). */
  payer?: string | null;
};

const TRADE_COLUMNS = [
  "id", "trader_id", "seq", "status", "is_simulated", "origin_asset", "origin_symbol", "dest_asset", "dest_symbol",
  "amount_in", "amount_in_formatted", "amount_in_usd", "amount_out", "amount_out_formatted", "amount_out_usd",
  "confidentiality", "deposit_address", "deposit_memo", "tx_hash", "quote_json", "quote_signature", "signature_valid",
  "created_at", "settled_at", "status_json", "amounts_source", "payer",
] as const;

export type ChainHeadRow = {
  trader_id: string;
  trade_count: number;
  head_hash: string;
  committed_count: number;
  commit_tx: string | null;
};

// ----------------------------------------------------------------------------- repository

export class Repo {
  constructor(readonly db: DB) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // traders
  upsertTrader(t: TraderRow): void {
    this.db
      .prepare(
        `INSERT INTO traders (account_id, display_name, is_simulated, created_at, key_price_yocto, period_days, style)
         VALUES (@account_id, @display_name, @is_simulated, @created_at, @key_price_yocto, @period_days, @style)
         ON CONFLICT(account_id) DO UPDATE SET display_name=excluded.display_name, is_simulated=excluded.is_simulated,
           key_price_yocto=excluded.key_price_yocto, period_days=excluded.period_days, style=excluded.style`,
      )
      .run(t);
  }
  getTrader(id: string): TraderRow | undefined {
    return this.db.prepare(`SELECT * FROM traders WHERE account_id = ?`).get(id) as TraderRow | undefined;
  }
  listTraders(): TraderRow[] {
    return this.db.prepare(`SELECT * FROM traders ORDER BY account_id`).all() as TraderRow[];
  }

  // trades
  insertTrade(t: TradeRow): void {
    this.db
      .prepare(`INSERT INTO trades (${TRADE_COLUMNS.join(", ")}) VALUES (${TRADE_COLUMNS.map((c) => `@${c}`).join(", ")})`)
      .run({ status_json: null, amounts_source: null, payer: null, ...t });
  }
  getTrade(id: string): TradeRow | undefined {
    return this.db.prepare(`SELECT * FROM trades WHERE id = ?`).get(id) as TradeRow | undefined;
  }
  updateTrade(id: string, patch: Partial<Omit<TradeRow, "id">>): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = @${k}`).join(", ");
    this.db.prepare(`UPDATE trades SET ${set} WHERE id = @id`).run({ ...patch, id });
  }
  /** Settled trades (SUCCESS + SIMULATED) in seq order: the trader's log. */
  settledTrades(traderId: string): TradeRow[] {
    return this.db
      .prepare(`SELECT * FROM trades WHERE trader_id = ? AND seq IS NOT NULL ORDER BY seq`)
      .all(traderId) as TradeRow[];
  }
  /** Every settled trade across all traders (for price history). */
  allSettledTrades(): TradeRow[] {
    return this.db.prepare(`SELECT * FROM trades WHERE seq IS NOT NULL ORDER BY settled_at`).all() as TradeRow[];
  }
  /** Real trades still waiting on 1Click (have a deposit address, not terminal). */
  nonTerminalTrades(): TradeRow[] {
    return this.db
      .prepare(
        `SELECT * FROM trades WHERE status IN ('PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING') AND deposit_address IS NOT NULL`,
      )
      .all() as TradeRow[];
  }
  chainHeads(): ChainHeadRow[] {
    return this.db.prepare(`SELECT * FROM chain_heads`).all() as ChainHeadRow[];
  }
  nextSeq(traderId: string): number {
    const row = this.db.prepare(`SELECT MAX(seq) AS m FROM trades WHERE trader_id = ?`).get(traderId) as { m: number | null };
    return (row.m ?? 0) + 1;
  }
  deleteTradesOf(traderId: string): void {
    this.db.prepare(`DELETE FROM trades WHERE trader_id = ?`).run(traderId);
  }

  // chain heads
  getChainHead(traderId: string): ChainHeadRow | undefined {
    return this.db.prepare(`SELECT * FROM chain_heads WHERE trader_id = ?`).get(traderId) as ChainHeadRow | undefined;
  }
  setChainHead(traderId: string, tradeCount: number, headHash: string): void {
    this.db
      .prepare(
        `INSERT INTO chain_heads (trader_id, trade_count, head_hash) VALUES (?, ?, ?)
         ON CONFLICT(trader_id) DO UPDATE SET trade_count=excluded.trade_count, head_hash=excluded.head_hash`,
      )
      .run(traderId, tradeCount, headHash);
  }
  markCommitted(traderId: string, committedCount: number, commitTx: string): void {
    this.db
      .prepare(`UPDATE chain_heads SET committed_count = ?, commit_tx = ? WHERE trader_id = ?`)
      .run(committedCount, commitTx, traderId);
  }

  // demo access
  grantDemoAccess(traderId: string, holderId: string, expiresAt: string): void {
    this.db
      .prepare(
        `INSERT INTO demo_access (trader_id, holder_id, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(trader_id, holder_id) DO UPDATE SET expires_at=excluded.expires_at`,
      )
      .run(traderId, holderId, expiresAt);
  }
  getDemoAccessExpiry(traderId: string, holderId: string): string | undefined {
    const row = this.db
      .prepare(`SELECT expires_at FROM demo_access WHERE trader_id = ? AND holder_id = ?`)
      .get(traderId, holderId) as { expires_at: string } | undefined;
    return row?.expires_at;
  }
  demoKeysOf(holderId: string): { trader_id: string; expires_at: string }[] {
    return this.db
      .prepare(`SELECT trader_id, expires_at FROM demo_access WHERE holder_id = ? ORDER BY expires_at DESC`)
      .all(holderId) as { trader_id: string; expires_at: string }[];
  }

  // prices
  upsertPrice(assetId: string, symbol: string, price: number, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO prices (asset_id, symbol, price, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET symbol=excluded.symbol, price=excluded.price, updated_at=excluded.updated_at`,
      )
      .run(assetId, symbol, price, updatedAt);
  }
  prices(): { asset_id: string; symbol: string; price: number; updated_at: string }[] {
    return this.db.prepare(`SELECT * FROM prices`).all() as { asset_id: string; symbol: string; price: number; updated_at: string }[];
  }
  insertPricePoints(points: { asset_id: string; t: number; price: number }[]): void {
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO price_history (asset_id, t, price) VALUES (@asset_id, @t, @price)`);
    this.transaction(() => points.forEach((p) => stmt.run(p)));
  }
  priceHistory(): { asset_id: string; t: number; price: number }[] {
    return this.db.prepare(`SELECT * FROM price_history ORDER BY asset_id, t`).all() as { asset_id: string; t: number; price: number }[];
  }
}
