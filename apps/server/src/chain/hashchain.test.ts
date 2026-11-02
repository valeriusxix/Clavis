import { computeHead, webCryptoSha256Hex, type LogEntry } from "@clavis/shared";
import { describe, expect, it } from "vitest";
import { nodeSha256Hex, serverGenesis, serverHead } from "./hashchain";

/** Deterministic pseudo-random entries, including non-ASCII text to exercise UTF-8 encoding. */
function entries(traderId: string, n: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    traderId,
    settledAt: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(),
    originAsset: i % 2 ? "nep141:wrap.near" : "nep141:usdt.tether-token.near",
    destAsset: i % 2 ? "nep141:usdt.tether-token.near" : "nep141:wrap.near",
    amountIn: String(10n ** 24n * BigInt(i + 1)),
    amountOut: String(4_123_456 * (i + 1)),
    amountInUsd: (4.2 * (i + 1)).toFixed(6),
    amountOutUsd: (4.1 * (i + 1)).toFixed(6),
    confidentiality: i % 3 === 0 ? "simulated" : "basic",
    quoteSignature: i % 3 === 0 ? null : `ed25519:sig-${i}-ü✓`,
    correlationId: i % 3 === 0 ? null : `corr-${i}`,
  }));
}

describe("hash chain: browser (Web Crypto) ≡ server (node:crypto)", () => {
  it("sha256 adapters agree on ASCII and non-ASCII input", async () => {
    for (const s of ["", "clavis:v1:alice.near", "ü✓ 日本 🔑", "x".repeat(10_000)]) {
      expect(await nodeSha256Hex(s)).toBe(await webCryptoSha256Hex(s));
    }
  });

  it("heads agree for logs of many sizes", async () => {
    for (const n of [0, 1, 2, 7, 60]) {
      const log = entries("quiet-whale", n);
      expect(await serverHead("quiet-whale", log)).toBe(await computeHead("quiet-whale", log, webCryptoSha256Hex));
    }
  });

  it("server genesis matches the on-chain head of a fresh trader", async () => {
    // clavis-app.testnet get_commitment for clavis-test-trader.testnet before its first commit
    expect(await serverGenesis("clavis-test-trader.testnet")).toBe(
      "5f2d015b90ee184e4a052c28c3f6cc58ae93a45e8d59e45e2b2c6772cbf2bcaa",
    );
  });
});
