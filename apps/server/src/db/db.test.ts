import { describe, expect, it } from "vitest";
import { openDb, Repo, type TradeRow } from "./db";

const trade = (id: string, seq: number | null, status: TradeRow["status"]): TradeRow => ({
  id,
  trader_id: "quiet-whale",
  seq,
  status,
  is_simulated: 1,
  origin_asset: "nep141:wrap.near",
  origin_symbol: "wNEAR",
  dest_asset: "nep141:usdt.tether-token.near",
  dest_symbol: "USDT",
  amount_in: "1000000000000000000000000",
  amount_in_formatted: "1",
  amount_in_usd: "4.2",
  amount_out: "4190000",
  amount_out_formatted: "4.19",
  amount_out_usd: "4.19",
  confidentiality: "simulated",
  deposit_address: null,
  deposit_memo: null,
  tx_hash: null,
  quote_json: "{}",
  quote_signature: null,
  signature_valid: null,
  created_at: "2026-10-01T00:00:00.000Z",
  settled_at: seq === null ? null : "2026-10-01T00:00:00.000Z",
});

describe("db", () => {
  it("creates the schema and round-trips traders, trades, heads and demo access", () => {
    const repo = new Repo(openDb(":memory:"));
    repo.upsertTrader({
      account_id: "quiet-whale",
      display_name: "quiet-whale",
      is_simulated: 1,
      created_at: "2026-09-15T00:00:00.000Z",
      key_price_yocto: "1000000000000000000000000",
      period_days: 30,
      style: "few large swing trades",
    });
    repo.insertTrade(trade("b", 2, "SIMULATED"));
    repo.insertTrade(trade("a", 1, "SIMULATED"));
    repo.insertTrade(trade("q1", null, "QUOTED"));
    repo.insertTrade(trade("q2", null, "QUOTED")); // several unsettled rows may have NULL seq

    expect(repo.settledTrades("quiet-whale").map((t) => t.id)).toEqual(["a", "b"]);
    expect(repo.nextSeq("quiet-whale")).toBe(3);
    expect(() => repo.insertTrade(trade("dup", 2, "SIMULATED"))).toThrow(/UNIQUE/);

    repo.updateTrade("q1", { status: "PENDING_DEPOSIT", deposit_address: "abc" });
    expect(repo.nonTerminalTrades().map((t) => t.id)).toEqual(["q1"]);

    repo.setChainHead("quiet-whale", 2, "ab".repeat(32));
    repo.markCommitted("quiet-whale", 2, "TX");
    expect(repo.getChainHead("quiet-whale")).toEqual({
      trader_id: "quiet-whale",
      trade_count: 2,
      head_hash: "ab".repeat(32),
      committed_count: 2,
      commit_tx: "TX",
    });

    expect(repo.getDemoAccessExpiry("quiet-whale", "demo-viewer")).toBeUndefined();
    repo.grantDemoAccess("quiet-whale", "demo-viewer", "2026-12-01T00:00:00.000Z");
    expect(repo.getDemoAccessExpiry("quiet-whale", "demo-viewer")).toBe("2026-12-01T00:00:00.000Z");
  });

  it("rejects trades for unknown traders (foreign key)", () => {
    const repo = new Repo(openDb(":memory:"));
    expect(() => repo.insertTrade(trade("x", 1, "SIMULATED"))).toThrow(/FOREIGN KEY/);
  });
});
