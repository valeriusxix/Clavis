import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { buildApp } from "./app";
import { makeNearVerifier } from "./auth/nep413";
import { Committer, makeNearCommit } from "./chain/committer";
import { DEFAULT_RPC, makeViewFn } from "./chain/nearView";
import { StatusPoller } from "./jobs/statusPoller";
import { loadDotEnv, parseConfig, REPO_ROOT, seedAccountsOf } from "./config";
import { openDb, Repo } from "./db/db";
import { purgeExpiredDemoData } from "./demo/demoAccounts";
import { loadSeedRegistrations, seedDatabase } from "./demo/seedDb";
import { OneClickClient } from "./oneclick/client";
import { TokenCache } from "./oneclick/tokens";

loadDotEnv();
const config = parseConfig();

const dbPath = isAbsolute(config.DATABASE_PATH) ? config.DATABASE_PATH : resolve(REPO_ROOT, config.DATABASE_PATH);
const repo = new Repo(openDb(dbPath));
const oneclick = new OneClickClient({ baseUrl: config.ONECLICK_BASE_URL, apiKey: config.ONECLICK_API_KEY });
const tokens = new TokenCache(oneclick, repo);
const production = config.NODE_ENV === "production";
const rpcUrl = config.NEAR_RPC_URL ?? DEFAULT_RPC[config.NETWORK];
const mainnetRpcUrl = config.NEAR_MAINNET_RPC_URL ?? DEFAULT_RPC.mainnet;
const view = config.CLAVIS_CONTRACT_ID ? makeViewFn(rpcUrl) : undefined;
const log = (msg: string, extra?: Record<string, unknown>) => console.log(`[clavis] ${msg}`, extra ? JSON.stringify(extra) : "");

// Real mode (Phase 4): make sure the real trader exists locally, with the key price from the contract.
if (config.REAL_TRADER_ID && !repo.getTrader(config.REAL_TRADER_ID)) {
  let price = "1000000000000000000000000";
  try {
    const t = view ? await view<{ price: string } | null>(config.CLAVIS_CONTRACT_ID!, "get_trader", { trader_id: config.REAL_TRADER_ID }) : null;
    if (t?.price) price = t.price;
  } catch {
    /* keep default */
  }
  repo.upsertTrader({
    account_id: config.REAL_TRADER_ID,
    display_name: config.REAL_TRADER_ID.split(".")[0]!,
    is_simulated: 0,
    created_at: new Date().toISOString(),
    key_price_yocto: price,
    period_days: 30,
    style: config.REAL_TRADER_MAINNET_ACCOUNT ? `real mainnet trades by ${config.REAL_TRADER_MAINNET_ACCOUNT}` : "real mainnet trades",
  });
}

// Committer: commit_log for traders whose head moved (only with a contract + committer key).
const committer =
  config.CLAVIS_CONTRACT_ID && config.COMMITTER_ACCOUNT_ID && config.COMMITTER_PRIVATE_KEY && view
    ? new Committer({
        repo,
        contractId: config.CLAVIS_CONTRACT_ID,
        view,
        commit: makeNearCommit(rpcUrl, config.CLAVIS_CONTRACT_ID, config.COMMITTER_ACCOUNT_ID, config.COMMITTER_PRIVATE_KEY),
        now: Date.now,
        log,
      })
    : null;
committer?.start(10_000);

// Status poller: follows real trades until 1Click reports a terminal status.
new StatusPoller({ repo, oneclick, now: Date.now, log, onSettled: () => void committer?.tick() }).start(5_000);

if (config.DEMO_MODE) {
  // Demo mode reseeds on boot (deterministic, seed = 2026).
  const summary = await seedDatabase(repo, Date.now(), undefined, seedAccountsOf(config));
  console.log(`[clavis] demo seed: ${summary.traders} SIMULATED traders, ${summary.trades} trades, ${summary.realTrades} real trades`);
}
tokens.start(60_000); // also the price refresher (prices table)

// Demo visitors' accounts, keys and simulated trades are deleted after 24 hours (AUDIT M3).
const purgeDemo = () => {
  const n = purgeExpiredDemoData(repo, Date.now());
  if (n > 0) log("deleted expired demo accounts", { n });
};
purgeDemo();
setInterval(purgeDemo, 3_600_000).unref();

const app = await buildApp({
  config,
  repo,
  oneclick,
  tokens,
  now: Date.now,
  // Without SESSION_SECRET, sessions last until the next restart (fine for demo mode).
  sessionSecret: config.SESSION_SECRET ?? randomBytes(32).toString("hex"),
  view,
  verifyNep413: makeNearVerifier(rpcUrl),
  verifyNep413Mainnet: config.REAL_TRADER_ID && config.REAL_TRADER_MAINNET_ACCOUNT ? makeNearVerifier(mainnetRpcUrl) : undefined,
  webOrigins: config.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
  cookie: production ? { secure: true, sameSite: "none" } : { secure: false, sameSite: "lax" },
  logger: true,
  registrations: loadSeedRegistrations(),
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
