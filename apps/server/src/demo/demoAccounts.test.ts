import { describe, expect, it } from "vitest";
import { buildApp, type OneClickLike } from "../app";
import { parseConfig } from "../config";
import { openDb, Repo } from "../db/db";
import publicQuote from "../oneclick/__fixtures__/mainnet-public-dry-quote.json";
import { OneClickError } from "../oneclick/client";
import { TokenCache } from "../oneclick/tokens";
import type { QuoteResponse } from "../oneclick/types";
import { DEMO_SIM_CAP, DEMO_TTL_MS, demoIdCreatedAt, isDemoId, newDemoId, purgeExpiredDemoData } from "./demoAccounts";
import { SEED_ASSETS, SEED_END } from "./seed";
import { seedDatabase } from "./seedDb";

const START = SEED_END + 86_400_000;
const WHALE = "quiet-whale.clavis-app.testnet";
const HOUR = 3_600_000;

const oneclick: OneClickLike = {
  hasApiKey: false,
  async getQuote(req) {
    if (req.confidentiality === "basic") throw new OneClickError("401", 401, { message: "User authentication is required" });
    return publicQuote as unknown as QuoteResponse;
  },
  submitDeposit: () => Promise.reject(new Error("x")),
  getStatus: () => Promise.reject(new Error("x")),
};

async function setup() {
  const clock = { t: START };
  const repo = new Repo(openDb(":memory:"));
  await seedDatabase(repo, START, "/nonexistent.json");
  const app = await buildApp({
    config: parseConfig({ DEMO_MODE: "true" }),
    repo,
    oneclick,
    tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => clock.t),
    now: () => clock.t,
    sessionSecret: "test-secret-test-secret-test-secret",
    webOrigins: [],
    cookie: { secure: false, sameSite: "lax" },
  });
  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const login = async (cookie?: string) => {
    const res = await app.inject({ method: "POST", url: "/api/demo/login", headers: cookie ? { cookie } : {} });
    return { account: res.json().account as string, cookie: cookieOf(res) || cookie!, setCookie: String(res.headers["set-cookie"] ?? "") };
  };
  const quoteAndSimulate = async (cookie: string) => {
    const q = await app.inject({
      method: "POST",
      url: "/api/trades/quote",
      headers: { cookie },
      payload: { originAsset: SEED_ASSETS.NEAR.assetId, destinationAsset: SEED_ASSETS.USDC.assetId, amountHuman: "1" },
    });
    return app.inject({ method: "POST", url: `/api/trades/${q.json().tradeId}/simulate`, headers: { cookie } });
  };
  return { app, repo, clock, login, quoteAndSimulate };
}

describe("demo account ids", () => {
  it("are random, dated and never valid NEAR account names", () => {
    const a = newDemoId(START);
    expect(isDemoId(a)).toBe(true);
    expect(a).not.toBe(newDemoId(START));
    expect(demoIdCreatedAt(a)).toBe(START);
    expect(a).not.toContain(".");
    expect(a.length).toBeLessThan(32); // top-level accounts this short can't be created, so no wallet can log in as one
    expect(isDemoId("demo-viewer")).toBe(false);
    expect(isDemoId("quiet-whale.clavis-app.testnet")).toBe(false);
  });
});

