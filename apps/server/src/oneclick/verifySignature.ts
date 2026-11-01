// Quote signature verification.
//
// The NEAR Intents doc "Verify Quote Signatures" says: use `verifyQuoteSignature()` from
// @defuse-protocol/one-click-sdk-typescript (>= 0.1.24). It checks an ed25519 signature by the
// 1Click manager key over base58(sha256(json-stable-stringify({...signedRequestFields,
// ...signedQuoteFields, timestamp}))). Dry quotes sign a minimal payload (amounts only);
// non-dry quotes also sign depositAddress, deadline, etc.
// We call the SDK function directly instead of re-implementing it. See docs/DECISIONS.md.
import { quoteHash, verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import type { QuoteResponse } from "./types";

/**
 * 1Click production manager public key, as hard-coded (module-private) in
 * @defuse-protocol/one-click-sdk-typescript@0.1.26 src/quote-signature.ts.
 * Same value as the SDK's default. We pass it explicitly so tests can swap in the
 * staging key used by the SDK's own test fixtures.
 */
export const ONECLICK_MANAGER_PUBLIC_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

export type SignatureCheck = {
  valid: boolean;
  /** base58(sha256(stable JSON)) — the exact message the signature covers. */
  signedHash: string | null;
  publicKey: string;
  signature: string | null;
};

export function checkQuoteSignature(
  response: QuoteResponse,
  publicKey: string = ONECLICK_MANAGER_PUBLIC_KEY,
): SignatureCheck {
  let signedHash: string | null = null;
  try {
    signedHash = quoteHash(response);
  } catch {
    signedHash = null;
  }
  return {
    valid: Boolean(response?.signature) && verifyQuoteSignature(response, publicKey),
    signedHash,
    publicKey,
    signature: response?.signature ?? null,
  };
}
