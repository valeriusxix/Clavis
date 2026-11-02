import { describe, expect, it } from "vitest";
import { canonicalJSON } from "./canonicalJson";
import { chainHashes, checkLogShape, computeHead, genesisHash } from "./hashchain";
import type { LogEntry } from "./types";

// Independent vectors computed with Python: json.dumps(sort_keys=True, separators=(",",":")) + hashlib.
const TRADER = "clavis-test-trader.testnet";
const E1: LogEntry = {
  seq: 1,
  traderId: TRADER,
  settledAt: "2026-11-02T10:00:00.000Z",
  originAsset: "nep141:wrap.near",
  destAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amountIn: "1000000000000000000000000",
  amountOut: "4194509",
  amountInUsd: "4.22",
  amountOutUsd: "4.192562747824",
  confidentiality: "basic",
  quoteSignature:
    "ed25519:3eL8HwPZPhKQ67sEwSAbSneTjvgdohTqYNosZ9ScFF4trbbA2yNF5Cm8GXs5RnLqWRJQ9j3zf9iPsC6yffZFxe9E",
  correlationId: "b79a1c62-0a60-475a-906c-987b7128f342",
};
const E2: LogEntry = {
  seq: 2,
  traderId: TRADER,
  settledAt: "2026-11-03T12:30:00.000Z",
  originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  destAsset: "nep141:wrap.near",
  amountIn: "4194509",
  amountOut: "990000000000000000000000",
  amountInUsd: "4.19",
  amountOutUsd: "4.21",
  confidentiality: "simulated",
  quoteSignature: null,
  correlationId: null,
};
const H0 = "5f2d015b90ee184e4a052c28c3f6cc58ae93a45e8d59e45e2b2c6772cbf2bcaa";
const H1 = "2dee7cca0978643b26e2a35e64f1bc60bad94d3ff40ed73cf70f75a22b5c0216";
const H2 = "7467b650dddf04ae2219c186029824d9637c5df2d9b3962fc11d1573eecb6f28";

describe("canonicalJSON", () => {
  it("sorts keys and drops whitespace (matches Python json.dumps(sort_keys=True))", () => {
    expect(canonicalJSON(E1)).toBe(
      '{"amountIn":"1000000000000000000000000","amountInUsd":"4.22","amountOut":"4194509","amountOutUsd":"4.192562747824","confidentiality":"basic","correlationId":"b79a1c62-0a60-475a-906c-987b7128f342","destAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","originAsset":"nep141:wrap.near","quoteSignature":"ed25519:3eL8HwPZPhKQ67sEwSAbSneTjvgdohTqYNosZ9ScFF4trbbA2yNF5Cm8GXs5RnLqWRJQ9j3zf9iPsC6yffZFxe9E","seq":1,"settledAt":"2026-11-02T10:00:00.000Z","traderId":"clavis-test-trader.testnet"}',
    );
  });

  it("is independent of key insertion order and sorts nested objects", () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, { y: 1, x: null }], c: "é" } })).toBe(
      '{"a":{"c":"é","d":[3,{"x":null,"y":1}]},"b":1}',
    );
  });

  it("rejects values JSON cannot represent exactly", () => {
    expect(() => canonicalJSON({ a: undefined })).toThrow();
    expect(() => canonicalJSON(Number.NaN)).toThrow();
    expect(() => canonicalJSON(1n)).toThrow();
  });
});

describe("hash chain", () => {
  it("h0 matches the head the NEAR contract stores for a fresh trader (clavis-app.testnet)", async () => {
    expect(await genesisHash(TRADER)).toBe(H0);
  });

  it("matches the independent Python vectors", async () => {
    expect(await chainHashes(TRADER, [E1, E2])).toEqual([H0, H1, H2]);
    expect(await computeHead(TRADER, [E1, E2])).toBe(H2);
  });

  it("empty log head is h0", async () => {
    expect(await computeHead(TRADER, [])).toBe(H0);
  });

  it("any edit changes the head", async () => {
    const edited = { ...E1, amountOut: "4194510" };
    expect(await computeHead(TRADER, [edited, E2])).not.toBe(H2);
    expect(await computeHead(TRADER, [E2, E1].map((e, i) => ({ ...e, seq: i + 1 })))).not.toBe(H2);
  });

  it("checkLogShape flags gaps, reordering and foreign entries", () => {
    expect(checkLogShape(TRADER, [E1, E2])).toEqual([]);
    expect(checkLogShape(TRADER, [E2])).toHaveLength(1);
    expect(checkLogShape("someone-else.near", [E1])).toHaveLength(1);
  });
});
