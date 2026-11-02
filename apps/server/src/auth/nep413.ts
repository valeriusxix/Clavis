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

export type LoginNetwork = "testnet" | "mainnet";

/** One-time login challenges, kept in memory (a restart just means signing again). */
export class ChallengeStore {
  private readonly pending = new Map<string, { exp: number; network: LoginNetwork }>();
  constructor(private readonly now: () => number) {}

  issue(network: LoginNetwork = "testnet"): { nonce: string; expiresAt: number; network: LoginNetwork } {
    this.sweep();
    const nonce = randomBytes(32).toString("base64");
    const expiresAt = this.now() + NONCE_TTL_MS;
    this.pending.set(nonce, { exp: expiresAt, network });
    return { nonce, expiresAt, network };
  }

  /** The challenge's network, once per issued, unexpired nonce; otherwise null. */
  consume(nonce: string): LoginNetwork | null {
    const c = this.pending.get(nonce);
    this.pending.delete(nonce);
    return c !== undefined && c.exp > this.now() ? c.network : null;
  }

  private sweep() {
    const t = this.now();
    for (const [n, c] of this.pending) if (c.exp <= t) this.pending.delete(n);
  }
}
