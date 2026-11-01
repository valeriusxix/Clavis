// Phase 0 smoke test (AGENT.md section 6.6):
//   1. GET  /v0/tokens  -> find wNEAR (nep141:wrap.near) and a USDC asset
//   2. POST /v0/quote   -> one DRY quote with confidentiality: "basic"
//   3. print the full JSON, then verify the quote signature with the official SDK verifier.
// Nothing executes and no funds move: dry quotes return no deposit address.
//
// Usage: pnpm smoke:quote [--amount 1] [--dest-chain near] [--save path.json]
// Env:   ONECLICK_BASE_URL, ONECLICK_API_KEY (optional), SMOKE_ACCOUNT (NEAR account used as
//        recipient/refundTo in the dry quote; nothing is sent to it).
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadDotEnv, parseConfig } from "../apps/server/src/config";
import { OneClickClient, OneClickError } from "../apps/server/src/oneclick/client";
import type { QuoteRequest, TokenResponse } from "../apps/server/src/oneclick/types";
import { checkQuoteSignature } from "../apps/server/src/oneclick/verifySignature";

const { values: args } = parseArgs({
  options: {
    amount: { type: "string", default: "1" },
    "dest-chain": { type: "string", default: "near" },
    save: { type: "string" },
  },
});

/** "1.5" + 24 decimals -> "1500000000000000000000000". Integer math only, never floats. */
export function toBaseUnits(human: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(human)) throw new Error(`Invalid amount: ${human}`);
  const [whole = "0", frac = ""] = human.split(".");
  if (frac.length > decimals) throw new Error(`Too many decimals for ${decimals}-decimal token: ${human}`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

const hr = (title: string) => console.log(`\n=== ${title} ${"=".repeat(Math.max(0, 70 - title.length))}`);

async function main() {
  loadDotEnv();
  const config = parseConfig();
  const client = new OneClickClient({ baseUrl: config.ONECLICK_BASE_URL, apiKey: config.ONECLICK_API_KEY });
  const account = process.env.SMOKE_ACCOUNT?.trim() || "clavis-smoke.near";

  hr("1Click target");
  console.log(`base URL : ${config.ONECLICK_BASE_URL}`);
  console.log(`API key  : ${client.hasApiKey ? "set (sent as X-API-Key)" : "not set (unauthenticated; extra fee applies)"}`);

  hr("GET /v0/tokens");
  const tokens = await client.getTokens();
  console.log(`${tokens.length} tokens returned`);

  const origin = tokens.find((t) => t.assetId === "nep141:wrap.near");
  if (!origin) throw new Error("nep141:wrap.near not found in /v0/tokens");

  const usdcs = tokens.filter((t) => t.symbol.toUpperCase() === "USDC");
  console.log("USDC assets:");
  for (const t of usdcs) console.log(`  ${t.blockchain.padEnd(10)} ${t.assetId}  (decimals ${t.decimals}, $${t.price})`);
  const dest: TokenResponse | undefined = usdcs.find((t) => t.blockchain === args["dest-chain"]);
  if (!dest) throw new Error(`No USDC asset on blockchain "${args["dest-chain"]}"`);

  console.log(`origin   : ${origin.symbol} ${origin.assetId} (decimals ${origin.decimals}, $${origin.price})`);
  console.log(`dest     : ${dest.symbol} ${dest.assetId} (decimals ${dest.decimals}, $${dest.price})`);

  const request: QuoteRequest = {
    dry: true,
    swapType: "EXACT_INPUT" as QuoteRequest.swapType,
    slippageTolerance: 100,
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN" as QuoteRequest.depositType,
    destinationAsset: dest.assetId,
    amount: toBaseUnits(args.amount, origin.decimals),
    recipient: account,
    recipientType: "DESTINATION_CHAIN" as QuoteRequest.recipientType,
    refundTo: account,
    refundType: "ORIGIN_CHAIN" as QuoteRequest.refundType,
    confidentiality: "basic" as QuoteRequest.confidentiality,
    deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    referral: "clavis",
  };

  hr("POST /v0/quote (request)");
  console.log(JSON.stringify(request, null, 2));

  const response = await client.getQuote(request);

  hr("POST /v0/quote (full response)");
  console.log(JSON.stringify(response, null, 2));

  if (args.save) {
    writeFileSync(args.save, JSON.stringify(response, null, 2) + "\n");
    console.log(`\nsaved raw response to ${args.save}`);
  }

  hr("Summary");
  const q = response.quote;
  console.log(`confidentiality echoed : ${response.quoteRequest?.confidentiality ?? "(not echoed)"}`);
  console.log(`amountIn               : ${q.amountInFormatted} ${origin.symbol} ($${q.amountInUsd})`);
  console.log(`amountOut              : ${q.amountOutFormatted} ${dest.symbol} ($${q.amountOutUsd})`);
  console.log(`minAmountOut           : ${q.minAmountOut}`);
  console.log(`timeEstimate           : ${q.timeEstimate}s`);
  console.log(`depositAddress         : ${q.depositAddress ?? "(none — dry quote)"}`);

  hr("Signature check");
  const check = checkQuoteSignature(response);
  console.log(`signature   : ${check.signature}`);
  console.log(`public key  : ${check.publicKey}`);
  console.log(`signed hash : ${check.signedHash}`);
  console.log(`RESULT      : ${check.valid ? "VALID ✓ (signed by 1Click)" : "INVALID ✗"}`);

  if (!check.valid) process.exitCode = 2;
}

main().catch((err: unknown) => {
  hr("FAILED");
  if (err instanceof OneClickError) {
    console.error(err.message);
    if (err.body && typeof err.body === "object") console.error(JSON.stringify(err.body, null, 2));
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
