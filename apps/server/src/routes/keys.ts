import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, type Ctx } from "../app";

const DEMO_KEY_DAYS = 30;

export function registerKeyRoutes(app: FastifyInstance, ctx: Ctx) {
  // Demo mode only: simulate a key purchase in SQLite (no wallet, no funds).
  app.post("/api/demo/buy-key", async (req) => {
    if (!ctx.config.DEMO_MODE) throw new ApiError(404, "DEMO_DISABLED", "Demo mode is off.");
    const session = ctx.requireSession(req);
    if (session.kind !== "demo") throw new ApiError(403, "DEMO_ONLY", "Use the contract's buy_key with your wallet.");
    const { traderId } = z.object({ traderId: z.string().min(1) }).parse(req.body ?? {});
    if (!ctx.repo.getTrader(traderId)) throw new ApiError(404, "TRADER_NOT_FOUND", `No trader ${traderId}`);
    const current = ctx.repo.getDemoAccessExpiry(traderId, session.sub);
    const base = Math.max(ctx.now(), current ? Date.parse(current) : 0); // extends, like the contract
    const expiresAt = new Date(base + DEMO_KEY_DAYS * 86_400_000).toISOString();
    ctx.repo.grantDemoAccess(traderId, session.sub, expiresAt);
    return { traderId, holderId: session.sub, expiresAt, simulated: true };
  });

  // Keys the current session holds (demo keys from SQLite; wallet keys are read from the contract by the web app).
  app.get("/api/me/keys", async (req) => {
    const session = ctx.requireSession(req);
    const now = ctx.now();
    const keys = ctx.repo.demoKeysOf(session.sub).map((k) => ({
      traderId: k.trader_id,
      traderName: ctx.repo.getTrader(k.trader_id)?.display_name ?? k.trader_id,
      expiresAt: k.expires_at,
      active: Date.parse(k.expires_at) > now,
      simulated: true,
    }));
    return { account: session.sub, keys };
  });
}
