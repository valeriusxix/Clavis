import { Account, KeyPair, KeyPairSigner, type Provider } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { describe, expect, it } from "vitest";
import { buildApp, type OneClickLike } from "./app";
import { LOGIN_MESSAGE, makeNearVerifier } from "./auth/nep413";
import { parseConfig } from "./config";
import { openDb, Repo } from "./db/db";
import { SEED_ASSETS, SEED_END } from "./demo/seed";
import { seedDatabase } from "./demo/seedDb";
import basicQuote from "./oneclick/__fixtures__/mainnet-basic-dry-quote.json";
import { TokenCache } from "./oneclick/tokens";
import type { QuoteRequest, QuoteResponse } from "./oneclick/types";

const NOW = SEED_END + 86_400_000;
const PAYER = "clavis-dev.near";
const REAL = "real-trader.clavis-app.testnet";
const fullAccess = { viewAccessKey: async () => ({ permission: "FullAccess" }) } as unknown as Provider;

async function setup(quoteUsd = "1.69") {
  const repo = new Repo(openDb(":memory:"));
  await seedDatabase(repo, NOW, "/nonexistent.json");
  const requests: QuoteRequest[] = [];
  const deposits: unknown[] = [];
  const oneclick: OneClickLike = {
    hasApiKey: true,
    async getQuote(req) {
      requests.push(req);
      const r = structuredClone(basicQuote) as unknown as QuoteResponse;
      r.quoteRequest = { ...r.quoteRequest, ...req };
      r.quote = { ...r.quote, amountInUsd: quoteUsd, depositAddress: req.dry ? undefined : "0f1e2d3c4b5a.deposit", deadline: "2026-11-12T00:10:00.000Z" };
      return r;
    },
    async submitDeposit(req) {
      deposits.push(req);
      return {} as never;
    },
    async getStatus() {
      throw new Error("unused");
    },
  };
  const app = await buildApp({
    config: parseConfig({ DEMO_MODE: "true", CLAVIS_CONTRACT_ID: "clavis-app.testnet", REAL_TRADER_ID: REAL, REAL_TRADER_MAINNET_ACCOUNT: PAYER }),
    repo,
    oneclick,
    tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => NOW), // seed prices: NEAR $3.60
    now: () => NOW,
    sessionSecret: "test-secret-test-secret-test-secret",
    webOrigins: [],
    cookie: { secure: false, sameSite: "lax" },
    verifyNep413Mainnet: makeNearVerifier(fullAccess),
  });
  return { app, repo, requests, deposits };
}

async function mainnetLogin(app: Awaited<ReturnType<typeof setup>>["app"], accountId: string) {
  const ch = (await app.inject("/api/auth/challenge?network=mainnet")).json() as { nonce: string; recipient: string; network: string };
  expect(ch.network).toBe("mainnet");
  const account = new Account(accountId, fullAccess, new KeyPairSigner(KeyPair.fromRandom("ed25519")));
  const signed = await signMessage({
    signerAccount: account,
    payload: { message: LOGIN_MESSAGE, recipient: ch.recipient, nonce: new Uint8Array(Buffer.from(ch.nonce, "base64")) },
  });
  return app.inject({
    method: "POST",
    url: "/api/auth/nep413",
    payload: { accountId, publicKey: signed.publicKey.toString(), signature: Buffer.from(signed.signature).toString("base64"), nonce: ch.nonce },
  });
}

const real = (amountHuman: string, destinationAsset = SEED_ASSETS.USDC.assetId) => ({
  originAsset: SEED_ASSETS.NEAR.assetId,
  destinationAsset,
  amountHuman,
  dry: false,
});

describe("real mode (Phase 4)", () => {
  it("only the configured mainnet account can log in, and it acts as the real trader", async () => {
    const { app } = await setup();
    const stranger = await mainnetLogin(app, "someone-else.near");
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().error.code).toBe("NOT_LINKED");
    const ok = await mainnetLogin(app, PAYER);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ account: REAL, kind: "wallet", payer: PAYER });
  });

  it("real quote: basic confidentiality, recipient/refund = the mainnet payer, deposit address, then deposit submit", async () => {
    const { app, requests, deposits, repo } = await setup();
    const cookie = (await mainnetLogin(app, PAYER)).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const q = await app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload: real("0.4", SEED_ASSETS.USDC.assetId) });
    expect(q.statusCode).toBe(200);
    expect(requests[0]).toMatchObject({ dry: false, confidentiality: "basic", recipient: PAYER, refundTo: PAYER, amount: "400000000000000000000000" });
    expect(q.json().quote.depositAddress).toBe("0f1e2d3c4b5a.deposit");
    const id = q.json().tradeId as string;
    expect(repo.getTrade(id)).toMatchObject({ status: "PENDING_DEPOSIT", trader_id: REAL, payer: PAYER, is_simulated: 0 });

    // AUDIT C4: the output goes back on-chain to the account that pays, so the quote must warn.
    expect(q.json().routing).toMatchObject({ recipient: PAYER, recipientType: "DESTINATION_CHAIN", payer: PAYER });
    expect(q.json().routing.privacyWarning).toMatch(/same public account/);

    const dep = await app.inject({ method: "POST", url: `/api/trades/${id}/deposit`, headers: { cookie }, payload: { txHash: "HASH123" } });
    expect(dep.statusCode).toBe(200);
    expect(deposits).toEqual([{ txHash: "HASH123", depositAddress: "0f1e2d3c4b5a.deposit", nearSenderAccount: PAYER }]);
    expect(repo.getTrade(id)).toMatchObject({ status: "KNOWN_DEPOSIT_TX", tx_hash: "HASH123" });
  });

  it("enforces the $2 cap before quoting and against 1Click's own USD value", async () => {
    const { app, requests } = await setup();
    const cookie = (await mainnetLogin(app, PAYER)).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const big = await app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload: real("1") }); // ~$3.60
    expect(big.statusCode).toBe(400);
    expect(big.json().error.code).toBe("OVER_CAP");
    expect(requests).toHaveLength(0); // never asked 1Click for a deposit address

    const priced = await setup("2.50");
    const c2 = (await mainnetLogin(priced.app, PAYER)).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const over = await priced.app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie: c2 }, payload: real("0.4") });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe("OVER_CAP");
    expect(priced.repo.db.prepare(`SELECT status FROM trades WHERE trader_id = ?`).all(REAL)).toEqual([{ status: "FAILED" }]);
  });

  it("real trades are NEAR-chain only", async () => {
    const { app } = await setup();
    const cookie = (await mainnetLogin(app, PAYER)).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({ method: "POST", url: "/api/trades/quote", headers: { cookie }, payload: real("0.4", SEED_ASSETS.BTC.assetId) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NEAR_TOKENS_ONLY");
  });
});
