import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, type Ctx } from "../app";
import { refreshChainHead } from "../chain/log";
import type { TradeRow } from "../db/db";
import { DEMO_SIM_CAP } from "../demo/demoAccounts";
import { RateLimiter } from "../lib/rateLimit";
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
  /** Simulate fill: at most 10 per minute per account (AUDIT M3). */
  const simulateLimit = new RateLimiter(10, 60_000, ctx.now);
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
    if (!body.dry && (session.kind !== "wallet" || !session.payer)) {
      throw new ApiError(403, "REAL_MODE_NEEDS_MAINNET_WALLET", "Real trades need the linked mainnet wallet. Dry run works with the demo account.");
    }
    const origin = ctx.tokens.find(body.originAsset);
    const dest = ctx.tokens.find(body.destinationAsset);
    if (!origin || !dest) throw new ApiError(400, "UNKNOWN_ASSET", "originAsset/destinationAsset must come from /api/tokens.");
    const cap = ctx.config.REAL_TRADE_MAX_USD;
    if (!body.dry) {
      // Real mode: NEAR-chain tokens only, so the deposit is one wallet transaction and the output goes
      // back to the same mainnet account; hard cap per trade (AGENT.md hard rule 7).
      if (origin.blockchain !== "near" || dest.blockchain !== "near") {
        throw new ApiError(400, "NEAR_TOKENS_ONLY", "Real trades use NEAR-chain tokens only (for example NEAR → USDC).");
      }
      const estimate = Number(body.amountHuman) * origin.price;
      if (!(estimate > 0) || estimate > cap) {
        throw new ApiError(400, "OVER_CAP", `Real trades are capped at $${cap}. This one is about $${estimate.toFixed(2)}.`);
      }
    }

    let amount: string;
    try {
      amount = toBaseUnits(body.amountHuman, origin.decimals);
    } catch (err) {
      throw new ApiError(400, "BAD_AMOUNT", `${(err as Error).message}. ${origin.symbol} has ${origin.decimals} decimals.`);
    }
    const request: QuoteRequest = {
      dry: body.dry,
      swapType: "EXACT_INPUT" as QuoteRequest.swapType,
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN" as QuoteRequest.depositType,
      destinationAsset: dest.assetId,
      amount,
      recipient: body.dry ? (body.recipient ?? DRY_QUOTE_ACCOUNT) : session.payer!,
      recipientType: "DESTINATION_CHAIN" as QuoteRequest.recipientType,
      refundTo: body.dry ? (body.refundTo ?? DRY_QUOTE_ACCOUNT) : session.payer!,
      refundType: "ORIGIN_CHAIN" as QuoteRequest.refundType,
      confidentiality: "basic" as QuoteRequest.confidentiality,
      deadline: new Date(ctx.now() + 10 * 60_000).toISOString(),
      referral: "clavis",
    };

    let response: QuoteResponse;
    let notice: string | null = null;
    try {
      try {
        response = await ctx.oneclick.getQuote(request);
      } catch (err) {
        if (!(err instanceof OneClickError && err.status === 401 && body.dry && !ctx.oneclick.hasApiKey)) throw err;
        // Confidential quotes need a 1Click partner key. Fall back to a clearly labelled PUBLIC dry quote.
        const { confidentiality: _omit, ...publicRequest } = request;
        response = await ctx.oneclick.getQuote(publicRequest as QuoteRequest);
        notice = "No 1Click API key is configured, so this is a PUBLIC dry quote. Confidential (basic) quotes need a partner key.";
      }
    } catch (err) {
      if (!(err instanceof OneClickError)) throw err;
      // 1Click refused this request (e.g. "Amount is too low", "No liquidity available"): say why (AUDIT M1).
      const reason = (err.body as { message?: unknown } | null)?.message;
      if (err.status === 400 && typeof reason === "string") {
        throw new ApiError(400, "QUOTE_REJECTED", `1Click could not quote this trade: ${reason}.`, { detail: err.message });
      }
      const why = err.status === null ? "the 1Click API is unreachable right now" : `1Click answered HTTP ${err.status}`;
      throw new ApiError(502, "ONECLICK_ERROR", `Could not get a quote: ${why}. Please try again in a minute.`, { detail: err.message });
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
        style: session.kind === "demo" ? "your demo profile" : null,
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
    if (!body.dry) {
      row.payer = session.payer ?? null;
      if (!(Number(q.amountInUsd) <= cap * 1.02) || !q.depositAddress) {
        row.status = "FAILED";
        ctx.repo.insertTrade(row);
        throw new ApiError(400, "OVER_CAP", `1Click priced this trade at $${q.amountInUsd}, above the $${cap} cap. Nothing was sent.`);
      }
      row.status = "PENDING_DEPOSIT";
    }
    ctx.repo.insertTrade(row);

    // AUDIT C4: if the output lands on-chain in the account that pays, anyone can see both sides.
    const payer = body.dry ? null : (session.payer ?? null);
    const backToPayer = payer !== null && request.recipientType === "DESTINATION_CHAIN" && request.recipient === payer;

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
      routing: {
        recipient: request.recipient,
        recipientType: request.recipientType,
        payer,
        privacyWarning: backToPayer
          ? `The output goes back to ${payer}, the same public account that pays. Anyone looking at that account on an explorer can see what this trade bought.`
          : null,
      },
      correlationId: response.correlationId,
      timestamp: response.timestamp,
    };
  });

  // Record a SIMULATED fill from one of your dry quotes. It enters your own log, labeled SIMULATED.
  app.post<{ Params: { id: string } }>("/api/trades/:id/simulate", async (req) => {
    const session = ctx.requireSession(req);
    if (!simulateLimit.hit(session.sub)) throw new ApiError(429, "RATE_LIMITED", "Too many simulated fills. Wait a minute and try again.");
    const trade = ownTrade(req.params.id, session.sub);
    if (session.kind === "demo" && ctx.repo.settledTrades(session.sub).length >= DEMO_SIM_CAP) {
      throw new ApiError(429, "DEMO_LIMIT", `A demo account can record up to ${DEMO_SIM_CAP} simulated trades. Use "Reset demo" to start over.`);
    }
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
      signature_valid: null, // a simulated fill is not a signed trade (AUDIT L3)
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
        nearSenderAccount: body.nearSenderAccount ?? session.payer ?? session.sub,
        ...(trade.deposit_memo ? { memo: trade.deposit_memo } : {}),
      });
    } catch (err) {
      if (err instanceof OneClickError) throw new ApiError(502, "ONECLICK_ERROR", err.message);
      throw err;
    }
    ctx.repo.updateTrade(trade.id, { tx_hash: body.txHash, status: "KNOWN_DEPOSIT_TX", payer: session.payer ?? trade.payer ?? null });
    return { trade: feedRow(ctx.repo.getTrade(trade.id)!) };
  });

  app.get<{ Params: { id: string } }>("/api/trades/:id", async (req) => {
    const session = ctx.requireSession(req);
    const trade = ownTrade(req.params.id, session.sub);
    return { trade: feedRow(trade), depositAddress: trade.deposit_address, depositMemo: trade.deposit_memo };
  });
}
