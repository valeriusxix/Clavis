// What `pnpm export:real` writes to apps/server/src/demo/real-trades.json (AUDIT H5).
// Full data, on purpose (the human's decision): the signed quotes stay re-checkable and the deposit
// txs show execution. The file is seed data only: the server loads it into the database, and the
// real trader's feed stays locked until a key is bought. Only the separate dev account's trades
// may be exported.
import type { Repo, TradeRow } from "../db/db";
import type { RealTradesFile } from "./seedDb";

/** Every account a trade touches: who paid, where the output went, where a refund would go. */
export function accountsOf(t: TradeRow): string[] {
  let req: { recipient?: string; refundTo?: string } = {};
  try {
    req = (JSON.parse(t.quote_json) as { quoteRequest?: typeof req }).quoteRequest ?? {};
  } catch {
    /* no quote request */
  }
  return [...new Set([t.payer, req.recipient, req.refundTo].filter((a): a is string => Boolean(a)))];
}

export function buildRealExport(repo: Repo, traderId: string, devAccount: string): RealTradesFile & { accounts: string[] } {
  const trader = repo.getTrader(traderId);
  if (!trader) throw new Error(`No trader ${traderId} in the database.`);
  const trades = repo.db
    .prepare(
      `SELECT * FROM trades WHERE trader_id = ? AND is_simulated = 0
         AND status IN ('SUCCESS','REFUNDED','FAILED','INCOMPLETE_DEPOSIT') ORDER BY created_at`,
    )
    .all(traderId) as TradeRow[];
  const accounts = new Set<string>();
  for (const t of trades) {
    for (const a of accountsOf(t)) {
      if (a !== devAccount) throw new Error(`Trade ${t.id} involves ${a}, not the dev account ${devAccount}. Nothing was exported.`);
      accounts.add(a);
    }
  }
  const head = repo.getChainHead(traderId);
  return {
    traders: [{ ...trader, is_simulated: 0 }],
    trades,
    commits: head?.commit_tx ? [{ traderId, tradeCount: head.committed_count, tx: head.commit_tx }] : [],
    accounts: [...accounts],
  };
}
