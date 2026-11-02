import { computeHead, type LogEntry } from "@clavis/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type OneClickLike } from "./app";
import { parseConfig } from "./config";
import { openDb, Repo } from "./db/db";
import { SEED_ASSETS, SEED_END } from "./demo/seed";
import { seedDatabase } from "./demo/seedDb";
import basicQuote from "./oneclick/__fixtures__/mainnet-basic-dry-quote.json";
import publicQuote from "./oneclick/__fixtures__/mainnet-public-dry-quote.json";
import { OneClickError } from "./oneclick/client";
import { TokenCache } from "./oneclick/tokens";
import type { QuoteRequest, QuoteResponse } from "./oneclick/types";

const NOW = SEED_END + 2 * 86_400_000; // all seeded trades revealed

/** Fake 1Click: returns saved real mainnet quotes; without a key, confidential quotes get the real 401. */
function fakeOneClick(hasApiKey: boolean): OneClickLike & { requests: QuoteRequest[] } {
  const requests: QuoteRequest[] = [];
  return {
    hasApiKey,
    requests,
    async getQuote(req) {
      requests.push(req);
      if (req.confidentiality === "basic" && !hasApiKey) {
        throw new OneClickError("1Click POST /v0/quote -> HTTP 401", 401, {
          message: "User authentication is required for confidential intent quotes",
        });
      }
      return (req.confidentiality === "basic" ? basicQuote : publicQuote) as unknown as QuoteResponse;
    },
    async submitDeposit() {
      throw new Error("not used");
    },
    async getStatus() {
      throw new Error("not used");
    },
  };
}

async function setup(hasApiKey = true) {
  const repo = new Repo(openDb(":memory:"));
  await seedDatabase(repo, NOW, "/nonexistent/real-trades.json");
  const tokens = new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => NOW);
  const oneclick = fakeOneClick(hasApiKey);
  const app = await buildApp({
    config: parseConfig({ DEMO_MODE: "true" }),
    repo,
    oneclick,
    tokens,
    now: () => NOW,
    sessionSecret: "test-secret-test-secret-test-secret",
    webOrigins: ["http://localhost:5173"],
    cookie: { secure: false, sameSite: "lax" },
  });
  return { app, repo, oneclick };
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

describe("Phase 2 acceptance (AGENT.md 13)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    ({ app } = await setup());
  });
  afterAll(() => app.close());

  it("GET /api/meta", async () => {
    const res = await app.inject("/api/meta");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ demoMode: true, network: "testnet", contractId: null, hasOneClickKey: true });
  });

  it("GET /api/traders returns 5 SIMULATED traders with sensible numbers and no trade details", async () => {
    const res = await app.inject("/api/traders");
    expect(res.statusCode).toBe(200);
    const { traders } = res.json() as { traders: Record<string, unknown>[] };
    expect(traders).toHaveLength(5);
    const byName = Object.fromEntries(traders.map((t) => [t.name as string, t]));
    expect(Object.keys(byName).sort()).toEqual(["degen-dora", "quiet-whale", "scalp-sensei", "steady-eddie", "zec-maxi"]);
    const targets: Record<string, number> = { "quiet-whale": 0.38, "zec-maxi": 0.21, "scalp-sensei": 0.07, "degen-dora": -0.14, "steady-eddie": 0.11 };
    for (const [name, t] of Object.entries(byName)) {
      expect(t.simulated).toBe(true);
      expect(t.pnlPct as number).toBeCloseTo(targets[name]!, 2);
      expect(Number.isFinite(t.pnlTotalUsd)).toBe(true);
      expect(Number.isFinite(t.pnl30dPct)).toBe(true);
      expect(t.tradeCount as number).toBeGreaterThanOrEqual(25);
      expect(t.tradeCount as number).toBeLessThanOrEqual(60);
      expect(t.winRate === null || ((t.winRate as number) >= 0 && (t.winRate as number) <= 1)).toBe(true);
      expect(t.headHash).toMatch(/^[0-9a-f]{64}$/);
      expect(t).not.toHaveProperty("trades");
    }
    expect((byName["scalp-sensei"]!.winRate as number) > 0.75).toBe(true); // "high win rate"
    // ranked by 30-day PnL
    const p30 = traders.map((t) => t.pnl30dPct as number);
    expect(p30).toEqual([...p30].sort((a, b) => b - a));
  });

  it("/feed is 403 without access and 200 after /api/demo/buy-key; the log hashes to the server head", async () => {
    const id = "quiet-whale.clavis-app.testnet";
    const anon = await app.inject(`/api/traders/${id}/feed`);
    expect(anon.statusCode).toBe(403);
    expect(anon.json()).toMatchObject({ locked: true, error: { code: "LOCKED" } });

    const login = await app.inject({ method: "POST", url: "/api/demo/login" });
    expect(login.statusCode).toBe(200);
    expect(login.json().banner).toBe("Demo account — key purchase simulated");
    const cookie = cookieOf(login);

    const stillLocked = await app.inject({ url: `/api/traders/${id}/feed`, headers: { cookie } });
    expect(stillLocked.statusCode).toBe(403);

    const buy = await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie }, payload: { traderId: id } });
    expect(buy.statusCode).toBe(200);
    expect(buy.json()).toMatchObject({ traderId: id, simulated: true });

    const feed = await app.inject({ url: `/api/traders/${id}/feed`, headers: { cookie } });
    expect(feed.statusCode).toBe(200);
    const trades = feed.json().trades as { status: string; simulated: boolean; pair: string }[];
    expect(trades.length).toBeGreaterThanOrEqual(25);
    expect(trades.every((t) => t.status === "SIMULATED" && t.simulated)).toBe(true);

    const log = await app.inject({ url: `/api/traders/${id}/log`, headers: { cookie } });
    expect(log.statusCode).toBe(200);
    const body = log.json() as { entries: LogEntry[]; head: { tradeCount: number; headHash: string } };
    expect(body.entries).toHaveLength(body.head.tradeCount);
    expect(await computeHead(id, body.entries)).toBe(body.head.headHash); // what the browser will do

    const profile = await app.inject({ url: `/api/traders/${id}`, headers: { cookie } });
    expect(profile.json()).toMatchObject({ unlocked: true, lockedCount: 0 });
    expect((profile.json().equityCurve as unknown[]).length).toBeGreaterThan(40);

    const keys = await app.inject({ url: "/api/me/keys", headers: { cookie } });
    expect(keys.json().keys).toHaveLength(1);
  });

  it("other traders stay locked for the demo viewer", async () => {
    const login = await app.inject({ method: "POST", url: "/api/demo/login" });
    const res = await app.inject({ url: "/api/traders/zec-maxi.clavis-app.testnet/feed", headers: { cookie: cookieOf(login) } });
    expect(res.statusCode).toBe(403);
  });

  it("unknown trader and unknown route return JSON errors", async () => {
    expect((await app.inject("/api/traders/nobody")).json()).toMatchObject({ error: { code: "TRADER_NOT_FOUND" } });
    expect((await app.inject("/api/nope")).statusCode).toBe(404);
  });
});

