import type { LogEntry } from "@clavis/shared";
import type { Repo, TradeRow } from "../db/db";
import { serverHead } from "./hashchain";

/** The canonical log entry for a settled trade (AGENT.md 11.1). */
export function toLogEntry(row: TradeRow): LogEntry {
  if (row.seq === null || row.settled_at === null) throw new Error(`trade ${row.id} is not settled`);
  let correlationId: string | null = null;
  if (!row.is_simulated) {
    try {
      correlationId = (JSON.parse(row.quote_json) as { correlationId?: string }).correlationId ?? null;
    } catch {
      correlationId = null;
    }
  }
  return {
    seq: row.seq,
    traderId: row.trader_id,
    settledAt: row.settled_at,
    originAsset: row.origin_asset,
    destAsset: row.dest_asset,
    amountIn: row.amount_in,
    amountOut: row.amount_out,
    amountInUsd: row.amount_in_usd,
    amountOutUsd: row.amount_out_usd,
    confidentiality: row.confidentiality,
    quoteSignature: row.quote_signature,
    correlationId,
  };
}

export function logOf(repo: Repo, traderId: string): LogEntry[] {
  return repo.settledTrades(traderId).map(toLogEntry);
}

/** Recompute and store the trader's chain head from the DB log. Returns { tradeCount, headHash }. */
export async function refreshChainHead(repo: Repo, traderId: string) {
  const log = logOf(repo, traderId);
  const headHash = await serverHead(traderId, log);
  repo.setChainHead(traderId, log.length, headHash);
  return { tradeCount: log.length, headHash };
}
