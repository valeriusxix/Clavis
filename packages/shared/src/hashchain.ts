import { canonicalJSON } from "./canonicalJson";
import type { LogEntry } from "./types";

/**
 * Hash chain (AGENT.md 11.2), hex strings throughout:
 *   h0 = sha256("clavis:v1:" + traderId)
 *   hi = sha256(h(i-1) + canonicalJSON(entry_i))
 *   head = h_n, committed on-chain via commit_log(traderId, n, head)
 * The contract initializes each trader's on-chain head to h0, so an empty log already matches.
 *
 * sha256 is injected so the browser (Web Crypto) and the server (node:crypto) run the same code.
 */
export const HASH_CHAIN_PREFIX = "clavis:v1:";

/** sha256 of the UTF-8 bytes of `input`, as lowercase hex. */
export type Sha256Hex = (input: string) => Promise<string>;

/** Web Crypto implementation. Works in browsers and in Node >= 19 (globalThis.crypto). */
export const webCryptoSha256Hex: Sha256Hex = async (input) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
};

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function genesisHash(traderId: string, sha256Hex: Sha256Hex = webCryptoSha256Hex): Promise<string> {
  return sha256Hex(HASH_CHAIN_PREFIX + traderId);
}

export function nextHash(prev: string, entry: LogEntry, sha256Hex: Sha256Hex = webCryptoSha256Hex): Promise<string> {
  return sha256Hex(prev + canonicalJSON(entry));
}

/** All hashes [h0, h1, ..., hn]. */
export async function chainHashes(
  traderId: string,
  entries: readonly LogEntry[],
  sha256Hex: Sha256Hex = webCryptoSha256Hex,
): Promise<string[]> {
  const hashes = [await genesisHash(traderId, sha256Hex)];
  for (const entry of entries) hashes.push(await nextHash(hashes[hashes.length - 1]!, entry, sha256Hex));
  return hashes;
}

export async function computeHead(
  traderId: string,
  entries: readonly LogEntry[],
  sha256Hex: Sha256Hex = webCryptoSha256Hex,
): Promise<string> {
  const hashes = await chainHashes(traderId, entries, sha256Hex);
  return hashes[hashes.length - 1]!;
}

export type LogShapeProblem = { index: number; message: string };

/** Structural checks before hashing: seq must be 1..n in order, and every entry must belong to traderId. */
export function checkLogShape(traderId: string, entries: readonly LogEntry[]): LogShapeProblem[] {
  const problems: LogShapeProblem[] = [];
  entries.forEach((e, i) => {
    if (e.seq !== i + 1) problems.push({ index: i, message: `expected seq ${i + 1}, got ${e.seq}` });
    if (e.traderId !== traderId) problems.push({ index: i, message: `entry belongs to ${e.traderId}, not ${traderId}` });
  });
  return problems;
}
