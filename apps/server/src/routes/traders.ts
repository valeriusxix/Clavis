import type { FastifyInstance } from "fastify";
import { ApiError, type Ctx } from "../app";
import type { TradeRow } from "../db/db";
import { DEMO_VIEWER } from "../demo/seedDb";
import { buildPricing, traderStats } from "../pnl/stats";
import type { QuoteResponse } from "../oneclick/types";
import { checkQuoteSignature } from "../oneclick/verifySignature";

/** A feed row: everything a key holder sees about one trade. */
export function feedRow(t: TradeRow) {
  const stableIn = ["USDC", "USDT", "DAI"].includes(t.origin_symbol.toUpperCase());
  const stableOut = ["USDC", "USDT", "DAI"].includes(t.dest_symbol.toUpperCase());
  const side = stableIn && !stableOut ? "BUY" : stableOut && !stableIn ? "SELL" : "SWAP";
  return {
    id: t.id,
    seq: t.seq,
    time: t.settled_at ?? t.created_at,
    pair: `${t.origin_symbol}→${t.dest_symbol}`,
    side,
    originAsset: t.origin_asset,
    originSymbol: t.origin_symbol,
    destAsset: t.dest_asset,
    destSymbol: t.dest_symbol,
    amountIn: t.amount_in_formatted,
    amountOut: t.amount_out_formatted,
    amountInUsd: t.amount_in_usd,
    amountOutUsd: t.amount_out_usd,
    status: t.status,
    simulated: t.is_simulated === 1,
    confidentiality: t.confidentiality,
    oneClickSigned: t.signature_valid === 1,
    txHash: t.tx_hash,
  };
}

export function registerTraderRoutes(app: FastifyInstance, ctx: Ctx) {
  const getTraderOr404 = (id: string) => {
    const t = ctx.repo.getTrader(id);
    if (!t) throw new ApiError(404, "TRADER_NOT_FOUND", `No trader ${id}`);
    return t;
  };

  // Leaderboard: PnL only, never trade details. Ranked by 30-day PnL %.
  app.get("/api/traders", async () => {
    const pricing = buildPricing(ctx.repo);
    const now = ctx.now();
    const traders = ctx.repo
      .listTraders()
      .filter((t) => t.account_id !== DEMO_VIEWER)
      .map((t) => traderStats(ctx.repo, t, pricing, now, ctx.seededIds).stats)
      .sort((a, b) => b.pnl30dPct - a.pnl30dPct);
    return { traders };
  });

  app.get<{ Params: { id: string } }>("/api/traders/:id", async (req) => {
    const trader = getTraderOr404(req.params.id);
    const { stats, curve } = traderStats(ctx.repo, trader, buildPricing(ctx.repo), ctx.now(), ctx.seededIds);
    const unlocked = await ctx.canSeeFeed(ctx.session(req), trader.account_id);
    return { trader: stats, equityCurve: curve, lockedCount: unlocked ? 0 : stats.tradeCount, unlocked };
  });

  const locked = () =>
    new ApiError(403, "LOCKED", "Buy a key for this trader to see their trades.", { locked: true });

  app.get<{ Params: { id: string } }>("/api/traders/:id/feed", async (req) => {
    const trader = getTraderOr404(req.params.id);
    if (!(await ctx.canSeeFeed(ctx.session(req), trader.account_id))) throw locked();
    return { traderId: trader.account_id, trades: ctx.disclosure.trades(trader.account_id).map(feedRow), source: ctx.disclosure.name };
  });

  // Canonical log for in-browser hash-chain verification (same access rule as the feed).
  app.get<{ Params: { id: string } }>("/api/traders/:id/log", async (req) => {
    const trader = getTraderOr404(req.params.id);
    if (!(await ctx.canSeeFeed(ctx.session(req), trader.account_id))) throw locked();
    const head = ctx.repo.getChainHead(trader.account_id);
    const signatures = Object.fromEntries(
      ctx.repo.settledTrades(trader.account_id).map((t) => [t.seq, t.signature_valid === null ? null : t.signature_valid === 1]),
    );
    return {
      traderId: trader.account_id,
      entries: ctx.disclosure.log(trader.account_id),
      /** Server-verified 1Click signature per seq (null = simulated / no signature). */
      signatureValid: signatures,
      head: head ? { tradeCount: head.trade_count, headHash: head.head_hash } : null,
      committed: head ? { count: head.committed_count, tx: head.commit_tx } : null,
      /** register_trader tx for seeded traders (from `pnpm seed:chain`), for an explorer link. */
      registrationTx: ctx.registrations?.get(trader.account_id) ?? null,
      contractId: ctx.config.CLAVIS_CONTRACT_ID ?? null,
      network: ctx.config.NETWORK,
    };
  });

  // "Re-verify": run the 1Click signature verifier again over every real trade in the log.
  app.post<{ Params: { id: string } }>("/api/traders/:id/reverify", async (req) => {
    const trader = getTraderOr404(req.params.id);
    if (!(await ctx.canSeeFeed(ctx.session(req), trader.account_id))) throw locked();
    const results: Record<string, boolean | null> = {};
    for (const t of ctx.repo.settledTrades(trader.account_id)) {
      if (t.is_simulated) {
        results[String(t.seq)] = null;
        continue;
      }
      const valid = checkQuoteSignature(JSON.parse(t.quote_json) as QuoteResponse).valid;
      results[String(t.seq)] = valid;
      ctx.repo.updateTrade(t.id, { signature_valid: valid ? 1 : 0 });
    }
    return { traderId: trader.account_id, results };
  });
}
