import { Account, KeyPair, KeyPairSigner, type Provider } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { parseConfig } from "../config";
import { openDb, Repo } from "../db/db";
import { seedDatabase } from "../demo/seedDb";
import { SEED_END } from "../demo/seed";
import { TokenCache } from "../oneclick/tokens";
import { ChallengeStore, LOGIN_MESSAGE, makeNearVerifier } from "./nep413";

/** Stub RPC: the key has the given permission on the account. */
const stubProvider = (permission: unknown) => ({ viewAccessKey: async () => ({ permission }) }) as unknown as Provider;

async function signLogin(accountId: string, nonceB64: string, recipient: string) {
  const kp = KeyPair.fromRandom("ed25519");
  const account = new Account(accountId, stubProvider("FullAccess"), new KeyPairSigner(kp));
  const signed = await signMessage({
    signerAccount: account,
    payload: { message: LOGIN_MESSAGE, recipient, nonce: new Uint8Array(Buffer.from(nonceB64, "base64")) },
  });
  return { accountId, publicKey: signed.publicKey.toString(), signature: Buffer.from(signed.signature).toString("base64"), nonce: nonceB64 };
}

describe("NEP-413 verifier (real ed25519 signatures from near-api-js)", () => {
  const nonce = Buffer.alloc(32, 7).toString("base64");
  const n = () => new Uint8Array(Buffer.from(nonce, "base64"));

  it("accepts a valid signature from a full-access key", async () => {
    const s = await signLogin("alice.testnet", nonce, "clavis-app.testnet");
    const verify = makeNearVerifier(stubProvider("FullAccess"));
    await expect(
      verify({ accountId: s.accountId, publicKey: s.publicKey, signature: Buffer.from(s.signature, "base64"), nonce: n(), recipient: "clavis-app.testnet" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a function-call key, another recipient, or another nonce", async () => {
    const s = await signLogin("alice.testnet", nonce, "clavis-app.testnet");
    const sig = Buffer.from(s.signature, "base64");
    const fnKey = makeNearVerifier(stubProvider({ FunctionCall: { receiver_id: "x", method_names: [] } }));
    await expect(fnKey({ accountId: s.accountId, publicKey: s.publicKey, signature: sig, nonce: n(), recipient: "clavis-app.testnet" })).rejects.toThrow(/FullAccess/);
    const full = makeNearVerifier(stubProvider("FullAccess"));
    await expect(full({ accountId: s.accountId, publicKey: s.publicKey, signature: sig, nonce: n(), recipient: "evil.testnet" })).rejects.toThrow();
    await expect(
      full({ accountId: s.accountId, publicKey: s.publicKey, signature: sig, nonce: new Uint8Array(32), recipient: "clavis-app.testnet" }),
    ).rejects.toThrow();
  });

  it("challenges are single-use and expire", () => {
    let t = 1_000;
    const store = new ChallengeStore(() => t);
    const a = store.issue();
    expect(store.consume(a.nonce)).toBe("testnet");
    expect(store.consume(a.nonce)).toBeNull();
    const b = store.issue("mainnet");
    expect(store.consume(b.nonce)).toBe("mainnet");
    const c = store.issue();
    t += 6 * 60_000;
    expect(store.consume(c.nonce)).toBeNull();
  });
});

describe("POST /api/auth/nep413 -> wallet session -> contract has_access", () => {
  it("logs in with a signed challenge, rejects replays, and gates the feed by has_access", async () => {
    const NOW = SEED_END + 86_400_000;
    const repo = new Repo(openDb(":memory:"));
    await seedDatabase(repo, NOW, "/nonexistent.json");
    const views: string[] = [];
    const app = await buildApp({
      config: parseConfig({ DEMO_MODE: "true", CLAVIS_CONTRACT_ID: "clavis-app.testnet" }),
      repo,
      oneclick: { hasApiKey: true, getQuote: async () => { throw new Error("unused"); }, submitDeposit: async () => { throw new Error("unused"); }, getStatus: async () => { throw new Error("unused"); } },
      tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => NOW),
      now: () => NOW,
      sessionSecret: "test-secret-test-secret-test-secret",
      webOrigins: [],
      cookie: { secure: false, sameSite: "lax" },
      verifyNep413: makeNearVerifier(stubProvider("FullAccess")),
      view: async <T,>(_c: string, method: string, args: Record<string, unknown>) => {
        views.push(`${method}:${String(args.trader_id)}:${String(args.account_id)}`);
        return (args.trader_id === "quiet-whale.clavis-app.testnet") as T; // bob holds a key for quiet-whale only
      },
    });

    const ch = (await app.inject("/api/auth/challenge")).json() as { nonce: string; message: string; recipient: string };
    expect(ch).toMatchObject({ message: LOGIN_MESSAGE, recipient: "clavis-app.testnet" });
    const body = await signLogin("bob.testnet", ch.nonce, ch.recipient);

    const login = await app.inject({ method: "POST", url: "/api/auth/nep413", payload: body });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ account: "bob.testnet", kind: "wallet", payer: null });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const replay = await app.inject({ method: "POST", url: "/api/auth/nep413", payload: body });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("BAD_CHALLENGE");

    expect((await app.inject({ url: "/api/me", headers: { cookie } })).json()).toEqual({
      session: { account: "bob.testnet", kind: "wallet", payer: null },
    });
    expect((await app.inject({ url: "/api/traders/quiet-whale.clavis-app.testnet/feed", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/traders/zec-maxi.clavis-app.testnet/feed", headers: { cookie } })).statusCode).toBe(403);
    expect(views).toContain("has_access:quiet-whale.clavis-app.testnet:bob.testnet");

    // wallet sessions cannot use the demo key shop
    const demoBuy = await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie }, payload: { traderId: "zec-maxi.clavis-app.testnet" } });
    expect(demoBuy.statusCode).toBe(403);
    await app.close();
  });
});
