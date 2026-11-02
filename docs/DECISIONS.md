# Clavis — Decisions log

Answers to the "known unknowns" in AGENT.md section 16, plus other build decisions.
Each entry says where the answer came from and how sure we are.

## Sources

| Source | What it is | Notes |
|---|---|---|
| `near-intents` agent skill (`near/agent-skills` @ `cb32b6a`), restored from `skills-lock.json` | Official NEAR agent skill | Not vendored: the source repo has no LICENSE. |
| `github.com/defuse-protocol/one-click-sdk-typescript` @ `ae8b24e` (2026-09-22), npm `0.1.26` | Official 1Click SDK. `src/quote-signature.ts` is the reference verifier. | |
| Live `docs.near-intents.org` and `https://1click.chaindefuser.com/docs/v0/openapi.yaml`, read 2026-11-01 | Primary | Before network access was opened, a 2026-09-03 snapshot was used. The live verify-signature and near-token pages match that snapshot. **fee-config changed** (see #6). |
| Live 1Click API probes, 2026-11-01 (dry quotes only) | Ground truth | Results below. |

---

## LIVE FINDING (2026-11-01): confidential quotes need credentials

Dry quote probes, `wNEAR -> USDC (NEAR)`, 1 wNEAR, no API key:

| `confidentiality` | Recipient / refundTo | HTTP | Body |
|---|---|---|---|
| `basic` | `intents.near` | **401** | `User authentication is required for confidential intent quotes` |
| `advanced` | `clavis-smoke.near` | **401** | same |
| `basic` + `X-API-Key: <fake>` | `intents.near` | 401 | `Invalid token` |
| `basic` + `Authorization: Bearer <fake>` | `intents.near` | 401 | `Invalid token` |
| omitted / `public` | `intents.near` | **201** | signed quote, echoes `confidentiality: "public"` |
| omitted / `public` | `clavis-smoke.near` (does not exist) | 400 | `Internal server error`. **The recipient must be an existing account.** |

Context from the live docs:
- Changelog, **2026-10-27**: "1Click swaps roll out as confidential only. The API is unchanged."
  `swapDetails.nearTxHashes` lists the public shield and unshield transactions. The swap itself settles on
  the NEAR Private Shard. Unauthenticated **public** quotes are still served (above).
- OpenAPI `/v0/quote` security: `X-API-Key` (partner, recommended) or `JWT-auth` (bearer, legacy).
  A separate `User-Session` bearer token (from `POST /v0/auth/authenticate`, a signed empty intent) is
  documented only for `/v0/account/*`.
- OpenAPI `confidentiality`: "PUBLIC is the default; BASIC or ADVANCED request Confidential Intents
  handling."

**Impact:** AGENT.md 10.4 says the confidential dry quote "works without an API key". As of today it
does not. Definition of done #4 (a judge with no keys sees a real confidential quote) needs one of:
1. **Partner API key** (`ONECLICK_API_KEY`, from partners.near-intents.org; human action). Not yet
   tested whether a partner key satisfies "User authentication". We need it for real-mode fees anyway.
2. **Server-side User-Session token**, signed with a server-held key (e.g. a throwaway `raw_ed25519`
   implicit account, which needs no on-chain registration). The docs do not document this for
   `/v0/quote`. A probe was prepared but **not run**: the sandbox's permission check blocked it
   pending the human's approval.
3. **Honest fallback:** with no credentials, the Trade page shows a clearly labelled **PUBLIC** dry quote
   and explains that confidential quotes need a key. `scripts/smoke-quote.ts` already does this (exit 3).

### Resolution (2026-11-02)

- **Option 1 works.** With the partner key in `ONECLICK_API_KEY` (sent as `X-API-Key`), the
  `confidentiality: "basic"` dry quote returns 201. It echoes `confidentiality: "basic"` and verifies
  under the production key. It is saved as `__fixtures__/mainnet-basic-dry-quote.json`.
  The echoed `appFees` show 1Click's 20 bps (authenticated schedule).
- **Option 2 does not work** (tested with the human's approval).
  - A throwaway `raw_ed25519` key signed an empty intent. The salt must come from `intents.near`
    `current_salt` (RPC view; it was `252812b3` on 2026-11-02, while the docs' `e110f317` is stale and
    gives `signature verification failed`).
  - That gets a User-Session token (`/v0/auth/authenticate` 201, `expiresIn` 900).
  - But `/v0/quote` rejects that token with `401 Invalid token`, both as a Bearer token and as
    `X-API-Key`. **Confidential quotes need the partner key.**
- **Decision:**
  - The server sends the partner key. The hosted demo has it configured, so judges get real
    confidential quotes there.
  - With no key (fresh clone, `pnpm dev`), the Trade page falls back to a clearly labelled **PUBLIC**
    dry quote and explains why (option 3). The README must say this, and AGENT.md 10.4 is out of date
    on this point.
  - The key lives only in `.env` (gitignored) and in the host's secret settings. It is never committed
    and never sent to the browser.

---

## Section 16 known unknowns

### 1. Exact signature verification steps: RESOLVED, verified on a real mainnet quote

The "Verify Quote Signatures" doc (live, unchanged) says to use `verifyQuoteSignature()` from
`@defuse-protocol/one-click-sdk-typescript` **>= 0.1.24**. What it does (SDK 0.1.26 source):

1. Build a signed request object from `quoteRequest`, using only these fields:
   `dry, swapType, slippageTolerance, originAsset, depositType, destinationAsset, amount,
   refundTo, refundType, recipient, recipientType, deadline`. It also adds
   `quoteWaitingTimeMs, referral, virtualChainRecipient, virtualChainRefundRecipient,
   customRecipientMsg`, but only when they are truthy.
   It **leaves out** `confidentiality`, `appFees`, `depositMode`, `sessionId`, `connectedWallets`,
   and the new `insured` echo field.
2. Build a signed quote object from `quote`:
   - dry quote: `amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut,
     amountOutFormatted, amountOutUsd, minAmountOut`
   - non-dry quote: all of the above, plus `depositAddress, depositMemo, deadline,
     timeWhenInactive, timeEstimate, refundFee, withdrawFee`
3. `message = base58(sha256(json-stable-stringify({ ...request, ...quote, timestamp })))`
4. Check the `ed25519` signature over the UTF-8 bytes of `message`, against the 1Click manager key.
   The production key is `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc` (hard-coded in the SDK).

**Decision:** `apps/server/src/oneclick/verifySignature.ts` calls the SDK's `verifyQuoteSignature`
directly. The SDK is pinned to exactly `0.1.26`.
**Tests (9):**
- the SDK's real staging quotes under the staging key;
- a real **mainnet** dry quote captured 2026-11-01 (`__fixtures__/mainnet-public-dry-quote.json`),
  valid under the **production** key;
- tampered amounts and deposit address rejected;
- bad or missing signatures rejected;
- the wrong key rejected.

**Consequences (must be honest in the UI and README):**
- `confidentiality` is **not** covered by the signature. "1Click-signed ✓" proves the assets, amounts,
  recipient and timestamp, not that the swap was confidential.
- `appFees` is not covered either.
- `/v0/status` returns `quoteResponse`, which also verifies (SDK test).

### 2. Final amounts in the status response: PARTIAL (confirm in Phase 4)

Per the SDK and OpenAPI models, `GET /v0/status` returns
`{ correlationId, quoteResponse, status, updatedAt, swapDetails }`. `swapDetails` has
**optional** `amountIn, amountInFormatted, amountInUsd, amountOut, amountOutFormatted, amountOutUsd`
("exact amount after the trade was settled"). It also has `slippage, refundedAmount*, depositedAmount*,
withdrawFee, referral, intentHashes, nearTxHashes, originChainTxHashes, destinationChainTxHashes`.
Since 2026-10-27, `nearTxHashes` holds only the shield and unshield transactions.
**Plan:** on `SUCCESS`, use `swapDetails` amounts when present. Otherwise use the quote amounts and
mark the row "quoted".

### 3. Best origin token for a one-call wallet deposit: PARTIAL

From the live `/v0/tokens` (210 tokens):
- **There is no native-NEAR asset id.** NEAR on NEAR is only `nep141:wrap.near` (wNEAR, 24 decimals).
  A user holding native NEAR must `near_deposit` + `ft_transfer` on `wrap.near`. Per the skill's
  `deposit-near.md`, these are two actions in **one transaction**, so it is still one wallet
  confirmation.
- NEAR-native USDC is `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`
  (6 decimals). As origin, it is a single `ft_transfer`. USDT is `nep141:usdt.tether-token.near`.
- Dry quote, 1 wNEAR -> USDC: on NEAR, `withdrawFee 0` and `timeEstimate ~20s`. On Arbitrum,
  `withdrawFee 5300` (0.0053 USDC) and ~19s. So NEAR-native destinations avoid withdraw fees.

**Decision:** default pair **wNEAR -> NEAR-native USDC** (both sides on NEAR). Still open: whether the
deposit address needs `storage_deposit` before an `ft_transfer`. Check with the first real
(non-dry) quote in Phase 4.

### 4. `basic` vs `advanced`: PARTIAL

The live docs and OpenAPI list `public` (default), `basic` and `advanced`, with **no documented
difference** between `basic` and `advanced`. Both currently return 401 without credentials.
**Decision:** always send `basic`. Retest `advanced` once we have credentials.

### 5. Native view keys before Nov 14: OPEN (none found yet)

The live changelog (through 2026-10-27) has nothing on view keys. User-Session auth exists for
private balances. History is invite-only.
**Decision:** keep `DisclosureAdapter` + `ClavisRelayAdapter`. Re-check before Nov 14.

### 6. `appFees` recipient format (P1): RESOLVED, and the fee rules changed

- `recipient`: "Any NEAR-supported address (named account, implicit account, or EVM-like address)".
  The SDK model calls it "Account ID within Intents", so fees land in the recipient's Intents balance.
- `fee`: **integer** basis points, charged from the input token. The combined total, including
  1Click's share, cannot exceed **500 bps**.
- **With an API key:** split 50/50, but 1Click's half has a **20 bps minimum** (1 bp for
  USDC/USDT/DAI pairs and same-asset routes). So `fee: 10` gives the trader **5 bps** and charges
  the user 25 bps total.
- **Without an API key:** no split. The recipient keeps the full `fee` and 1Click adds 25 bps. So
  `fee: 10` gives the trader 10 bps and charges 35 bps.
- Echo quirk: public quotes echo an `appFees` entry for 1Click's own recipient
  (`5880ad2b…47dd`, `fee: 20`). It is not covered by the signature.

---

## Phase 1 contract decisions (from the human, 2026-11-01)

- **`withdraw_platform()`**: new **owner-only** method. Transfers `platform_balance` to `owner_id`.
  It is zeroed before the transfer, with the same restore-on-failure callback as `withdraw()`.
  This adds one method to AGENT.md 7.2.
- **`withdraw()` callback:** zero the caller's balance before the transfer promise. Then chain a
  private callback (`#[private]`) that **restores the balance if the transfer failed**, and emits
  `withdrawn` only on success.

## Other decisions

- **1Click auth header:** `X-API-Key: <key>` (OpenAPI: recommended; Bearer is legacy). It is sent only
  when `ONECLICK_API_KEY` is set. Without a key, 1Click adds **25 bps** (live docs).
- **HTTP client:** plain `fetch` (`apps/server/src/oneclick/client.ts`), with retry and backoff on
  5xx and network errors, and no retry on 4xx. The SDK is used for types and signature verification.
- **`TokenResponse.price` is a number** (OpenAPI), not a string.
- **Dry-quote recipient must exist.** `scripts/smoke-quote.ts` defaults `SMOKE_ACCOUNT` to
  `intents.near` (a dry quote sends nothing). The app will use the trader's own account.
- **Node >= 22.12** (AGENT.md says 20+). Node 20 reached end of life on 2026-04-30. vite 8 needs
  `^20.19 || >=22.12`, and vitest 5 needs `>=22.12`. The README "Requirements" will say Node 22.12+.
- **Package versions:** resolved by `pnpm add` on 2026-11-01. Exact versions are in `pnpm-lock.yaml`.
- **One `.env` at the repo root.** The server uses `process.loadEnvFile`. Vite uses `envDir: "../.."`.
  A missing `.env` means demo defaults.
- **Wallet library: deferred to Phase 3.** The spec says Wallet Selector, but NEAR's `near-dapp` skill
  now points to `@hot-labs/near-connect`. Decide after reading docs.near.org.
- **NEAR JS:** the `near-api-js` skill targets v7. Confirm in Phase 1/2.

## Environment

Network access was opened on 2026-11-01. 1Click, the NEAR docs and NEAR RPC are reachable.
`testnet.nearblocks.io` still answers 403 to curl (likely bot protection). It is only needed for
explorer links, which the browser opens.
