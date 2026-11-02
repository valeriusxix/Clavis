import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, type Ctx } from "../app";
import { refreshChainHead } from "../chain/log";
import type { TradeRow } from "../db/db";
import { toBaseUnits } from "../lib/units";
import { OneClickError } from "../oneclick/client";
import type { QuoteRequest, QuoteResponse } from "../oneclick/types";
import { checkQuoteSignature } from "../oneclick/verifySignature";
import { feedRow } from "./traders";

/**
 * Dry quotes need an existing mainnet account as recipient/refundTo even though nothing is sent
 * (1Click answers 400 for non-existent accounts). Real quotes always use the trader's own addresses.
 */
export const DRY_QUOTE_ACCOUNT = "intents.near";

const QuoteBody = z.object({
  originAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amountHuman: z.string().regex(/^\d+(\.\d+)?$/, "amountHuman must be a plain decimal like 1 or 0.5"),
  recipient: z.string().min(1).optional(),
  refundTo: z.string().min(1).optional(),
  dry: z.boolean().default(true),
});

const DepositBody = z.object({ txHash: z.string().min(1), nearSenderAccount: z.string().optional() });

export function registerTradeRoutes(app: FastifyInstance, ctx: Ctx) {
  const ownTrade = (tradeId: string, sub: string): TradeRow => {
    const t = ctx.repo.getTrade(tradeId);
    if (!t) throw new ApiError(404, "TRADE_NOT_FOUND", `No trade ${tradeId}`);
    if (t.trader_id !== sub) throw new ApiError(403, "FORBIDDEN", "Not your trade.");
    return t;
  };

  // Request a 1Click quote with confidentiality "basic". Dry run is the default.
  app.post("/api/trades/quote", async (req) => {
    const session = ctx.requireSession(req);
    const body = QuoteBody.parse(req.body ?? {});
    if (!body.dry && session.kind !== "wallet") {
      throw new ApiError(403, "REAL_MODE_NEEDS_WALLET", "Real trades need a connected wallet. Dry run works with the demo account.");
    }
    const origin = ctx.tokens.find(body.originAsset);
    const dest = ctx.tokens.find(body.destinationAsset);
    if (!origin || !dest) throw new ApiError(400, "UNKNOWN_ASSET", "originAsset/destinationAsset must come from /api/tokens.");
    if (!body.dry && (!body.recipient || !body.refundTo)) {
      throw new ApiError(400, "RECIPIENT_REQUIRED", "Real quotes need your own recipient and refundTo addresses.");
    }

    const request: QuoteRequest = {
      dry: body.dry,
      swapType: "EXACT_INPUT" as QuoteRequest.swapType,
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN" as QuoteRequest.depositType,
      destinationAsset: dest.assetId,
      amount: toBaseUnits(body.amountHuman, origin.decimals),
      recipient: body.recipient ?? DRY_QUOTE_ACCOUNT,
      recipientType: "DESTINATION_CHAIN" as QuoteRequest.recipientType,
      refundTo: body.refundTo ?? DRY_QUOTE_ACCOUNT,
      refundType: "ORIGIN_CHAIN" as QuoteRequest.refundType,
      confidentiality: "basic" as QuoteRequest.confidentiality,
      deadline: new Date(ctx.now() + 10 * 60_000).toISOString(),
      referral: "clavis",
    };

    let response: QuoteResponse;
    let notice: string | null = null;
    try {
      response = await ctx.oneclick.getQuote(request);
    } catch (err) {
      if (err instanceof OneClickError && err.status === 401 && body.dry && !ctx.oneclick.hasApiKey) {
        // Confidential quotes need a 1Click partner key. Fall back to a clearly labelled PUBLIC dry quote.
        const { confidentiality: _omit, ...publicRequest } = request;
        response = await ctx.oneclick.getQuote(publicRequest as QuoteRequest);
        notice = "No 1Click API key is configured, so this is a PUBLIC dry quote. Confidential (basic) quotes need a partner key.";
      } else if (err instanceof OneClickError) {
        const reason = err.status === null ? "the 1Click API is unreachable right now" : `1Click answered HTTP ${err.status}`;
        throw new ApiError(502, "ONECLICK_ERROR", `Could not get a quote: ${reason}. Please try again in a minute.`, { detail: err.message });
      } else {
        throw err;
      }
    }

    const sig = checkQuoteSignature(response);
    const echoed = response.quoteRequest?.confidentiality ?? "public";
    if (!ctx.repo.getTrader(session.sub)) {
      ctx.repo.upsertTrader({
        account_id: session.sub,
        display_name: session.sub,
        is_simulated: session.kind === "demo" ? 1 : 0,
        created_at: new Date(ctx.now()).toISOString(),
        key_price_yocto: "0",
        period_days: 30,
        style: null,
      });
    }
    const q = response.quote;
    const row: TradeRow = {
      id: randomUUID(),
      trader_id: session.sub,
      seq: null,
      status: "QUOTED",
      is_simulated: session.kind === "demo" ? 1 : 0,
      origin_asset: origin.assetId,
      origin_symbol: origin.symbol,
      dest_asset: dest.assetId,
      dest_symbol: dest.symbol,
      amount_in: q.amountIn,
      amount_in_formatted: q.amountInFormatted,
      amount_in_usd: q.amountInUsd,
      amount_out: q.amountOut,
      amount_out_formatted: q.amountOutFormatted,
      amount_out_usd: q.amountOutUsd,
      confidentiality: (echoed === "basic" || echoed === "advanced" ? echoed : "simulated") as TradeRow["confidentiality"],
      deposit_address: q.depositAddress ?? null,
      deposit_memo: q.depositMemo ?? null,
      tx_hash: null,
      quote_json: JSON.stringify(response),
      quote_signature: response.signature ?? null,
      signature_valid: sig.valid ? 1 : 0,
      created_at: new Date(ctx.now()).toISOString(),
      settled_at: null,
    };
    ctx.repo.insertTrade(row);
    if (!body.dry) ctx.repo.updateTrade(row.id, { status: "PENDING_DEPOSIT" });

    return {
      tradeId: row.id,
      dry: body.dry,
      confidentiality: echoed,
      confidential: echoed === "basic" || echoed === "advanced",
      notice,
      quote: {
        amountIn: q.amountIn,
        amountInFormatted: q.amountInFormatted,
        amountInUsd: q.amountInUsd,
        amountOut: q.amountOut,
        amountOutFormatted: q.amountOutFormatted,
        amountOutUsd: q.amountOutUsd,
        minAmountOut: q.minAmountOut,
        timeEstimate: q.timeEstimate,
        deadline: q.deadline ?? null,
        depositAddress: q.depositAddress ?? null,
        depositMemo: q.depositMemo ?? null,
      },
      origin: { assetId: origin.assetId, symbol: origin.symbol },
      destination: { assetId: dest.assetId, symbol: dest.symbol },
      signature: { valid: sig.valid, publicKey: sig.publicKey, signature: sig.signature },
      correlationId: response.correlationId,
      timestamp: response.timestamp,
    };
  });

  // Record a SIMULATED fill from one of your dry quotes. It enters your own log, labeled SIMULATED.
  app.post<{ Params: { id: string } }>("/api/trades/:id/simulate", async (req) => {
    const session = ctx.requireSession(req);
    const trade = ownTrade(req.params.id, session.sub);
    const quote = JSON.parse(trade.quote_json) as QuoteResponse;
    if (trade.status !== "QUOTED" || quote.quoteRequest?.dry !== true) {
      throw new ApiError(409, "NOT_SIMULATABLE", "Only an unfilled dry quote can be simulated.");
    }
    const seq = ctx.repo.nextSeq(session.sub);
    ctx.repo.updateTrade(trade.id, {
      status: "SIMULATED",
      seq,
      is_simulated: 1,
      confidentiality: "simulated",
      quote_signature: null,
      settled_at: new Date(ctx.now()).toISOString(),
    });
    const head = await refreshChainHead(ctx.repo, session.sub);
    return { trade: feedRow(ctx.repo.getTrade(trade.id)!), head };
  });

  // Real mode: the wallet sent the deposit; tell 1Click (optional, speeds up detection).
  app.post<{ Params: { id: string } }>("/api/trades/:id/deposit", async (req) => {
    const session = ctx.requireSession(req);
    if (session.kind !== "wallet") throw new ApiError(403, "REAL_MODE_NEEDS_WALLET", "Real trades need a connected wallet.");
    const trade = ownTrade(req.params.id, session.sub);
    if (!trade.deposit_address) throw new ApiError(409, "NO_DEPOSIT_ADDRESS", "This quote has no deposit address (dry quote?).");
    const body = DepositBody.parse(req.body ?? {});
    try {
      await ctx.oneclick.submitDeposit({
        txHash: body.txHash,
        depositAddress: trade.deposit_address,
        ...(body.nearSenderAccount ? { nearSenderAccount: body.nearSenderAccount } : {}),
        ...(trade.deposit_memo ? { memo: trade.deposit_memo } : {}),
      });
    } catch (err) {
      if (err instanceof OneClickError) throw new ApiError(502, "ONECLICK_ERROR", err.message);
      throw err;
    }
    ctx.repo.updateTrade(trade.id, { tx_hash: body.txHash, status: "KNOWN_DEPOSIT_TX" });
    return { trade: feedRow(ctx.repo.getTrade(trade.id)!) };
  });

  app.get<{ Params: { id: string } }>("/api/trades/:id", async (req) => {
    const session = ctx.requireSession(req);
    const trade = ownTrade(req.params.id, session.sub);
    return { trade: feedRow(trade), depositAddress: trade.deposit_address, depositMemo: trade.deposit_memo };
  });
}
