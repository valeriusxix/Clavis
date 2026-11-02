// Phase 0 smoke test (AGENT.md section 6.6):
//   1. GET  /v0/tokens  -> find wNEAR (nep141:wrap.near) and a USDC asset
//   2. POST /v0/quote   -> one DRY quote with confidentiality: "basic"
//   3. print the full JSON, then verify the quote signature with the official SDK verifier.
// Nothing executes and no funds move: dry quotes return no deposit address.
//
// Usage: pnpm smoke:quote [--amount 1] [--dest-chain near] [--save path.json] [--no-public-fallback]
//                         [--recipient-type DESTINATION_CHAIN|INTENTS|CONFIDENTIAL_INTENTS]
//        --recipient-type CONFIDENTIAL_INTENTS checks whether 1Click accepts an on-chain deposit whose
//        output stays in the recipient's Confidential Intents balance (AUDIT C4). Needs ONECLICK_API_KEY.
// Env:   ONECLICK_BASE_URL, ONECLICK_API_KEY (optional), SMOKE_ACCOUNT (an EXISTING mainnet NEAR
//        account used as recipient/refundTo in the dry quote; nothing is sent to it. A non-existent
//        account makes 1Click answer HTTP 400 "Internal server error").
//
// Live finding (2026-11-01): 1Click answers HTTP 401 "User authentication is required for
// confidential intent quotes" when confidentiality is basic/advanced and no credentials are sent.
// In that case this script says so and, unless --no-public-fallback is given, requests a PUBLIC dry
// quote instead so the signature check still runs against a real mainnet quote. The fallback is
// labeled PUBLIC everywhere and the script exits with code 3 (not 0).
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadDotEnv, parseConfig } from "../apps/server/src/config";
import { OneClickClient, OneClickError } from "../apps/server/src/oneclick/client";
import type { QuoteRequest, QuoteResponse, TokenResponse } from "../apps/server/src/oneclick/types";
import { checkQuoteSignature } from "../apps/server/src/oneclick/verifySignature";

const { values: args } = parseArgs({
  options: {
    amount: { type: "string", default: "1" },
    "dest-chain": { type: "string", default: "near" },
    save: { type: "string" },
    "no-public-fallback": { type: "boolean", default: false },
    "recipient-type": { type: "string", default: "DESTINATION_CHAIN" },
  },
});
const RECIPIENT_TYPES = ["DESTINATION_CHAIN", "INTENTS", "CONFIDENTIAL_INTENTS"];
if (!RECIPIENT_TYPES.includes(args["recipient-type"])) {
  throw new Error(`--recipient-type must be one of ${RECIPIENT_TYPES.join(", ")}`);
}

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
  const account = process.env.SMOKE_ACCOUNT?.trim() || "intents.near";

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
    recipientType: args["recipient-type"] as QuoteRequest.recipientType,
    refundTo: account,
    refundType: "ORIGIN_CHAIN" as QuoteRequest.refundType,
    confidentiality: "basic" as QuoteRequest.confidentiality,
    deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    referral: "clavis",
  };

  hr("POST /v0/quote (request, confidentiality: basic)");
  console.log(JSON.stringify(request, null, 2));

  let response: QuoteResponse;
  let mode: "basic" | "public-fallback" = "basic";
  try {
    response = await client.getQuote(request);
  } catch (err) {
    if (!(err instanceof OneClickError) || err.status !== 401 || args["no-public-fallback"]) throw err;
    hr("Confidential quote REFUSED (HTTP 401)");
    console.log(err.message);
    console.log(
      client.hasApiKey
        ? "An API key was sent but 1Click still refused the confidential quote."
        : "No ONECLICK_API_KEY is set. 1Click requires credentials for confidential quotes.",
    );
    console.log("Falling back to a PUBLIC dry quote so the signature check runs on a real mainnet quote.");
    mode = "public-fallback";
    const { confidentiality: _omit, ...publicRequest } = request;
    hr("POST /v0/quote (request, PUBLIC fallback — not confidential)");
    console.log(JSON.stringify(publicRequest, null, 2));
    response = await client.getQuote(publicRequest as QuoteRequest);
  }

  hr(`POST /v0/quote (full response${mode === "public-fallback" ? ", PUBLIC fallback" : ""})`);
  console.log(JSON.stringify(response, null, 2));

  if (args.save) {
    writeFileSync(args.save, JSON.stringify(response, null, 2) + "\n");
    console.log(`\nsaved raw response to ${args.save}`);
  }

  hr("Summary");
  const q = response.quote;
  console.log(`mode                   : ${mode === "basic" ? "CONFIDENTIAL (basic)" : "PUBLIC fallback (confidential quote was refused)"}`);
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
  else if (mode === "public-fallback") process.exitCode = 3; // signature OK, but not a confidential quote
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
