import { describe, expect, it } from "vitest";
import { checkQuoteSignature, ONECLICK_MANAGER_PUBLIC_KEY } from "./verifySignature";
import {
  STAGING_DRY_QUOTE,
  STAGING_MANAGER_PUB_KEY,
  STAGING_NON_DRY_QUOTE,
} from "./__fixtures__/sdk-staging-quotes";
import type { QuoteResponse } from "./types";
// Real MAINNET dry quote (public, wNEAR -> NEAR USDC), captured by `pnpm smoke:quote` on 2026-11-01.
// Confidential (basic) quotes need credentials, so this one was requested without `confidentiality`.
import mainnetPublicDryQuoteJson from "./__fixtures__/mainnet-public-dry-quote.json";
// Real MAINNET *confidential* dry quote (confidentiality: "basic"), captured 2026-11-02 with the partner key.
import mainnetBasicDryQuoteJson from "./__fixtures__/mainnet-basic-dry-quote.json";

const MAINNET_PUBLIC_DRY_QUOTE = mainnetPublicDryQuoteJson as unknown as QuoteResponse;
const MAINNET_BASIC_DRY_QUOTE = mainnetBasicDryQuoteJson as unknown as QuoteResponse;

const withQuote = (r: QuoteResponse, patch: Partial<QuoteResponse["quote"]>): QuoteResponse => ({
  ...r,
  quote: { ...r.quote, ...patch },
});

describe("checkQuoteSignature (real staging quotes from the official SDK tests)", () => {
  it("accepts a valid dry quote", () => {
    const res = checkQuoteSignature(STAGING_DRY_QUOTE, STAGING_MANAGER_PUB_KEY);
    expect(res.valid).toBe(true);
    expect(res.signedHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/); // base58 sha256
  });

  it("accepts a valid non-dry quote", () => {
    expect(checkQuoteSignature(STAGING_NON_DRY_QUOTE, STAGING_MANAGER_PUB_KEY).valid).toBe(true);
  });

  it("rejects a tampered amountOut on a dry quote", () => {
    const tampered = withQuote(STAGING_DRY_QUOTE, { amountOut: "9935024" });
    expect(checkQuoteSignature(tampered, STAGING_MANAGER_PUB_KEY).valid).toBe(false);
  });

  it("rejects a tampered depositAddress on a non-dry quote", () => {
    const tampered = withQuote(STAGING_NON_DRY_QUOTE, {
      depositAddress: "bc1q0000000000000000000000000000000000000000",
    });
    expect(checkQuoteSignature(tampered, STAGING_MANAGER_PUB_KEY).valid).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    expect(checkQuoteSignature({ ...STAGING_DRY_QUOTE, signature: "" }, STAGING_MANAGER_PUB_KEY).valid).toBe(false);
    expect(
      checkQuoteSignature({ ...STAGING_DRY_QUOTE, signature: "not-a-signature" }, STAGING_MANAGER_PUB_KEY).valid,
    ).toBe(false);
  });

  it("rejects a staging-signed quote under the production key", () => {
    expect(checkQuoteSignature(STAGING_DRY_QUOTE, ONECLICK_MANAGER_PUBLIC_KEY).valid).toBe(false);
  });
});

describe("checkQuoteSignature (real mainnet quote, production key)", () => {
  it("accepts the saved mainnet dry quote under the production 1Click key", () => {
    const res = checkQuoteSignature(MAINNET_PUBLIC_DRY_QUOTE);
    expect(res.publicKey).toBe(ONECLICK_MANAGER_PUBLIC_KEY);
    expect(res.valid).toBe(true);
  });

  it("rejects it when amountOut is tampered", () => {
    const tampered = withQuote(MAINNET_PUBLIC_DRY_QUOTE, { amountOut: "9247386" });
    expect(checkQuoteSignature(tampered).valid).toBe(false);
  });

  it("rejects it under the staging key", () => {
    expect(checkQuoteSignature(MAINNET_PUBLIC_DRY_QUOTE, STAGING_MANAGER_PUB_KEY).valid).toBe(false);
  });
});

describe("checkQuoteSignature (real mainnet confidential quote, production key)", () => {
  it("accepts the saved confidential (basic) dry quote", () => {
    expect(MAINNET_BASIC_DRY_QUOTE.quoteRequest.confidentiality).toBe("basic");
    expect(checkQuoteSignature(MAINNET_BASIC_DRY_QUOTE).valid).toBe(true);
  });

  it("still verifies if confidentiality is flipped, because the field is not signed", () => {
    // Documents a limitation: "1Click-signed" does not prove the swap was confidential.
    const flipped = {
      ...MAINNET_BASIC_DRY_QUOTE,
      quoteRequest: { ...MAINNET_BASIC_DRY_QUOTE.quoteRequest, confidentiality: "public" },
    } as QuoteResponse;
    expect(checkQuoteSignature(flipped).valid).toBe(true);
  });

  it("rejects it when the destination asset is tampered", () => {
    const tampered = {
      ...MAINNET_BASIC_DRY_QUOTE,
      quoteRequest: { ...MAINNET_BASIC_DRY_QUOTE.quoteRequest, destinationAsset: "nep141:usdt.tether-token.near" },
    } as QuoteResponse;
    expect(checkQuoteSignature(tampered).valid).toBe(false);
  });
});
