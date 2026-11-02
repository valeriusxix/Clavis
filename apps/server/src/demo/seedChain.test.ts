import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { parseConfig, seedAccountsOf } from "../config";
import { openDb, Repo } from "../db/db";
import { TokenCache } from "../oneclick/tokens";
import { SEED_END } from "./seed";
import { assertTestnetOnly, fundingPerAccount, gitignoreCovers, maskKey, nearOf, planSeed, seedTargets } from "./seedChain";
import { seedDatabase } from "./seedDb";

describe("versioned seed accounts", () => {
  it("SEED_ACCOUNT_VERSION=v2 switches the demo traders to fresh accounts; /log links the registration tx", async () => {
    const now = SEED_END + 86_400_000;
    const config = parseConfig({ DEMO_MODE: "true", SEED_ACCOUNT_VERSION: "v2" });
    const repo = new Repo(openDb(":memory:"));
    await seedDatabase(repo, now, "/nonexistent.json", seedAccountsOf(config));
    const app = await buildApp({
      config,
      repo,
      oneclick: { hasApiKey: false, getQuote: () => Promise.reject(new Error("x")), submitDeposit: () => Promise.reject(new Error("x")), getStatus: () => Promise.reject(new Error("x")) },
      tokens: new TokenCache({ getTokens: () => Promise.reject(new Error("offline")) }, repo, () => now),
      now: () => now,
      sessionSecret: "test-secret-test-secret-test-secret",
      webOrigins: [],
      cookie: { secure: false, sameSite: "lax" },
      registrations: new Map([["quiet-whale-v2.clavis-app.testnet", "RegTx111"]]),
    });
    const traders = ((await app.inject("/api/traders")).json() as { traders: { id: string; name: string; simulated: boolean }[] }).traders;
    expect(traders.map((t) => t.id).sort()).toEqual(seedTargets({ parent: "clavis-app.testnet", version: "v2" }).map((t) => t.accountId).sort());
    expect(traders.find((t) => t.id === "quiet-whale-v2.clavis-app.testnet")).toMatchObject({ name: "quiet-whale", simulated: true });

    const cookie = (await app.inject({ method: "POST", url: "/api/demo/login" })).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await app.inject({ method: "POST", url: "/api/demo/buy-key", headers: { cookie }, payload: { traderId: "quiet-whale-v2.clavis-app.testnet" } });
    const log = (await app.inject({ url: "/api/traders/quiet-whale-v2.clavis-app.testnet/log", headers: { cookie } })).json();
    expect(log.registrationTx).toBe("RegTx111");
    await app.close();
  });
});

const costs = { storageByteYocto: 10n ** 19n, gasPriceYocto: 10n ** 8n };

describe("seed:chain planning (AUDIT C3)", () => {
  it("names accounts <handle>[-<version>].<parent>", () => {
    expect(seedTargets({ parent: "clavis-app.testnet" }).map((t) => t.accountId)).toContain("quiet-whale.clavis-app.testnet");
    const v2 = seedTargets({ parent: "clavis-app.testnet", version: "v2" });
    expect(v2.map((t) => t.accountId)).toEqual([
      "quiet-whale-v2.clavis-app.testnet",
      "zec-maxi-v2.clavis-app.testnet",
      "scalp-sensei-v2.clavis-app.testnet",
      "degen-dora-v2.clavis-app.testnet",
      "steady-eddie-v2.clavis-app.testnet",
    ]);
    expect(v2[0]).toMatchObject({ handle: "quiet-whale", priceYocto: "5000000000000000000000000", periodDays: 30 });
  });

  it("refuses anything but testnet", () => {
    const ok = { network: "testnet", contractId: "clavis-app.testnet", parent: "clavis-app.testnet", accountIds: ["a.clavis-app.testnet"] };
    expect(() => assertTestnetOnly(ok)).not.toThrow();
    expect(() => assertTestnetOnly({ ...ok, network: "mainnet" })).toThrow(/only runs on testnet/);
    expect(() => assertTestnetOnly({ ...ok, contractId: undefined })).toThrow(/CLAVIS_CONTRACT_ID is not set/);
    expect(() => assertTestnetOnly({ ...ok, contractId: "clavis.near" })).toThrow(/not a .testnet account/);
    expect(() => assertTestnetOnly({ ...ok, parent: "me.near", accountIds: ["a.me.near"] })).toThrow(/not a .testnet account/);
    expect(() => assertTestnetOnly({ ...ok, accountIds: ["a.someone-else.testnet"] })).toThrow(/Refusing account id/);
    expect(() => assertTestnetOnly({ ...ok, accountIds: ["Bad.clavis-app.testnet"] })).toThrow(/Refusing account id/);
  });

  it("funds only what an account needs and skips what is done", () => {
    const f = fundingPerAccount(costs);
    expect(f.storage).toBe(182n * 10n ** 19n); // 0.00182 NEAR
    expect(f.registerDeposit).toBe(400n * 10n ** 19n); // 0.004 NEAR, unused part refunded by the contract
    expect(f.gas).toBe(35n * 10n ** 12n * 10n ** 8n); // 0.0035 NEAR
    expect(nearOf(f.total)).toBe("0.00932");

    const targets = seedTargets({ parent: "clavis-app.testnet" });
    const chain = new Map([
      [targets[0]!.accountId, { state: "registered" as const, availableYocto: 0n }],
      [targets[1]!.accountId, { state: "exists" as const, availableYocto: 10n ** 24n }],
      [targets[2]!.accountId, { state: "exists" as const, availableYocto: 10n ** 21n }],
    ]);
    const plan = planSeed(targets, chain, costs);
    expect(plan[0]).toMatchObject({ create: false, register: false, fundYocto: 0n });
    expect(plan[1]).toMatchObject({ create: false, register: true, fundYocto: 0n }); // has enough already
    expect(plan[2]).toMatchObject({ create: false, register: true, fundYocto: f.registerDeposit + f.gas - 10n ** 21n });
    expect(plan[3]).toMatchObject({ create: true, register: true, fundYocto: f.total });
  });

  it("never shows a whole key; checks .gitignore", () => {
    const pk = "ed25519:5J5tkaxyPoR3Q9S8LXfo5bWnXK5Z2bctJ4mB9gENh7co";
    expect(maskKey(pk)).toBe("ed25519:5J5tka…h7co");
    expect(maskKey(pk)).not.toContain("PoR3Q9S8LXfo5bWnXK5Z2bctJ4mB9gEN");
    expect(gitignoreCovers("node_modules/\n.secrets/\n")).toBe(true);
    expect(gitignoreCovers("node_modules/\r\n/.secrets/\r\n")).toBe(true);
    expect(gitignoreCovers("# .secrets/\nsecrets/\n")).toBe(false);
  });
});
