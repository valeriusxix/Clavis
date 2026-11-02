import type { FastifyInstance } from "fastify";
import type { Ctx } from "../app";
import { SEED_END } from "../demo/seed";

export function registerMetaRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/api/meta", async () => ({
    demoMode: ctx.config.DEMO_MODE,
    network: ctx.config.NETWORK,
    contractId: ctx.config.CLAVIS_CONTRACT_ID ?? null,
    hasOneClickKey: ctx.oneclick.hasApiKey,
    /** Confidential (basic) quotes need a 1Click partner key; without one, dry quotes fall back to PUBLIC. */
    confidentialQuotes: ctx.oneclick.hasApiKey,
    seedEnd: new Date(SEED_END).toISOString(),
    serverTime: new Date(ctx.now()).toISOString(),
  }));

  app.get("/api/tokens", async () => ({
    tokens: ctx.tokens.tokens,
    source: ctx.tokens.source,
    updatedAt: ctx.tokens.updatedAt,
  }));
}
