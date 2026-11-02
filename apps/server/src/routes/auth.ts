import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ApiError, type Ctx } from "../app";
import { ChallengeStore, LOGIN_MESSAGE, type LoginNetwork } from "../auth/nep413";
import { clearSession, setSession } from "../auth/session";
import { deleteDemoAccount, demoExpiresAt, isDemoId, newDemoId } from "../demo/demoAccounts";

const Nep413Body = z.object({
  accountId: z.string().min(2).max(64),
  publicKey: z.string().startsWith("ed25519:"),
  signature: z.string().min(1), // base64, as returned by wallet.signMessage
  nonce: z.string().min(1), // base64, from /api/auth/challenge
});

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const challenges = new ChallengeStore(ctx.now);
  const recipient = ctx.config.CLAVIS_CONTRACT_ID ?? "clavis";

  // ?network=mainnet is for real mode: a mainnet wallet logs in as its linked real trader.
  app.get<{ Querystring: { network?: string } }>("/api/auth/challenge", async (req) => {
    const network: LoginNetwork = req.query.network === "mainnet" ? "mainnet" : "testnet";
    const c = challenges.issue(network);
    return { nonce: c.nonce, message: LOGIN_MESSAGE, recipient, network, expiresAt: new Date(c.expiresAt).toISOString() };
  });

  // Verify a NEP-413 signed message -> wallet session.
  app.post("/api/auth/nep413", async (req, reply) => {
    const body = Nep413Body.parse(req.body ?? {});
    const network = challenges.consume(body.nonce);
    if (!network) throw new ApiError(401, "BAD_CHALLENGE", "Unknown or expired login challenge. Try again.");
    const verify = network === "mainnet" ? ctx.verifyNep413Mainnet : ctx.verifyNep413;
    if (!verify) throw new ApiError(503, "WALLET_LOGIN_UNAVAILABLE", `Wallet login (${network}) is not configured on this server.`);
    // Mainnet logins are only for real mode, and only for the configured, linked account.
    if (network === "mainnet" && (!ctx.config.REAL_TRADER_ID || body.accountId !== ctx.config.REAL_TRADER_MAINNET_ACCOUNT)) {
      throw new ApiError(403, "NOT_LINKED", `${body.accountId} is not linked to a Clavis trader on this server.`);
    }
    try {
      await verify({
        accountId: body.accountId,
        publicKey: body.publicKey,
        signature: new Uint8Array(Buffer.from(body.signature, "base64")),
        nonce: new Uint8Array(Buffer.from(body.nonce, "base64")),
        recipient,
      });
    } catch (err) {
      throw new ApiError(401, "BAD_SIGNATURE", `Login rejected: ${(err as Error).message}`);
    }
    const s =
      network === "mainnet"
        ? setSession(reply, { sub: ctx.config.REAL_TRADER_ID!, kind: "wallet", payer: body.accountId }, ctx.now(), ctx.cookie)
        : setSession(reply, { sub: body.accountId, kind: "wallet" }, ctx.now(), ctx.cookie);
    return { account: s.sub, kind: s.kind, payer: s.payer ?? null };
  });

  // Demo mode only: each visitor gets their own demo account, no wallet needed (AUDIT M3). The id lives
  // in the http-only session cookie, which expires with the account (24 h).
  const DEMO_BANNER = "Demo account — key purchase simulated";
  const startDemo = (reply: FastifyReply) => {
    const id = newDemoId(ctx.now());
    const maxAgeS = Math.floor((demoExpiresAt(id) - ctx.now()) / 1000);
    const s = setSession(reply, { sub: id, kind: "demo" }, ctx.now(), ctx.cookie, maxAgeS);
    return { account: s.sub, kind: s.kind, banner: DEMO_BANNER };
  };

  app.post("/api/demo/login", async (req, reply) => {
    if (!ctx.config.DEMO_MODE) throw new ApiError(404, "DEMO_DISABLED", "Demo mode is off.");
    const current = ctx.session(req);
    if (current?.kind === "demo" && isDemoId(current.sub)) return { account: current.sub, kind: current.kind, banner: DEMO_BANNER };
    return startDemo(reply);
  });

  // "Reset demo": delete this visitor's demo keys and trades, and start a fresh demo account.
  app.post("/api/demo/reset", async (req, reply) => {
    if (!ctx.config.DEMO_MODE) throw new ApiError(404, "DEMO_DISABLED", "Demo mode is off.");
    const current = ctx.session(req);
    if (current?.kind === "demo") deleteDemoAccount(ctx.repo, current.sub);
    return startDemo(reply);
  });

  app.get("/api/me", async (req) => {
    const s = ctx.session(req);
    return { session: s ? { account: s.sub, kind: s.kind, payer: s.payer ?? null } : null };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSession(reply, ctx.cookie);
    return { ok: true };
  });
}