describe("dry quote -> Simulate fill", () => {
  it("requests confidentiality basic, verifies the signature, and records a SIMULATED trade", async () => {
    const { app, oneclick } = await setup(true);
    const login = await app.inject({ method: "POST", url: "/api/demo/login" });
    const cookie = cookieOf(login);
    const q = await app.inject({
      method: "POST",
      url: "/api/trades/quote",
      headers: { cookie },
      payload: { originAsset: SEED_ASSETS.NEAR.assetId, destinationAsset: SEED_ASSETS.USDC.assetId, amountHuman: "1" },
    });
    expect(q.statusCode).toBe(200);
    const quote = q.json();
    expect(oneclick.requests[0]).toMatchObject({ dry: true, confidentiality: "basic", amount: "1000000000000000000000000", referral: "clavis" });
    expect(quote).toMatchObject({ dry: true, confidential: true, confidentiality: "basic", notice: null, signature: { valid: true } });
    expect(quote.quote.amountOutFormatted).toBe("4.194509");

    const sim = await app.inject({ method: "POST", url: `/api/trades/${quote.tradeId}/simulate`, headers: { cookie } });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().trade).toMatchObject({ status: "SIMULATED", simulated: true, seq: 1 });
    expect(sim.json().head.tradeCount).toBe(1);

    const again = await app.inject({ method: "POST", url: `/api/trades/${quote.tradeId}/simulate`, headers: { cookie } });
    expect(again.statusCode).toBe(409);

    const own = await app.inject({ url: "/api/traders/demo-viewer/feed", headers: { cookie } });
    expect(own.statusCode).toBe(200); // your own profile is always visible to you
    expect(own.json().trades).toHaveLength(1);
    await app.close();
  });

  it("without a 1Click key, falls back to a clearly labelled PUBLIC dry quote", async () => {
    const { app } = await setup(false);
    const cookie = cookieOf(await app.inject({ method: "POST", url: "/api/demo/login" }));
    const q = await app.inject({
      method: "POST",
      url: "/api/trades/quote",
      headers: { cookie },
      payload: { originAsset: SEED_ASSETS.NEAR.assetId, destinationAsset: SEED_ASSETS.USDC.assetId, amountHuman: "1" },
    });
    expect(q.statusCode).toBe(200);
    expect(q.json()).toMatchObject({ confidential: false, confidentiality: "public", signature: { valid: true } });
    expect(q.json().notice).toMatch(/PUBLIC dry quote/);
    await app.close();
  });

  it("real mode (dry: false) is refused for the demo account; quotes need a session", async () => {
    const { app } = await setup(true);
    const payload = { originAsset: SEED_ASSETS.NEAR.assetId, destinationAsset: SEED_ASSETS.USDC.assetId, amountHuman: "1" };
    expect((await app.inject({ method: "POST", url: "/api/trades/quote", payload })).statusCode).toBe(401);
    const cookie = cookieOf(await app.inject({ method: "POST", url: "/api/demo/login" }));
    const real = await app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload: { ...payload, dry: false } });
    expect(real.statusCode).toBe(403);
    expect(real.json().error.code).toBe("REAL_MODE_NEEDS_MAINNET_WALLET");
    const bad = await app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload: { ...payload, amountHuman: "1e3" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe("SIMULATED labels (AUDIT H2)", () => {
  for (const demo of ["true", "false"] as const) {
    it(`a wallet user whose trades are simulated fills is labelled SIMULATED (DEMO_MODE=${demo})`, async () => {
      const repo = new Repo(openDb(":memory:"));
      await seedDatabase(repo, NOW, "/nonexistent/real-trades.json");
      const app = await buildApp({
        config: parseConfig({ DEMO_MODE: demo }),
        repo,
        oneclick: fakeOneClick(true),
        tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => NOW),
        now: () => NOW,
        sessionSecret: "test-secret-test-secret-test-secret",
        webOrigins: [],
        cookie: { secure: false, sameSite: "lax" },
        verifyNep413: async () => undefined, // signature accepted; the server's own rules are under test
      });
      const { nonce } = (await app.inject("/api/auth/challenge")).json() as { nonce: string };
      const login = await app.inject({ method: "POST", url: "/api/auth/nep413", payload: { accountId: "bob.testnet", publicKey: "ed25519:abc", signature: "AAAA", nonce } });
      const cookie = cookieOf(login);
      const payload = { originAsset: SEED_ASSETS.NEAR.assetId, destinationAsset: SEED_ASSETS.USDC.assetId, amountHuman: "1" };
      const q = await app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload });
      expect((await app.inject({ method: "POST", url: `/api/trades/${q.json().tradeId}/simulate`, headers: { cookie } })).statusCode).toBe(200);

      const bob = ((await app.inject("/api/traders")).json().traders as { id: string; simulated: boolean }[]).find((t) => t.id === "bob.testnet");
      expect(bob).toMatchObject({ simulated: true });
      expect((await app.inject("/api/traders/bob.testnet")).json().trader.simulated).toBe(true);
      await app.close();
    });
  }
});

