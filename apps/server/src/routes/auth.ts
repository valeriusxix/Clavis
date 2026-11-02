import type { FastifyInstance } from "fastify";
import { ApiError, type Ctx } from "../app";
import { clearSession, setSession } from "../auth/session";
import { DEMO_VIEWER } from "../demo/seedDb";

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  // Demo mode only: session as demo-viewer, no wallet needed.
  app.post("/api/demo/login", async (_req, reply) => {
    if (!ctx.config.DEMO_MODE) throw new ApiError(404, "DEMO_DISABLED", "Demo mode is off.");
    const s = setSession(reply, { sub: DEMO_VIEWER, kind: "demo" }, ctx.now(), ctx.cookie);
    return { account: s.sub, kind: s.kind, banner: "Demo account — key purchase simulated" };
  });

  app.get("/api/me", async (req) => {
    const s = ctx.session(req);
    return { session: s ? { account: s.sub, kind: s.kind } : null };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSession(reply, ctx.cookie);
    return { ok: true };
  });
  // POST /api/auth/nep413 (wallet login) is added in Phase 3 together with the wallet integration.
}
