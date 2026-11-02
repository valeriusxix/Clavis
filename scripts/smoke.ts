// End-to-end smoke test (AGENT.md 13 Phase 6 / 14): every public endpoint plus the demo flow.
//
// Usage: pnpm smoke
// Target: SMOKE_URL (default http://localhost:8787, i.e. a running `pnpm dev`). If nothing answers
// there, the script starts its own demo-mode server in this process (in-memory database, live
// 1Click API), so it also works without `pnpm dev`. No wallet, no keys, no funds: only dry quotes.
// Exits 0 when every check passes, 1 otherwise.
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/server/src/app";
import { makeNearVerifier } from "../apps/server/src/auth/nep413";
import { DEFAULT_RPC } from "../apps/server/src/chain/nearView";
import { serverHead } from "../apps/server/src/chain/hashchain";
import { loadDotEnv, parseConfig, seedAccountsOf } from "../apps/server/src/config";
import { openDb, Repo } from "../apps/server/src/db/db";
import { seedDatabase } from "../apps/server/src/demo/seedDb";
import { OneClickClient } from "../apps/server/src/oneclick/client";
import { TokenCache } from "../apps/server/src/oneclick/tokens";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Res = { status: number; body: Json; cookie: string | null };

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};
const check = (cond: unknown, msg: string, why = "") => (cond ? ok(msg) : fail(why ? `${msg} (${why})` : msg));

async function startLocalServer(): Promise<{ url: string; close: () => Promise<void> }> {
  loadDotEnv(); // uses ONECLICK_API_KEY from .env if set
  const config = parseConfig({ ...process.env, DEMO_MODE: "true" });
  const repo = new Repo(openDb(":memory:"));
  await seedDatabase(repo, Date.now(), undefined, seedAccountsOf(config));
  const oneclick = new OneClickClient({ baseUrl: config.ONECLICK_BASE_URL, apiKey: config.ONECLICK_API_KEY });
  const tokens = new TokenCache(oneclick, repo);
  await tokens.refresh();
  const app = await buildApp({
    config,
    repo,
    oneclick,
    tokens,
    now: Date.now,
    sessionSecret: randomUUID(),
    verifyNep413: makeNearVerifier(DEFAULT_RPC.testnet),
    webOrigins: [],
    cookie: { secure: false, sameSite: "lax" },
  });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  return { url, close: () => app.close() };
}

