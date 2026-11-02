import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { buildApp } from "./app";
import { makeNearVerifier } from "./auth/nep413";
import { DEFAULT_RPC, makeViewFn } from "./chain/nearView";
import { loadDotEnv, parseConfig, REPO_ROOT } from "./config";
import { openDb, Repo } from "./db/db";
import { seedDatabase } from "./demo/seedDb";
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

if (config.DEMO_MODE) {
  // Demo mode reseeds on boot (deterministic, seed = 2026).
  const summary = await seedDatabase(repo, Date.now());
  console.log(`[clavis] demo seed: ${summary.traders} SIMULATED traders, ${summary.trades} trades, ${summary.realTrades} real trades`);
}
tokens.start(60_000); // also the price refresher (prices table)

const app = await buildApp({
  config,
  repo,
  oneclick,
  tokens,
  now: Date.now,
  // Without SESSION_SECRET, sessions last until the next restart (fine for demo mode).
  sessionSecret: config.SESSION_SECRET ?? randomBytes(32).toString("hex"),
  view: config.CLAVIS_CONTRACT_ID ? makeViewFn(rpcUrl) : undefined,
  verifyNep413: makeNearVerifier(rpcUrl),
  webOrigins: config.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
  cookie: production ? { secure: true, sameSite: "none" } : { secure: false, sameSite: "lax" },
  logger: true,
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
