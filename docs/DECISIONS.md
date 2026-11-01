# Clavis — Decisions log

Answers to the "known unknowns" in AGENT.md section 16, plus other build decisions.
Each entry says where the answer came from and how sure we are.

## Sources used in Phase 0 (2026-11-01)

| Source | What it is | Trust |
|---|---|---|
| `near-intents` agent skill (`near/agent-skills` @ `cb32b6a`), installed with `npx skills@1.7.4 add near/agent-skills --skill near-intents` into `.claude/skills/near-intents` | Official NEAR agent skill | Primary |
| `github.com/defuse-protocol/one-click-sdk-typescript` @ `ae8b24e` (2026-09-22), npm `0.1.26` | Official 1Click SDK. Models are generated from the 1Click OpenAPI spec. `src/quote-signature.ts` is the reference signature verifier. | Primary |
| Snapshot of `docs.near-intents.org` taken 2026-09-03, mirrored at `github.com/CharlesHoskinson/Moriarty/raw/sources/near-intents-docs-2026-09-03` (with HTTP retrieval receipts) | Third-party copy of the official docs | Secondary. Re-check against the live docs. |
| `docs.near-intents.org`, `1click.chaindefuser.com` (live) | Live docs + API | **Not reachable from the build sandbox** (egress proxy returns 403). See "Environment blockers". |

---

## Section 16 known unknowns

### 1. Exact signature verification steps: RESOLVED (still needs one live mainnet quote)

The "Verify Quote Signatures" doc says to use `verifyQuoteSignature()` from
`@defuse-protocol/one-click-sdk-typescript` **>= 0.1.24**. What it does (SDK 0.1.26 source):

1. Build a signed request object from `quoteRequest`, using only these fields:
   `dry, swapType, slippageTolerance, originAsset, depositType, destinationAsset, amount,
   refundTo, refundType, recipient, recipientType, deadline`. It also adds
   `quoteWaitingTimeMs, referral, virtualChainRecipient, virtualChainRefundRecipient,
   customRecipientMsg`, but only when they are truthy.
   It **leaves out** `confidentiality`, `appFees`, `depositMode`, `sessionId`, `connectedWallets`.
2. Build a signed quote object from `quote`:
   - dry quote: `amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut,
     amountOutFormatted, amountOutUsd, minAmountOut`
   - non-dry quote: all of the above, plus `depositAddress, depositMemo, deadline,
     timeWhenInactive, timeEstimate, refundFee, withdrawFee`
3. `message = base58(sha256(json-stable-stringify({ ...request, ...quote, timestamp })))`
4. Check the `ed25519` signature (`response.signature`, `ed25519:<base58>`) over the UTF-8 bytes of
   `message`, against the 1Click manager key. The production key hard-coded in the SDK is
   `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`.

The doc's prose says `stringify({ ...quoteRequest, ...quoteResponse, timestamp })`. The SDK it points
to uses the explicit field subset above. We follow the SDK.

**Decision:** `apps/server/src/oneclick/verifySignature.ts` calls the SDK's `verifyQuoteSignature`
directly. We do not re-implement it. The SDK is pinned to exactly `0.1.26`.
Tests: `verifySignature.test.ts` uses the real staging quotes from the SDK's own test suite (6 tests:
valid dry, valid non-dry, tampered amount, tampered deposit address, bad signature, wrong key).
**TODO (Phase 0, once unblocked):** save one real mainnet dry quote and one real non-dry quote as
fixtures, and test them against the production key.

**Consequences for Clavis (must be honest in the UI and README):**
- `confidentiality` is **not** covered by the signature. "1Click-signed ✓" proves that 1Click quoted
  those assets, amounts, recipient and timestamp. It does **not** prove the swap was confidential.
- `appFees` is not covered either.
- `/v0/status` returns `quoteResponse`, and the SDK test shows that object verifies too. So the
  signature can be re-checked from the status response.

### 2. Final amounts in the status response: PARTIAL (confirm in Phase 4)

Per the SDK models (`GetExecutionStatusResponse`, `SwapDetails`), `GET /v0/status` returns
`{ correlationId, quoteResponse, status, updatedAt, swapDetails }`. `swapDetails` has
**optional** `amountIn, amountInFormatted, amountInUsd, amountOut, amountOutFormatted, amountOutUsd`
("Exact amount ... after the trade was settled"). It also has `slippage, refundedAmount*,
depositedAmount*, withdrawFee, referral, intentHashes, nearTxHashes, originChainTxHashes,
destinationChainTxHashes`.
**Plan:** on `SUCCESS`, use `swapDetails` amounts when present. Otherwise use the quote amounts and
mark the row "quoted". Check this against a real response in Phase 4.

### 3. Best origin token for a one-call wallet deposit (wNEAR vs NEAR-native USDC): OPEN

