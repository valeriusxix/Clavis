import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, type Ctx } from "../app";
import { ChallengeStore, LOGIN_MESSAGE, type LoginNetwork } from "../auth/nep413";
import { clearSession, setSession } from "../auth/session";
import { DEMO_VIEWER } from "../demo/seedDb";

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

  // Demo mode only: session as demo-viewer, no wallet needed.
  app.post("/api/demo/login", async (_req, reply) => {
    if (!ctx.config.DEMO_MODE) throw new ApiError(404, "DEMO_DISABLED", "Demo mode is off.");
    const s = setSession(reply, { sub: DEMO_VIEWER, kind: "demo" }, ctx.now(), ctx.cookie);
    return { account: s.sub, kind: s.kind, banner: "Demo account — key purchase simulated" };
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
