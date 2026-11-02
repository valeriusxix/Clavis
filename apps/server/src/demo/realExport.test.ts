import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { parseConfig } from "../config";
import { openDb, Repo, type TradeRow } from "../db/db";
import { TokenCache } from "../oneclick/tokens";
import { buildRealExport } from "./realExport";
import { SEED_END } from "./seed";
import { seedDatabase } from "./seedDb";

const REAL = "real-trader.clavis-app.testnet";
const DEV = "clavis-dev.near";
const NOW = SEED_END + 86_400_000;

function realTrade(id: string, seq: number, account: string): TradeRow {
  return {
    id,
    trader_id: REAL,
    seq,
    status: "SUCCESS",
    is_simulated: 0,
    origin_asset: "nep141:wrap.near",
    origin_symbol: "wNEAR",
    dest_asset: "nep141:usdc",
    dest_symbol: "USDC",
    amount_in: "400000000000000000000000",
    amount_in_formatted: "0.4",
    amount_in_usd: "1.55",
    amount_out: "1540000",
    amount_out_formatted: "1.54",
    amount_out_usd: "1.54",
    confidentiality: "basic",
    deposit_address: "0f1e.deposit",
    deposit_memo: null,
    tx_hash: `TX${seq}`,
    quote_json: JSON.stringify({ correlationId: `c${seq}`, quoteRequest: { dry: false, recipient: account, refundTo: account } }),
    quote_signature: "ed25519:sig",
    signature_valid: 1,
    created_at: "2026-11-09T00:00:00.000Z",
    settled_at: "2026-11-09T00:01:00.000Z",
    payer: account,
  };
}

function repoWith(trades: TradeRow[]) {
  const repo = new Repo(openDb(":memory:"));
  repo.upsertTrader({ account_id: REAL, display_name: "real-trader", is_simulated: 0, created_at: "2026-11-02T00:00:00.000Z", key_price_yocto: "1000000000000000000000000", period_days: 30, style: "real mainnet trades" });
  for (const t of trades) repo.insertTrade(t);
  return repo;
}

describe("real-trade export (AUDIT H5)", () => {
  it("exports only the dev account's trades and reports which accounts are in the file", () => {
    const out = buildRealExport(repoWith([realTrade("a", 1, DEV), realTrade("b", 2, DEV)]), REAL, DEV);
    expect(out.trades).toHaveLength(2);
    expect(out.accounts).toEqual([DEV]);
  });

  it("refuses to export anything if a trade involves another account", () => {
    expect(() => buildRealExport(repoWith([realTrade("a", 1, DEV), realTrade("b", 2, "my-main.near")]), REAL, DEV)).toThrow(
      /my-main\.near.*not the dev account clavis-dev\.near/,
    );
  });

  it("the exported file is seed data only: the real trader's feed stays locked until a key is bought", async () => {
    const file = buildRealExport(repoWith([realTrade("a", 1, DEV)]), REAL, DEV);
    const path = join(mkdtempSync(join(tmpdir(), "clavis-")), "real-trades.json");
    writeFileSync(path, JSON.stringify(file));
    const repo = new Repo(openDb(":memory:"));
    expect((await seedDatabase(repo, NOW, path)).realTrades).toBe(1);
    const app = await buildApp({
      config: parseConfig({ DEMO_MODE: "true" }),
      repo,
      oneclick: { hasApiKey: false, getQuote: () => Promise.reject(new Error("x")), submitDeposit: () => Promise.reject(new Error("x")), getStatus: () => Promise.reject(new Error("x")) },
      tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => NOW),
      now: () => NOW,
      sessionSecret: "test-secret-test-secret-test-secret",
      webOrigins: [],
      cookie: { secure: false, sameSite: "lax" },
    });
    expect((await app.inject(`/api/traders/${REAL}/feed`)).statusCode).toBe(403);
    expect((await app.inject(`/api/traders/${REAL}/log`)).statusCode).toBe(403);
    const profile = await app.inject(`/api/traders/${REAL}`);
    expect(profile.json()).toMatchObject({ unlocked: false, lockedCount: 1 });
    expect(profile.body).not.toContain("TX1"); // no trade details on public endpoints
    expect((await app.inject("/api/traders")).body).not.toContain("TX1");
    expect((await app.inject("/real-trades.json")).statusCode).toBe(404);

    const cookie = (await app.inject({ method: "POST", url: "/api/demo/login" })).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie }, payload: { traderId: REAL } });
    expect((await app.inject({ url: `/api/traders/${REAL}/feed`, headers: { cookie } })).statusCode).toBe(200);
    await app.close();
  });
});
