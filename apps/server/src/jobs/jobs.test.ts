import { computeHead } from "@clavis/shared";
import { describe, expect, it } from "vitest";
import { logOf, refreshChainHead } from "../chain/log";
import { Committer } from "../chain/committer";
import { openDb, Repo, type TradeRow } from "../db/db";
import type { GetExecutionStatusResponse } from "../oneclick/types";
import { StatusPoller } from "./statusPoller";

const TRADER = "real-trader.clavis-app.testnet";
const NOW = Date.UTC(2026, 10, 9, 12);

function setup() {
  const repo = new Repo(openDb(":memory:"));
  repo.upsertTrader({ account_id: TRADER, display_name: "real-trader", is_simulated: 0, created_at: new Date(NOW).toISOString(), key_price_yocto: "1", period_days: 30, style: null });
  return repo;
}

function pending(id: string, depositAddress: string): TradeRow {
  return {
    id, trader_id: TRADER, seq: null, status: "KNOWN_DEPOSIT_TX", is_simulated: 0,
    origin_asset: "nep141:wrap.near", origin_symbol: "wNEAR",
    dest_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", dest_symbol: "USDC",
    amount_in: "400000000000000000000000", amount_in_formatted: "0.4", amount_in_usd: "1.68",
    amount_out: "1670000", amount_out_formatted: "1.67", amount_out_usd: "1.669",
    confidentiality: "basic", deposit_address: depositAddress, deposit_memo: null, tx_hash: "TXDEP",
    quote_json: JSON.stringify({ correlationId: `corr-${id}` }), quote_signature: "ed25519:sig", signature_valid: 1,
    created_at: new Date(NOW).toISOString(), settled_at: null, payer: "clavis-dev.near",
  };
}

const statusOf = (status: string, swapDetails: Record<string, unknown> = {}) =>
  ({ correlationId: "c", status, updatedAt: "2026-11-09T12:00:05.000Z", quoteResponse: {}, swapDetails }) as unknown as GetExecutionStatusResponse;

describe("StatusPoller", () => {
  it("follows a trade to SUCCESS, uses final amounts from swapDetails, assigns seq and extends the chain", async () => {
    const repo = setup();
    repo.insertTrade(pending("t1", "dep1"));
    const seq = ["PROCESSING", "SUCCESS"];
    const settled: string[] = [];
    const poller = new StatusPoller({
      repo,
      now: () => NOW,
      onSettled: (t) => settled.push(t),
      oneclick: {
        getStatus: async () =>
          statusOf(seq.shift()!, {
            amountIn: "400000000000000000000000", amountInFormatted: "0.4", amountInUsd: "1.70",
            amountOut: "1681234", amountOutFormatted: "1.681234", amountOutUsd: "1.680",
          }),
      },
    });
    await poller.tick();
    expect(repo.getTrade("t1")!.status).toBe("PROCESSING");
    await poller.tick();
    const t = repo.getTrade("t1")!;
    expect(t).toMatchObject({ status: "SUCCESS", seq: 1, amounts_source: "final", amount_out: "1681234", amount_out_usd: "1.680", settled_at: "2026-11-09T12:00:05.000Z" });
    expect(JSON.parse(t.status_json!).status).toBe("SUCCESS");
    expect(settled).toEqual([TRADER]);
    const head = repo.getChainHead(TRADER)!;
    expect(head.trade_count).toBe(1);
    expect(head.head_hash).toBe(await computeHead(TRADER, logOf(repo, TRADER)));
    expect(logOf(repo, TRADER)[0]).toMatchObject({ confidentiality: "basic", correlationId: "corr-t1", quoteSignature: "ed25519:sig" });
    await poller.tick(); // terminal trades are not polled again
    expect(repo.getTrade("t1")!.seq).toBe(1);
  });

  it("keeps quote amounts (marked quoted) when swapDetails has none; refunds get no seq", async () => {
    const repo = setup();
    repo.insertTrade(pending("t1", "dep1"));
    repo.insertTrade(pending("t2", "dep2"));
    const poller = new StatusPoller({
      repo,
      now: () => NOW,
      oneclick: { getStatus: async (addr: string) => statusOf(addr === "dep1" ? "SUCCESS" : "REFUNDED") },
    });
    await poller.tick();
    expect(repo.getTrade("t1")).toMatchObject({ status: "SUCCESS", seq: 1, amounts_source: "quoted", amount_out: "1670000" });
    expect(repo.getTrade("t2")).toMatchObject({ status: "REFUNDED", seq: null });
  });
});

describe("Committer", () => {
  async function withSettledTrades(n: number) {
    const repo = setup();
    for (let i = 1; i <= n; i++) repo.insertTrade({ ...pending(`t${i}`, `d${i}`), status: "SUCCESS", seq: i, settled_at: new Date(NOW + i).toISOString() });
    await refreshChainHead(repo, TRADER);
    return repo;
  }

  it("commits a new head, then rate-limits per trader", async () => {
    const repo = await withSettledTrades(2);
    const calls: unknown[][] = [];
    let t = NOW;
    let onChain = { trade_count: "0", head_hash: "x", last_commit_at: "0" };
    const committer = new Committer({
      repo,
      contractId: "clavis-app.testnet",
      now: () => t,
      view: async <T,>() => onChain as T,
      commit: async (...args) => {
        calls.push(args);
        return "TX1";
      },
    });
    await committer.tick();
    expect(calls).toEqual([[TRADER, 2, repo.getChainHead(TRADER)!.head_hash]]);
    expect(repo.getChainHead(TRADER)).toMatchObject({ committed_count: 2, commit_tx: "TX1" });

    // a third trade settles 5 s later: no new commit until 30 s have passed
    repo.insertTrade({ ...pending("t3", "d3"), status: "SUCCESS", seq: 3, settled_at: new Date(NOW + 3).toISOString() });
    await refreshChainHead(repo, TRADER);
    onChain = { trade_count: "2", head_hash: "y", last_commit_at: "1" };
    t = NOW + 5_000;
    await committer.tick();
    expect(calls).toHaveLength(1);
    t = NOW + 31_000;
    await committer.tick();
    expect(calls).toHaveLength(2);
    expect(repo.getChainHead(TRADER)!.committed_count).toBe(3);
  });

  it("skips traders that are not registered on-chain, and recognises heads that are already committed", async () => {
    const repo = await withSettledTrades(1);
    const head = repo.getChainHead(TRADER)!;
    let calls = 0;
    const mk = (onChain: unknown) =>
      new Committer({ repo, contractId: "c", now: () => NOW, view: async <T,>() => onChain as T, commit: async () => (calls++, "TX") });
    await mk(null).tick();
    expect(calls).toBe(0);
    expect(repo.getChainHead(TRADER)!.committed_count).toBe(0);
    await mk({ trade_count: "1", head_hash: head.head_hash, last_commit_at: "1" }).tick();
    expect(calls).toBe(0);
    expect(repo.getChainHead(TRADER)!.committed_count).toBe(1);
  });
});
