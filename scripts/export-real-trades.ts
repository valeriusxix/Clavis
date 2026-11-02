// Phase 4: export the real trader's trades to apps/server/src/demo/real-trades.json so demo mode
// (and the hosted demo) always includes them. Public data only: quotes, statuses, amounts, tx hashes.
// Usage: pnpm export:real
import { writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { loadDotEnv, parseConfig, REPO_ROOT } from "../apps/server/src/config";
import { openDb, Repo, type TradeRow } from "../apps/server/src/db/db";
import { REAL_TRADES_PATH, type RealTradesFile } from "../apps/server/src/demo/seedDb";

loadDotEnv();
const config = parseConfig();
if (!config.REAL_TRADER_ID) throw new Error("Set REAL_TRADER_ID in .env");
const dbPath = isAbsolute(config.DATABASE_PATH) ? config.DATABASE_PATH : resolve(REPO_ROOT, config.DATABASE_PATH);
const repo = new Repo(openDb(dbPath));

const trader = repo.getTrader(config.REAL_TRADER_ID);
if (!trader) throw new Error(`No trader ${config.REAL_TRADER_ID} in ${dbPath}`);
const trades = repo.db
  .prepare(
    `SELECT * FROM trades WHERE trader_id = ? AND is_simulated = 0
       AND status IN ('SUCCESS','REFUNDED','FAILED','INCOMPLETE_DEPOSIT') ORDER BY created_at`,
  )
  .all(trader.account_id) as TradeRow[];
const head = repo.getChainHead(trader.account_id);

const out: RealTradesFile = {
  traders: [{ ...trader, is_simulated: 0 }],
  trades,
  commits: head?.commit_tx ? [{ traderId: trader.account_id, tradeCount: head.committed_count, tx: head.commit_tx }] : [],
};
writeFileSync(REAL_TRADES_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(
  `exported ${trades.length} trades (${trades.filter((t) => t.status === "SUCCESS").length} SUCCESS) for ${trader.account_id} -> ${REAL_TRADES_PATH}`,
);
