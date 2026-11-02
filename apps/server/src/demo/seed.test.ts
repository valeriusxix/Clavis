import { describe, expect, it } from "vitest";
import { openDb, Repo } from "../db/db";
import { buildPricePaths, generateSeed, SEED_ASSETS, SEED_END, SEED_START, SEED_TRADERS } from "./seed";
import { seedDatabase } from "./seedDb";

const NO_REAL = "/nonexistent/real-trades.json";

describe("demo seed (AGENT.md 10.1)", () => {
  const seeded = generateSeed(buildPricePaths());

  it("uses real 1Click asset ids (no placeholders)", () => {
    for (const a of Object.values(SEED_ASSETS)) expect(a.assetId).toMatch(/^nep141:[a-z0-9._-]+$/);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(generateSeed(buildPricePaths()))).toBe(JSON.stringify(seeded));
  });

  it("has the five personalities with 25-60 trades each inside the 45-day window", () => {
    expect(seeded.map((t) => t.handle)).toEqual(["quiet-whale", "zec-maxi", "scalp-sensei", "degen-dora", "steady-eddie"]);
    for (const t of seeded) {
      expect(t.fills.length).toBeGreaterThanOrEqual(25);
      expect(t.fills.length).toBeLessThanOrEqual(60);
      for (const f of t.fills) {
        expect(f.t).toBeGreaterThanOrEqual(SEED_START);
        expect(f.t).toBeLessThanOrEqual(SEED_END);
      }
      expect(new Set(t.fills.flatMap((f) => [f.sell, f.buy])).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("every fill loses the swap fee in USD terms, like a real swap", () => {
    for (const t of seeded) for (const f of t.fills) expect(Number(f.vOut)).toBeLessThan(Number(f.vIn));
  });

  it("hits the target outcomes with a small execution edge", () => {
    for (const t of seeded) {
      const spec = SEED_TRADERS.find((s) => s.handle === t.handle)!;
      expect(Math.abs(t.pnlPct - spec.targetPct)).toBeLessThan(0.005);
      expect(Math.abs(t.edge)).toBeLessThan(0.006); // under 0.6% price improvement per fill
    }
  });
});

describe("seedDatabase", () => {
  it("reveals only trades whose time has passed, with contiguous seq", async () => {
    const repo = new Repo(openDb(":memory:"));
    const mid = SEED_START + 20 * 86_400_000;
    const summary = await seedDatabase(repo, mid, NO_REAL);
    const full = await seedDatabase(new Repo(openDb(":memory:")), SEED_END + 1, NO_REAL);
    expect(summary.trades).toBeGreaterThan(0);
    expect(summary.trades).toBeLessThan(full.trades);
    for (const tr of repo.listTraders()) {
      const seqs = repo.settledTrades(tr.account_id).map((t) => t.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
      expect(repo.settledTrades(tr.account_id).every((t) => Date.parse(t.settled_at!) <= mid)).toBe(true);
    }
  });

  it("produces the same chain heads on every run (on-chain commitments stay valid)", async () => {
    const heads = async () => {
      const repo = new Repo(openDb(":memory:"));
      await seedDatabase(repo, SEED_END + 1, NO_REAL);
      return repo.listTraders().map((t) => [t.account_id, repo.getChainHead(t.account_id)]);
    };
    expect(await heads()).toEqual(await heads());
  });

  it("labels everything SIMULATED (demo visitors get their own profile later, AUDIT M3)", async () => {
    const repo = new Repo(openDb(":memory:"));
    await seedDatabase(repo, SEED_END + 1, NO_REAL);
    const traders = repo.listTraders();
    expect(traders).toHaveLength(5);
    expect(traders.every((t) => t.is_simulated === 1)).toBe(true);
    expect(traders.find((t) => t.display_name === "quiet-whale")!.account_id).toBe("quiet-whale.clavis-app.testnet");
  });
});