describe("one demo account per visitor (AUDIT M3)", () => {
  it("each visitor gets their own id; keys and simulated trades are not shared", async () => {
    const { app, login, quoteAndSimulate } = await setup();
    const a = await login();
    const b = await login();
    expect(a.account).not.toBe(b.account);
    expect(isDemoId(a.account) && isDemoId(b.account)).toBe(true);

    await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie: a.cookie }, payload: { traderId: WHALE } });
    expect((await app.inject({ url: `/api/traders/${WHALE}/feed`, headers: { cookie: a.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/traders/${WHALE}/feed`, headers: { cookie: b.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/me/keys", headers: { cookie: b.cookie } })).json().keys).toEqual([]);

    expect((await quoteAndSimulate(a.cookie)).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/traders/${a.account}/feed`, headers: { cookie: a.cookie } })).json().trades).toHaveLength(1);
    expect((await app.inject({ url: `/api/traders/${a.account}/feed`, headers: { cookie: b.cookie } })).statusCode).toBe(403);
    await app.close();
  });

  it("the id lives in an http-only cookie and survives a refresh", async () => {
    const { app, login } = await setup();
    const a = await login();
    expect(a.setCookie).toMatch(/HttpOnly/i);
    expect((await app.inject({ url: "/api/me", headers: { cookie: a.cookie } })).json().session.account).toBe(a.account);
    expect((await login(a.cookie)).account).toBe(a.account); // clicking "Use demo account" again keeps it
    await app.close();
  });

  it("demo traders never appear on the public leaderboard", async () => {
    const { app, login, quoteAndSimulate } = await setup();
    const a = await login();
    await quoteAndSimulate(a.cookie);
    const ids = (await app.inject("/api/traders")).json().traders.map((t: { id: string }) => t.id) as string[];
    expect(ids).toHaveLength(5);
    expect(ids.some(isDemoId)).toBe(false);
    await app.close();
  });

  it(`caps simulated trades at ${DEMO_SIM_CAP} per demo id`, async () => {
    const { app, clock, login, quoteAndSimulate } = await setup();
    const a = await login();
    for (let i = 0; i < DEMO_SIM_CAP; i++) {
      clock.t += 7_000; // stay under the per-minute rate limit
      expect((await quoteAndSimulate(a.cookie)).statusCode).toBe(200);
    }
    clock.t += 7_000;
    const over = await quoteAndSimulate(a.cookie);
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe("DEMO_LIMIT");
    await app.close();
  });

  it("rate-limits the simulate endpoint", async () => {
    const { app, login, quoteAndSimulate } = await setup();
    const a = await login();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await quoteAndSimulate(a.cookie)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    await app.close();
  });

  it('"Reset demo" gives a fresh id and deletes the old one\'s keys and trades', async () => {
    const { app, repo, login, quoteAndSimulate } = await setup();
    const a = await login();
    await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie: a.cookie }, payload: { traderId: WHALE } });
    await quoteAndSimulate(a.cookie);
    const reset = await app.inject({ method: "POST", url: "/api/demo/reset", headers: { cookie: a.cookie } });
    expect(reset.statusCode).toBe(200);
    const fresh = reset.json().account as string;
    expect(isDemoId(fresh) && fresh !== a.account).toBe(true);
    expect(repo.getTrader(a.account)).toBeUndefined();
    expect(repo.demoKeysOf(a.account)).toEqual([]);
    expect(repo.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE trader_id = ?").get(a.account)).toEqual({ n: 0 });
    await app.close();
  });

  it("demo keys expire with the demo account, and everything is deleted after 24 hours", async () => {
    const { app, repo, clock, login, quoteAndSimulate } = await setup();
    const a = await login();
    const buy = await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie: a.cookie }, payload: { traderId: WHALE } });
    expect(Date.parse(buy.json().expiresAt)).toBe(START + DEMO_TTL_MS);
    await quoteAndSimulate(a.cookie);

    clock.t = START + 23 * HOUR;
    purgeExpiredDemoData(repo, clock.t);
    expect(repo.getTrader(a.account)).toBeDefined();

    clock.t = START + 25 * HOUR;
    purgeExpiredDemoData(repo, clock.t);
    expect(repo.getTrader(a.account)).toBeUndefined();
    expect(repo.demoKeysOf(a.account)).toEqual([]);
    expect(repo.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE trader_id = ?").get(a.account)).toEqual({ n: 0 });
    expect(repo.getTrader(WHALE)).toBeDefined(); // seeded traders are untouched
    await app.close();
  });
});
