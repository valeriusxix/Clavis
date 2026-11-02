import type {} from "@fastify/cookie"; // request.cookies / reply.setCookie type augmentation
import type { FastifyReply, FastifyRequest } from "fastify";

/** HTTP-only, signed session cookie. `demo` = demo-viewer (no wallet); `wallet` = NEP-413 login. */
export type Session = { sub: string; kind: "demo" | "wallet"; exp: number };

export const SESSION_COOKIE = "clavis_session";
const MAX_AGE_S = 7 * 24 * 3600;

export type CookieOptions = { secure: boolean; sameSite: "lax" | "none" };

export function setSession(reply: FastifyReply, s: Omit<Session, "exp">, now: number, opts: CookieOptions): Session {
  const session: Session = { ...s, exp: now + MAX_AGE_S * 1000 };
  reply.setCookie(SESSION_COOKIE, Buffer.from(JSON.stringify(session)).toString("base64url"), {
    signed: true,
    httpOnly: true,
    path: "/",
    maxAge: MAX_AGE_S,
    secure: opts.secure,
    sameSite: opts.sameSite,
  });
  return session;
}

export function getSession(request: FastifyRequest, now: number): Session | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  try {
    const s = JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8")) as Session;
    return s.exp > now && typeof s.sub === "string" ? s : null;
  } catch {
    return null;
  }
}

export function clearSession(reply: FastifyReply, opts: CookieOptions): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", secure: opts.secure, sameSite: opts.sameSite });
}
