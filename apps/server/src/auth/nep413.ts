// Wallet login by signed message (NEP-413), as in docs.near.org "Backend Authentication":
// the server issues a one-time random nonce, the wallet signs { message, recipient, nonce }, and the
// server verifies with near-api-js verifyMessage, which checks the ed25519 signature AND that the
// public key is a FullAccess key of the account (RPC view_access_key).
import { randomBytes } from "node:crypto";
import { JsonRpcProvider, type Provider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";

export const LOGIN_MESSAGE = "Log in to Clavis";
const NONCE_TTL_MS = 5 * 60_000;

export type Verifier = (args: { accountId: string; publicKey: string; signature: Uint8Array; nonce: Uint8Array; recipient: string }) => Promise<void>;

export function makeNearVerifier(rpcUrlOrProvider: string | Provider): Verifier {
  const provider = typeof rpcUrlOrProvider === "string" ? new JsonRpcProvider({ url: rpcUrlOrProvider }) : rpcUrlOrProvider;
  return ({ accountId, publicKey, signature, nonce, recipient }) =>
    verifyMessage({
      signerAccountId: accountId,
      signerPublicKey: publicKey,
      signature,
      payload: { message: LOGIN_MESSAGE, recipient, nonce },
      provider,
    });
}

/** One-time login challenges, kept in memory (a restart just means signing again). */
export class ChallengeStore {
  private readonly pending = new Map<string, number>();
  constructor(private readonly now: () => number) {}

  issue(): { nonce: string; expiresAt: number } {
    this.sweep();
    const nonce = randomBytes(32).toString("base64");
    const expiresAt = this.now() + NONCE_TTL_MS;
    this.pending.set(nonce, expiresAt);
    return { nonce, expiresAt };
  }

  /** True once per issued, unexpired nonce. */
  consume(nonce: string): boolean {
    const exp = this.pending.get(nonce);
    this.pending.delete(nonce);
    return exp !== undefined && exp > this.now();
  }

  private sweep() {
    const t = this.now();
    for (const [n, exp] of this.pending) if (exp <= t) this.pending.delete(n);
  }
}
