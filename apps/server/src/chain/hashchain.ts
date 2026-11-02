// Server side of the shared hash chain: same code as the browser, with node:crypto as sha256.
import { createHash } from "node:crypto";
import { chainHashes, computeHead, genesisHash, type LogEntry, type Sha256Hex } from "@clavis/shared";

export const nodeSha256Hex: Sha256Hex = async (input) =>
  createHash("sha256").update(input, "utf8").digest("hex");

export const serverGenesis = (traderId: string) => genesisHash(traderId, nodeSha256Hex);
export const serverHead = (traderId: string, entries: readonly LogEntry[]) =>
  computeHead(traderId, entries, nodeSha256Hex);
export const serverChain = (traderId: string, entries: readonly LogEntry[]) =>
  chainHashes(traderId, entries, nodeSha256Hex);