async function main() {
  let base = (process.env.SMOKE_URL ?? "http://localhost:8787").replace(/\/+$/, "");
  let close: (() => Promise<void>) | null = null;
  try {
    await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(3000) });
    console.log(`Target: ${base} (running server)`);
  } catch {
    const local = await startLocalServer();
    base = local.url;
    close = local.close;
    console.log(`Target: ${base} (no server at SMOKE_URL, started an in-process demo server)`);
  }

  const call = async (method: "GET" | "POST", path: string, opts: { cookie?: string | null; body?: unknown } = {}): Promise<Res> => {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    const setCookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, cookie: setCookie || null };
  };

  console.log("\nPublic endpoints");
  const meta = await call("GET", "/api/meta");
  check(meta.status === 200, "GET /api/meta", `HTTP ${meta.status}`);
  if (!meta.body.demoMode) {
    fail("the server is not in demo mode (set DEMO_MODE=true); the demo flow cannot be checked");
    return finish(close);
  }

  const lb = await call("GET", "/api/traders");
  const traders = (lb.body.traders ?? []) as Json[];
  check(lb.status === 200 && traders.length >= 5, `GET /api/traders lists ${traders.length} traders`, `HTTP ${lb.status}`);
  const leaked = traders.filter((t) => "trades" in t || "entries" in t);
  check(leaked.length === 0, "leaderboard shows PnL only, no trade details");
  const seeded = traders.filter((t) => t.simulated);
  check(seeded.length >= 5, `${seeded.length} SIMULATED traders are labelled`);
  const pnl = traders.map((t) => t.pnl30dPct as number);
  check(pnl.every((p, i) => i === 0 || pnl[i - 1]! >= p), "ranked by 30-day PnL");

  const a = seeded[0]!.id as string;
  const b = seeded[1]!.id as string;
  const profile = await call("GET", `/api/traders/${encodeURIComponent(a)}`);
  check(profile.status === 200 && profile.body.unlocked === false && profile.body.lockedCount > 0, `GET /api/traders/${a}: locked, ${profile.body.lockedCount} trades hidden`);
  check((profile.body.equityCurve ?? []).length > 0, "equity curve present");

  for (const path of ["feed", "log"]) {
    const r = await call("GET", `/api/traders/${encodeURIComponent(a)}/${path}`);
    check(r.status === 403 && r.body.locked === true, `GET /${path} without a key is 403 LOCKED`, `HTTP ${r.status}`);
  }
  const missing = await call("GET", "/api/traders/does-not-exist");
  check(missing.status === 404 && missing.body.error?.code === "TRADER_NOT_FOUND", "unknown trader is a JSON 404");

  const tok = await call("GET", "/api/tokens");
  const symbols = ((tok.body.tokens ?? []) as Json[]).map((t) => t.symbol);
  check(tok.status === 200 && symbols.includes("wNEAR") && symbols.includes("USDC"), `GET /api/tokens (${tok.body.source}): ${symbols.join(", ")}`);

  console.log("\nDemo flow");
  const login = await call("POST", "/api/demo/login");
  const cookie = login.cookie;
  check(login.status === 200 && cookie, `POST /api/demo/login as ${login.body.account}`, `HTTP ${login.status}`);
  check(login.body.banner === "Demo account — key purchase simulated", "banner text matches the README");
  const me = login.body.account as string;

  const buy = await call("POST", "/api/demo/buy-key", { cookie, body: { traderId: a } });
  check(buy.status === 200 && buy.body.simulated === true, `POST /api/demo/buy-key for ${a}`, `HTTP ${buy.status}`);

  const feed = await call("GET", `/api/traders/${encodeURIComponent(a)}/feed`, { cookie });
  const rows = (feed.body.trades ?? []) as Json[];
  check(feed.status === 200 && rows.length === profile.body.lockedCount, `feed unlocked: ${rows.length} trades`, `HTTP ${feed.status}`);
  check(rows.every((r) => r.simulated === true), "every seeded row is labelled SIMULATED");

  const log = await call("GET", `/api/traders/${encodeURIComponent(a)}/log`, { cookie });
  const entries = (log.body.entries ?? []) as Parameters<typeof serverHead>[1];
  const head = await serverHead(a, entries);
  check(log.status === 200 && head === log.body.head?.headHash, `log hashes to the published head ${String(head).slice(0, 12)}…`);
  if (entries.length > 0) {
    const tampered = entries.map((e, i) => (i === 0 ? { ...e, amountOut: `${e.amountOut}1` } : e));
    check((await serverHead(a, tampered)) !== log.body.head?.headHash, "a tampered entry changes the head");
  }

  const other = await call("GET", `/api/traders/${encodeURIComponent(b)}/feed`, { cookie });
  check(other.status === 403, `a key for ${a} does not unlock ${b}`, `HTTP ${other.status}`);

  const keys = await call("GET", "/api/me/keys", { cookie });
  check(((keys.body.keys ?? []) as Json[]).some((k) => k.traderId === a), "GET /api/me/keys lists the key");

  console.log("\nTrade page (dry run, live 1Click API)");
  const usdc = ((tok.body.tokens ?? []) as Json[]).find((t) => t.symbol === "USDC" && t.blockchain === "near");
  const near = ((tok.body.tokens ?? []) as Json[]).find((t) => t.symbol === "wNEAR");
  const quote = await call("POST", "/api/trades/quote", {
    cookie,
    body: { originAsset: near?.assetId, destinationAsset: usdc?.assetId, amountHuman: "1", dry: true },
  });
  if (quote.status !== 200) {
    fail(`POST /api/trades/quote: HTTP ${quote.status} ${quote.body.error?.message ?? ""}`);
  } else {
    const q = quote.body;
    ok(`dry quote: 1 wNEAR -> ${q.quote.amountOutFormatted} USDC ($${Number(q.quote.amountOutUsd).toFixed(2)}), confidentiality ${q.confidentiality}`);
    check(q.signature?.valid === true, "quote signature verified (signed by 1Click)");
    check(q.quote.depositAddress === null, "dry quote has no deposit address (no funds can move)");
    if (!q.confidential) console.log(`  · ${q.notice}`);
    const sim = await call("POST", `/api/trades/${q.tradeId}/simulate`, { cookie });
    check(sim.status === 200 && sim.body.trade?.status === "SIMULATED", "Simulate fill records a SIMULATED trade", `HTTP ${sim.status}`);
    const own = await call("GET", `/api/traders/${encodeURIComponent(me)}`, { cookie });
    check(own.status === 200 && own.body.trader?.tradeCount >= 1 && own.body.trader?.simulated === true, `it appears in ${me}'s own profile, labelled SIMULATED`);
  }

  return finish(close);
}

async function finish(close: (() => Promise<void>) | null) {
  if (close) await close();
  console.log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
