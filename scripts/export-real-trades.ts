// Phase 4: export the real trader's trades to apps/server/src/demo/real-trades.json so demo mode
// (and the hosted demo) always includes them. Full public data on purpose: quotes, statuses,
// amounts, tx hashes (AUDIT H5). Only trades of REAL_TRADER_MAINNET_ACCOUNT (the separate dev
// account) are exported; any other account stops the export. The file is seed data only.
// Usage: pnpm export:real
import { writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { loadDotEnv, parseConfig, REPO_ROOT } from "../apps/server/src/config";
import { openDb, Repo } from "../apps/server/src/db/db";
import { buildRealExport } from "../apps/server/src/demo/realExport";
import { REAL_TRADES_PATH } from "../apps/server/src/demo/seedDb";

loadDotEnv();
const config = parseConfig();
if (!config.REAL_TRADER_ID) throw new Error("Set REAL_TRADER_ID in .env");
if (!config.REAL_TRADER_MAINNET_ACCOUNT) throw new Error("Set REAL_TRADER_MAINNET_ACCOUNT (the separate dev account) in .env");
const dbPath = isAbsolute(config.DATABASE_PATH) ? config.DATABASE_PATH : resolve(REPO_ROOT, config.DATABASE_PATH);
const repo = new Repo(openDb(dbPath));

const { accounts, ...file } = buildRealExport(repo, config.REAL_TRADER_ID, config.REAL_TRADER_MAINNET_ACCOUNT);
writeFileSync(REAL_TRADES_PATH, JSON.stringify(file, null, 2) + "\n");
console.log(
  `exported ${file.trades.length} trades (${file.trades.filter((t) => t.status === "SUCCESS").length} SUCCESS) for ${config.REAL_TRADER_ID} -> ${REAL_TRADES_PATH}`,
);
console.log(`mainnet accounts in the file: ${accounts.length ? accounts.join(", ") : "(none)"}`);
