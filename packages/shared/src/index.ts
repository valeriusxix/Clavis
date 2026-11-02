// Shared between apps/web (browser) and apps/server (Node). Browser-safe: no node:* imports.
export type { LogEntry } from "./types";
export { canonicalJSON } from "./canonicalJson";
export { verificationContract } from "./verification";
export {
  HASH_CHAIN_PREFIX,
  bytesToHex,
  chainHashes,
  checkLogShape,
  computeHead,
  genesisHash,
  nextHash,
  webCryptoSha256Hex,
  type LogShapeProblem,
  type Sha256Hex,
} from "./hashchain";
