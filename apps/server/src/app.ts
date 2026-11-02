import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { ViewFn } from "./chain/nearView";
import type { Config } from "./config";
import type { Repo } from "./db/db";
import { simTraderId, SEED_TRADERS } from "./demo/seed";
import type { OneClickClient } from "./oneclick/client";
import type { TokenCache } from "./oneclick/tokens";
import type { Verifier } from "./auth/nep413";
import { getSession, type CookieOptions, type Session } from "./auth/session";
import { registerAuthRoutes } from "./routes/auth";
import { registerKeyRoutes } from "./routes/keys";
import { registerMetaRoutes } from "./routes/meta";
import { registerTraderRoutes } from "./routes/traders";
import { registerTradeRoutes } from "./routes/trades";

export type OneClickLike = Pick<OneClickClient, "getQuote" | "submitDeposit" | "getStatus" | "hasApiKey">;

export type AppDeps = {
  config: Config;
  repo: Repo;
  oneclick: OneClickLike;
  tokens: TokenCache;
  now: () => number;
  sessionSecret: string;
  /** Contract view calls (has_access). Undefined when no contract is configured. */
  view?: ViewFn;
  /** NEP-413 verifier (signature + FullAccess key check via RPC). */
  verifyNep413?: Verifier;
  /** Allowed browser origins for CORS (credentials). */
  webOrigins: string[];
  cookie: CookieOptions;
  logger?: boolean;
};

/** JSON error with a stable code: { error: { code, message } } (AGENT.md 8.3). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type Ctx = AppDeps & {
  seededIds: ReadonlySet<string>;
  session: (req: FastifyRequest) => Session | null;
  requireSession: (req: FastifyRequest) => Session;
  canSeeFeed: (session: Session | null, traderId: string) => Promise<boolean>;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cookie, { secret: deps.sessionSecret });
  await app.register(cors, { origin: deps.webOrigins, credentials: true });

  const ctx: Ctx = {
    ...deps,
    seededIds: new Set(SEED_TRADERS.map((t) => simTraderId(t.handle))),
    session: (req) => getSession(req, deps.now()),
    requireSession(req) {
      const s = getSession(req, deps.now());
      if (!s) throw new ApiError(401, "UNAUTHENTICATED", "Log in first (demo account or wallet).");
      return s;
    },
    async canSeeFeed(session, traderId) {
      if (!session) return false;
      if (session.sub === traderId) return true; // traders always see their own feed
      const demoExpiry = deps.repo.getDemoAccessExpiry(traderId, session.sub);
      if (demoExpiry && Date.parse(demoExpiry) > deps.now()) return true;
      if (session.kind === "wallet" && deps.view && deps.config.CLAVIS_CONTRACT_ID) {
        try {
          return await deps.view<boolean>(deps.config.CLAVIS_CONTRACT_ID, "has_access", {
            trader_id: traderId,
            account_id: session.sub,
          });
        } catch (err) {
          app.log.warn({ err }, "has_access view call failed");
          return false;
        }
      }
      return false;
    },
  };

  app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message }, ...err.extra });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: "BAD_REQUEST", message: e.message ?? "Bad request" } });
    }
    app.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: `No route ${req.method} ${req.url}` } }),
  );

  registerMetaRoutes(app, ctx);
  registerTraderRoutes(app, ctx);
  registerTradeRoutes(app, ctx);
  registerKeyRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  return app;
}
