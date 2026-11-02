// Polls GET /v0/status for real trades that are waiting on 1Click (AGENT.md 8.2).
// On SUCCESS: store the full status response, take the final amounts from swapDetails when present
// (otherwise keep the quote amounts and mark them "quoted"), assign seq, and extend the hash chain.
import { refreshChainHead } from "../chain/log";
import type { Repo, TradeRow, TradeStatus } from "../db/db";
import type { OneClickClient } from "../oneclick/client";
import type { GetExecutionStatusResponse } from "../oneclick/types";

type Deps = {
  repo: Repo;
  oneclick: Pick<OneClickClient, "getStatus">;
  now: () => number;
  /** Called after a trade settles (the committer picks it up). */
  onSettled?: (traderId: string) => void;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

const KNOWN: ReadonlySet<string> = new Set([
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "SUCCESS",
  "INCOMPLETE_DEPOSIT",
  "REFUNDED",
  "FAILED",
]);

export class StatusPoller {
  constructor(private readonly deps: Deps) {}

  async tick(): Promise<void> {
    for (const trade of this.deps.repo.nonTerminalTrades()) {
      let st: GetExecutionStatusResponse;
      try {
        st = await this.deps.oneclick.getStatus(trade.deposit_address!, trade.deposit_memo ?? undefined);
      } catch (err) {
        this.deps.log?.("status poll failed", { tradeId: trade.id, err: (err as Error).message });
        continue;
      }
      const status = String(st.status);
      if (!KNOWN.has(status)) {
        this.deps.log?.("unknown 1Click status", { tradeId: trade.id, status });
        continue;
      }
      if (status === "SUCCESS") await this.settle(trade, st);
      else this.deps.repo.updateTrade(trade.id, { status: status as TradeStatus, status_json: JSON.stringify(st) });
    }
  }

  private async settle(trade: TradeRow, st: GetExecutionStatusResponse): Promise<void> {
    const d = st.swapDetails ?? ({} as GetExecutionStatusResponse["swapDetails"]);
    const final = Boolean(d.amountIn && d.amountInFormatted && d.amountInUsd && d.amountOut && d.amountOutFormatted && d.amountOutUsd);
    const updated = Date.parse(st.updatedAt);
    const { repo } = this.deps;
    repo.transaction(() => {
      repo.updateTrade(trade.id, {
        status: "SUCCESS",
        status_json: JSON.stringify(st),
        seq: repo.nextSeq(trade.trader_id),
        settled_at: new Date(Number.isFinite(updated) ? updated : this.deps.now()).toISOString(),
        amounts_source: final ? "final" : "quoted",
        ...(final
          ? {
              amount_in: d.amountIn!,
              amount_in_formatted: d.amountInFormatted!,
              amount_in_usd: d.amountInUsd!,
              amount_out: d.amountOut!,
              amount_out_formatted: d.amountOutFormatted!,
              amount_out_usd: d.amountOutUsd!,
            }
          : {}),
      });
    });
    await refreshChainHead(repo, trade.trader_id);
    this.deps.log?.("trade settled", { tradeId: trade.id, traderId: trade.trader_id, amounts: final ? "final" : "quoted" });
    this.deps.onSettled?.(trade.trader_id);
  }

  start(intervalMs = 5_000): () => void {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await this.tick();
      } finally {
        running = false;
      }
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
