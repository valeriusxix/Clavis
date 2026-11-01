// Real 1Click *staging* quote responses, copied verbatim from the official SDK test suite:
// github.com/defuse-protocol/one-click-sdk-typescript @ ae8b24e0, src/__tests__/quote-signature.test.ts
// (ISC License, Copyright (c) 2025, NEAR Foundation). They are signed by the staging manager key,
// not the production key. A real *mainnet* quote is added once 1click.chaindefuser.com is reachable.
import type { QuoteResponse } from "../types";

export const STAGING_MANAGER_PUB_KEY = "ed25519:5J5tkaxyPoR3Q9S8LXfo5bWnXK5Z2bctJ4mB9gENh7co";

export const STAGING_NON_DRY_QUOTE = {
  correlationId: "d4f1b110-46cc-4682-aa3f-44d81ffe4b80",
  timestamp: "2026-06-23T17:10:41.104Z",
  signature:
    "ed25519:53wcpim7FDNLbBHVezUpakthWq2TR9Lag3PwW3e8Cxmz4bFEodcc4rui5BiVHRRaHocYE9URVapzJD8JxLNDs8K9",
  quoteRequest: {
    dry: false,
    depositMode: "SIMPLE",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: "1cs_v1:btc:native:coin",
    depositType: "ORIGIN_CHAIN",
    destinationAsset: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.stft.near",
    amount: "10000",
    refundTo: "bc1q6mte80265ghwq4vsrpm9lnaz46uvdreu9z8wly",
    refundType: "ORIGIN_CHAIN",
    recipient: "0xcac3C41676deF4FE375E57118f3eB83A99105577",
    recipientType: "DESTINATION_CHAIN",
    deadline: "2026-06-23T19:00:00.000Z",
    confidentiality: "public",
    quoteWaitingTimeMs: 0,
    appFees: [
      { recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 10 },
    ],
  },
  quote: {
    amountIn: "10000",
    amountInFormatted: "0.0001",
    amountInUsd: "6.237600000000",
    minAmountIn: "10000",
    amountOut: "5931560",
    amountOutFormatted: "5.93156",
    amountOutUsd: "5.925171709880",
    minAmountOut: "5872244",
    timeEstimate: 812,
    refundFee: "1900",
    withdrawFee: "300000",
    deadline: "2026-06-26T19:00:00.000Z",
    timeWhenInactive: "2026-06-26T19:00:00.000Z",
    depositAddress: "bc1q873cxltdc560dth6tpwqpehq9uvhxxcdgwnmnw",
  },
} as unknown as QuoteResponse;

export const STAGING_DRY_QUOTE = {
  correlationId: "7d6d78f0-601f-4022-9735-854a22ed9dcb",
  timestamp: "2026-06-23T17:10:55.616Z",
  signature:
    "ed25519:3yVRcYGXRVj2YqrUng4Ne2yiWgh9YQfer46KW6sXiWzoyRHgsifwDp1HSZW7VLRTdKXoMgxJce22LQ9dcoihyfu5",
  quoteRequest: {
    dry: true,
    depositMode: "SIMPLE",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: "1cs_v1:btc:native:coin",
    depositType: "ORIGIN_CHAIN",
    destinationAsset: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.stft.near",
    amount: "10000",
    refundTo: "bc1q6mte80265ghwq4vsrpm9lnaz46uvdreu9z8wly",
    refundType: "ORIGIN_CHAIN",
    recipient: "0xcac3C41676deF4FE375E57118f3eB83A99105577",
    recipientType: "DESTINATION_CHAIN",
    deadline: "2026-06-23T19:00:00.000Z",
    confidentiality: "public",
    quoteWaitingTimeMs: 0,
    appFees: [
      { recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 10 },
    ],
  },
  quote: {
    amountIn: "10000",
    amountInFormatted: "0.0001",
    amountInUsd: "6.237600000000",
    minAmountIn: "10000",
    amountOut: "5935024",
    amountOutFormatted: "5.935024",
    amountOutUsd: "5.928631979152",
    minAmountOut: "5875673",
    timeEstimate: 812,
    refundFee: "1900",
    withdrawFee: "300000",
  },
} as unknown as QuoteResponse;
