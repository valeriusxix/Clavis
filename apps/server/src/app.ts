import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { ViewFn } from "./chain/nearView";
import { seedAccountsOf, type Config } from "./config";
import type { Repo } from "./db/db";
import { simTraderId, SEED_TRADERS } from "./demo/seed";
import type { OneClickClient } from "./oneclick/client";
import type { TokenCache } from "./oneclick/tokens";
import type { Verifier } from "./auth/nep413";
import { ClavisRelayAdapter, type DisclosureAdapter } from "./disclosure/adapter";
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
  /** Same, against mainnet RPC: real mode logs in with the mainnet wallet that sends deposits. */
  verifyNep413Mainnet?: Verifier;
  /** Allowed browser origins for CORS (credentials). */
  webOrigins: string[];
  cookie: CookieOptions;
  logger?: boolean;
  /** Seeded trader account -> register_trader tx, from `pnpm seed:chain` (Verify panel link). */
  registrations?: ReadonlyMap<string, string>;
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
  disclosure: DisclosureAdapter;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cookie, { secret: deps.sessionSecret });
  await app.register(cors, { origin: deps.webOrigins, credentials: true });

  const disclosure: DisclosureAdapter = new ClavisRelayAdapter({
    repo: deps.repo,
    now: deps.now,
    contractId: deps.config.CLAVIS_CONTRACT_ID,
    view: deps.view,
    onViewError: (err) => app.log.warn({ err }, "has_access view call failed"),
  });
  const ctx: Ctx = {
    ...deps,
    seededIds: new Set(SEED_TRADERS.map((t) => simTraderId(t.handle, seedAccountsOf(deps.config)))),
    session: (req) => getSession(req, deps.now()),
    requireSession(req) {
      const s = getSession(req, deps.now());
      if (!s) throw new ApiError(401, "UNAUTHENTICATED", "Log in first (demo account or wallet).");
      return s;
    },
    canSeeFeed: (session, traderId) => disclosure.canSee(session, traderId),
    disclosure,
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