describe("quote errors are clear JSON, never a bare 500 (AUDIT M1)", () => {
  async function appWith(getQuote: OneClickLike["getQuote"]) {
    const repo = new Repo(openDb(":memory:"));
    await seedDatabase(repo, NOW, "/nonexistent/real-trades.json");
    const app = await buildApp({
      config: parseConfig({ DEMO_MODE: "true" }),
      repo,
      oneclick: { hasApiKey: false, getQuote, submitDeposit: () => Promise.reject(new Error("x")), getStatus: () => Promise.reject(new Error("x")) },
      tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => NOW),
      now: () => NOW,
      sessionSecret: "test-secret-test-secret-test-secret",
      webOrigins: [],
      cookie: { secure: false, sameSite: "lax" },
    });
    const cookie = cookieOf(await app.inject({ method: "POST", url: "/api/demo/login" }));
    const quote = (amountHuman: string) =>
      app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload: { originAsset: SEED_ASSETS.NEAR.assetId, destinationAsset: SEED_ASSETS.USDC.assetId, amountHuman } });
    return { app, quote };
  }

  it("1Click refusing the PUBLIC fallback (no key) gives a 400 with 1Click's reason", async () => {
    const { app, quote } = await appWith(async (req) => {
      if (req.confidentiality === "basic") throw new OneClickError("401", 401, { message: "User authentication is required for confidential intent quotes" });
      throw new OneClickError("1Click POST /v0/quote -> HTTP 400", 400, { message: "No liquidity available" });
    });
    const res = await quote("5000000");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "QUOTE_REJECTED" });
    expect(res.json().error.message).toMatch(/No liquidity available/);
    await app.close();
  });

  it("an amount with more decimals than the token has is a 400", async () => {
    const { app, quote } = await appWith(async () => publicQuote as unknown as QuoteResponse);
    const res = await quote("0.0000000000000000000000001");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_AMOUNT");
    await app.close();
  });

  it("1Click unreachable is a 502 that says so", async () => {
    const { app, quote } = await appWith(async () => {
      throw new OneClickError("network error", null, null);
    });
    const res = await quote("1");
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/unreachable/);
    await app.close();
  });
});