This needs live dry quotes, which are blocked right now. What we know so far:
- With `originAsset: nep141:wrap.near`, the user sends **wNEAR** to `depositAddress` with
  `ft_transfer` (1 yoctoNEAR attached). A user holding native NEAR needs `near_deposit` +
  `ft_transfer` on `wrap.near`. The skill (`deposit-near.md`) shows both as two actions in **one
  transaction**, so it is still one wallet confirmation.
- NEAR-native USDC is a single `ft_transfer`. Unknown: whether the deposit address needs a
  `storage_deposit` first.
- The docs' "Using NEAR tokens" page says wrapping "is handled for you" with 1Click. That seems to
  conflict with the skill. To resolve it, check `/v0/tokens` for a native-NEAR asset id.

**Tentative:** wNEAR origin, as in the spec. Revisit with real dry quotes.

### 4. `basic` vs `advanced` confidentiality: PARTIAL, AND A RISK

- Docs (Sep 2026) list `public` (default), `basic` and `advanced`, with **no documented
  difference** between `basic` and `advanced`.
- SDK model comment on `QuoteRequest.confidentiality`: *"Invite-only for now: if set, API may
  return an invite-only message until rollout is enabled for your integration."*
- Changelog: 2026-07-01 added the `confidentiality` parameter. 2026-07-13 "Confidential Intents is
  live for B2B partners".

**Decision:** always send `basic`.
**Risk:** an unauthenticated or non-partner quote with `confidentiality: "basic"` may be refused.
The first live smoke run will show this. If it is refused, we need a partner API key from
`partners.near-intents.org` (human action) or an invite.

### 5. Native view keys before Nov 14: OPEN (none found yet)

The docs snapshot and changelog (through 2026-09-03) mention user auth (NEP-413), private balances,
and transaction history that is "invite-only". They do not mention view keys.
**Decision:** keep the `DisclosureAdapter` interface with `ClavisRelayAdapter`. Re-check the live
changelog before Nov 14.

### 6. `appFees` recipient format for P1: RESOLVED (docs snapshot + SDK model)

- `recipient`: "Any NEAR-supported address (named account like `alice.near`, implicit account, or
  EVM-like address)". The SDK model says: "Account ID within Intents to which this fee will be
  transferred". So fees are credited inside Intents (`intents.near` balance), not to the wallet.
  Confirm this in P1.
- `fee`: basis points, from `0` to `500`. It is charged from the **input** token.
- **50/50 revenue share by default.** `fee: 10` means 5 bps to the recipient and 5 bps to 1Click.
  So the spec's `appFees: [{ recipient: <trader>, fee: 10 }]` pays the trader 5 bps.

---

## Other decisions

- **1Click auth header:** `X-API-Key: <jwt>`. Per the docs' API Keys page, `Authorization: Bearer`
  is also accepted. The header is sent only when `ONECLICK_API_KEY` is set. The sources disagree on
  the extra fee without a key (0.2% vs 0.25%). We just show what the quote returns.
- **HTTP client:** plain `fetch` (`apps/server/src/oneclick/client.ts`), with retry and backoff on
  5xx and network errors, and no retry on 4xx. The SDK is used only for types and signature
  verification.
- **`TokenResponse.price` is a number** (SDK/OpenAPI model and docs example), not a string.
- **Node >= 22.12** (spec says 20+). Node 20 reached end of life on 2026-04-30. vite 8 needs
  `^20.19 || >=22.12` and vitest 5 needs `>=22.12`. README "Requirements" will say Node 22.12+.
- **Package versions:** resolved by `pnpm add` from the registry on 2026-11-01. Exact versions are
  in `pnpm-lock.yaml` (typescript 7.0.2, vite 8.3.5, react 19.3.1, fastify 5.12.7, zod 4.6.7,
  vitest 5.0.5, tsx 4.23.15).
- **One `.env` at the repo root.** The server loads it with `process.loadEnvFile` (if present). Vite
  reads it via `envDir: "../.."`. Missing `.env` means demo defaults (`DEMO_MODE=true`).
- **Wallet library: deferred to Phase 3.** The spec says Wallet Selector. The NEAR `near-dapp` skill
  now points to `@hot-labs/near-connect`. We decide after reading docs.near.org (blocked for now).
- **NEAR JS:** the `near-api-js` skill targets near-api-js v7. Confirm in Phase 1/2.

## Environment blockers (as of 2026-11-01)

The build sandbox's egress policy denies these hosts (HTTP 403 on CONNECT):
`1click.chaindefuser.com`, `docs.near-intents.org`, `docs.near.org`, `rpc.testnet.near.org`,
`rpc.mainnet.fastnear.com` / `test.rpc.fastnear.com`, `testnet.nearblocks.io`,
`partners.near-intents.org`, `explorer.near-intents.org`, `nearhackathon.com`.
These work: npm registry, crates (`index.crates.io`, `static.crates.io/crates/...`),
`static.rust-lang.org`, and GitHub (git and raw).
