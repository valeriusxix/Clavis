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
  - It **adds back** rather than overwriting, because new key sales may land before the callback.
  - On failure it emits `withdraw_failed`.

## Phase 1 contract implementation choices (2026-11-02)

The toolchain follows the docs.near.org quickstart and NEAR's `near-smart-contracts` skill:
- scaffolded with `cargo near new`;
- near-sdk **5.29.1**, Rust 1.93.0 (pinned by the template's `rust-toolchain.toml`);
- cargo-near **0.22.0**, near-cli-rs **0.30.1** (latest releases, installed with the official installers).

The template's nested `.git` and `.github` deploy workflows were removed. AGENT.md 7.2 is
implemented as written, plus:

- **`new` is `#[private]`.** Only the contract account can initialize it, in the deploy transaction,
  so nobody can front-run init.
- **Hash head starts at genesis.** `register_trader` sets `head_hash = sha256("clavis:v1:" + trader_id)`
  (h0 of AGENT.md 11.2). So `get_commitment` of a trader with no trades matches an empty log, and
  `commit_log` never grows storage. `head_hash` is stored lowercase.
- **64-bit numbers in JSON are strings (`U64`).** This covers the `trade_count` argument of
  `commit_log`, the `get_access` expiry, `get_commitment`, and the timestamp and count fields of
  `get_trader` / `list_traders`. Nanosecond timestamps do not fit in a JavaScript number.
  `NearToken` values are yoctoNEAR strings. `period_days` (u32) and list paging are plain numbers.
- **`update_trader` is payable.** A longer display name pays for its extra storage; any unused
  deposit is refunded.
- **`buy_key`** returns the new expiry, and rejects a trader buying their own key (they always have
  access). The fee is `price * bps / 10000`, rounded down. Trader share + fee always equals the price
  (tested).
- **Validation:**
  - `display_name` 1–64 characters;
  - `period_days` 1–365;
  - `platform_fee_bps` ≤ 10000;
  - `list_traders(from_index?, limit?)` caps `limit` at 100.
- **Extra view:** `get_config()` returns `{ owner_id, committer_id, platform_fee_bps,
  platform_balance, trader_count }`.
- **Storage:** `store` collections only write on `flush()`, so each payable method flushes before
  measuring `env::storage_usage()`.
- **Tests:**
  - 49 unit tests, covering every rule in 7.2 plus the withdraw callbacks;
  - 1 sandbox integration test on the real wasm. It covers deploy+init, register, `buy_key`,
    `commit_log` (committer only), `withdraw`, `withdraw_platform` (owner only), and `#[private]`
    enforcement on `new` and `on_withdraw`. The private checks only exist in the wasm wrapper, so
    unit tests cannot cover them.

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

## Phase 2: PnL engine choices (`apps/server/src/pnl/engine.ts`)

AGENT.md section 9 is implemented as written. Where it is silent:
- **Over-selling** (selling more than you hold): the held part costs the average cost, and the excess
  costs the trade's own unit price (`vIn / qIn`). This equals the spec in both cases it defines
  (nothing held: `vIn`; within holdings: `avgCost * qIn`).
- **Win rate counts only closes.** A close is a disposal of a non-stablecoin asset that had a cost
  basis. Buying with stablecoins, and first-time "funding" sales, are not sells for win-rate
  purposes. Their fees and slippage still count in realized PnL. Without this, every DCA buy would
  count as a losing "sell".
- **Capital** = peak Σ cost basis across all assets, stablecoins included, with a $1 minimum.
- **pnl30d** re-runs the same calculation over the last 30 days. It starts from the day −30 holdings,
  marked to market at day −30 prices; that mark is the starting cost basis.
- **Historical prices** come from the trades themselves: each trade implies a unit price for both legs
  (`v / q`). Live `/v0/tokens` prices override from their timestamp on. Seeded traders use the seed's
  price path.

## Phase 2: server, seed and API choices (2026-11-02)

**Schema** (`apps/server/src/db/schema.sql`), differences from AGENT.md 8.1:
- `trades.seq` is NULL until the trade settles (SUCCESS or SIMULATED). The spec's `NOT NULL`
  conflicts with "set on SUCCESS", because pending quotes have no seq yet.
- `traders` gains `key_price_yocto`, `period_days` and `style`, for the leaderboard's `keyPrice`
  and the trader cards.
- New `price_history` table: the seed's price path, used for historical marks.

**Demo seed** (`apps/server/src/demo/seed.ts`):
- **Deterministic.** The timeline is fixed: 45 days ending **2026-11-11T00:00Z**, not "now". The
  generator uses only `+ - * /` and integer PRNG operations, which IEEE-754 rounds exactly, so logs
  are byte-identical on every machine and Node version. Stored numbers are fixed-precision strings.
  This keeps the heads committed by `pnpm seed:chain` valid forever.
- **Trades appear only once their time has passed** (seq stays contiguous), so nothing is
  future-dated. Before 2026-11-11 the leaderboard shows the partial history; a server running with
  the committer key commits the longer log each time a trade is revealed.
- Each trader follows a personality strategy against a seeded random-walk price path. One "execution
  edge" per trader (price improvement versus the path; |edge| < 0.5%) is binary-searched so total PnL
  hits the AGENT.md target:

  | Trader | Target | Fills |
  |---|---|---|
  | quiet-whale | +38% | 28 |
  | zec-maxi | +21% | 35 |
  | scalp-sensei | +7%, 87% win rate | 60 |
  | degen-dora | −14% | 34 |
  | steady-eddie | +11% | 27 |
- **Seeded traders are real testnet accounts**, e.g. `quiet-whale.clavis-app.testnet` (display name
  `quiet-whale`). The reason: `commit_log` only accepts registered traders, and `register_trader`
  registers the caller. `pnpm seed:chain` creates and registers these subaccounts; the human runs it
  (docs/SEEDING.md). The running server's committer then commits each head, so the script never
  needs the committer key.
- **Re-seeding (2026-11-02, AUDIT C3).** The contract only accepts a `trade_count` higher than the
  committed one and cannot check that a new head extends the old one, and the committer refuses to
  commit a log that does not extend the on-chain head. So if the seeded data ever changes
  (generator, parameters, assets), the heads already committed for those accounts can never be
  replaced. Instead of deleting state, the seed accounts are versioned:
  `<handle>[-<version>].<parent>`, from `SEED_ACCOUNT_PARENT` (default `clavis-app.testnet`) and
  `SEED_ACCOUNT_VERSION` (default none). `pnpm seed:chain --version v2` creates a fresh set, and
  setting `SEED_ACCOUNT_VERSION=v2` makes the server use it. Display names stay the handles.
  `seed:chain` writes `apps/server/src/demo/seed-chain.json` (account names and registration
  transactions, no keys), which `/api/traders/:id/log` returns as `registrationTx` for the Verify
  panel's link.
- **Assets:** wNEAR and NEAR-native USDC from live `/v0/tokens`; BTC and ETH (`*.omft.near`) from the
  docs example. 1Click returned HTTP 521 for hours on 2026-11-02, so SOL and ZEC (`sol.omft.near`,
  `zec.omft.near`) were verified via `ft_metadata` on NEAR mainnet instead. **Re-confirm them against
  `/v0/tokens`.**

**API** (AGENT.md 8.3 plus small additions):
- `GET /api/me`, `GET /api/me/keys` and `POST /api/auth/logout`, for the web app.
- `POST /api/auth/nep413` comes in Phase 3 with the wallet integration.
- Sessions are signed, HTTP-only cookies (`@fastify/cookie`). `WEB_ORIGIN` sets the CORS allowlist
  with credentials. In production, cookies are `SameSite=None; Secure` (web and API on different
  hosts).
- **Quotes** always send `confidentiality: "basic"`. A dry quote uses `intents.near` as its
  placeholder recipient/refundTo, because 1Click rejects non-existent accounts and nothing is sent.
  Real quotes require the trader's own `recipient` and `refundTo`.
- **Without `ONECLICK_API_KEY`**, the server retries as a **PUBLIC** dry quote and returns a notice.
  The response says `confidential: false`.
- **Feed access:** the trader themselves; or an unexpired `demo_access` row; or (wallet sessions) the
  contract's `has_access`, via an RPC view call.
- **Prices:** `/v0/tokens` refreshes the `prices` table every 60 s (stablecoins = 1.0). If 1Click is
  down, `/api/tokens` serves the seed assets.

## Phase 3: web app choices (2026-11-02)

- **Wallet: `@hot-labs/near-connect` 0.12.0** (the human said to follow docs.near.org). docs.near.org
  "Wallet Login" recommends it over Wallet Selector. It loads wallet code from a manifest in
  sandboxed iframes. The connector is loaded lazily, so visitors without a wallet never load it. In
  testing it offered Meteor, Intear, Ledger, Nightly and NEAR CLI on testnet.
- **Login:** `GET /api/auth/challenge` gives a one-time 32-byte nonce (5 minutes). The wallet runs
  `signMessage({ message: "Log in to Clavis", recipient: <contract id>, nonce })`. Then
  `POST /api/auth/nep413` verifies with `near-api-js` 7.4 `verifyMessage`, which checks the ed25519
  signature and that the key is FullAccess via RPC `view_access_key`
  (docs.near.org "Backend Authentication").
- **`buy_key` from the browser** attaches price + 0.01 NEAR. The contract refunds the unused
  storage deposit.
- **Verify panel**, all in the browser:
  - The log is recomputed with Web Crypto using the same shared code as the server.
  - `get_commitment` is read **directly from NEAR RPC**, not via the Clavis server.
  - A commitment with `trade_count = C` is compared with the chain hash after the first C entries.
    So entries newer than the last commit are reported, not marked as a failure; committing is
    batched, and on-chain heads can lag the log.
  - The recomputed head is also compared with the head Clavis publishes (the leaderboard's
    `headHash`).
  - "Tamper test" edits one entry in the downloaded copy, so anyone can watch the panel turn red.
  - "Re-verify" asks the server to run the 1Click signature verifier again
    (`POST /api/traders/:id/reverify`).
- **`DisclosureAdapter`** (AGENT.md 6.5): routes read feeds and logs only through this interface.
  `ClavisRelayAdapter` is the only implementation today; a `NativeViewKeyAdapter` can replace it.
- **README differences from the 15.1 template:**
  - Node 22.22+ (`near-api-js` 7.4 and `react-router` 8 need it).
  - NEAR Connect instead of Wallet Selector.
  - Repo directory `Clavis`.
  - A note that local runs without `ONECLICK_API_KEY` get a PUBLIC quote.
  - A Tamper test sentence.
  - The honest signature-coverage line in the trust model.
- **Design:** dark ink background, one accent (brass), green and red only as PnL data colors,
  monospace for numbers and hashes, Lucide icons, blurred locked rows with a lock. Tested at
  1280 px and 375 px (no horizontal overflow).
- **Seed realism fix:** simulated fills now lose the 0.2% fee in USD, like real swaps. The calibrated
  edge moves fill *prices* instead (|edge| ≤ 0.57%). quiet-whale has mistimed swings (win rate 86%).

## Phase 4: real mode design (2026-11-02, human chose option (a) and `real-trader.clavis-app.testnet`)

- **Identity.**
  - The contract lives on testnet; real trades happen on mainnet. The real trader is
    `real-trader.clavis-app.testnet`, a subaccount of the contract account, registered at
    1 NEAR / 30 days.
  - Exactly one mainnet account (`REAL_TRADER_MAINNET_ACCOUNT`) may place real trades as it.
  - Login for real mode is NEP-413 against **mainnet** RPC (`/api/auth/challenge?network=mainnet`).
    The session becomes `{ sub: real trader, payer: mainnet account }`. Any other mainnet account
    gets `403 NOT_LINKED`.
- **Real quotes** (`dry: false`):
  - NEAR-chain tokens only (wNEAR, USDC, USDT on NEAR). The deposit is one wallet transaction, and
    `recipient` and `refundTo` are forced to the payer's own mainnet account.
  - **$2 cap** (`REAL_TRADE_MAX_USD`, max 2). Checked before quoting, using the token price; a quote
    over the cap is refused without ever requesting a deposit address. Checked again against
    1Click's `amountInUsd` (2% tolerance); over it, the trade is stored as FAILED and no deposit
    address is shown.
- **Deposit transaction** (one wallet approval, to the origin token contract):
  1. `storage_deposit { account_id: depositAddress, registration_only: true }`, attaching the
     contract's `storage_balance_bounds().min` (refunded if already registered);
  2. `near_deposit`, which wraps native NEAR (origin wNEAR only);
  3. `ft_transfer { receiver_id: depositAddress, amount: amountIn }` with 1 yoctoNEAR.

  The tx hash goes to `POST /v0/deposit/submit` (with `nearSenderAccount`).
- **Status poller** (5 s), until a terminal status. On SUCCESS:
  - the full status response is stored in `trades.status_json`;
  - amounts come from `swapDetails` when all six fields are present (`amounts_source = "final"`);
    otherwise the quote amounts are kept (`"quoted"`);
  - `settled_at` is the status `updatedAt`; seq is assigned and the chain head extended.

  REFUNDED, FAILED and INCOMPLETE_DEPOSIT are stored and shown, but never enter the log.
  **To check against the first real response:** whether `swapDetails.amountIn` / `amountOut` are
  base units, as the SDK model implies.
- **Committer** (10 s tick, at most one `commit_log` per trader per 30 s):
  - signed with `COMMITTER_PRIVATE_KEY`;
  - skips traders not registered on-chain;
  - marks heads that are already on-chain as committed without sending a transaction.
- **Export.** `pnpm export:real` writes the real trader's settled and terminal trades, plus the
  commit tx, to `apps/server/src/demo/real-trades.json`. That is public quote and status data only.
  Demo mode loads it on boot.

## Real-mode output routing (2026-11-03, AUDIT C4)

Problem: real mode sent the swap output on-chain (`recipientType: "DESTINATION_CHAIN"`) to the same
mainnet account that made the deposit, so anyone looking at that account saw both sides of every
trade, and Confidential Intents' deposit/withdrawal unlinkability did not help.

Live probes, dry quotes, 0.5 wNEAR -> USDC (NEAR), `depositType: "ORIGIN_CHAIN"`:

| Credentials | `confidentiality` | `recipientType` | HTTP | Body |
|---|---|---|---|---|
| none | `basic` | `CONFIDENTIAL_INTENTS` | 401 | `User authentication is required for confidential intent quotes` |
| none | omitted (public) | `CONFIDENTIAL_INTENTS` | 401 | same: any Confidential Intents routing needs credentials |
| partner key (`X-API-Key`) | `basic` | `CONFIDENTIAL_INTENTS` | 201 | signed quote echoing `recipientType: "CONFIDENTIAL_INTENTS"`, `confidentiality: "basic"`; signature valid; correlationId `03f604ed-7832-4ef3-84b0-c7aae9601a10` |

OpenAPI: `CONFIDENTIAL_INTENTS` - "assets are transferred to the `recipient` account inside
Confidential Intents. On Confidential Intents, 1Click settles swap output via signed transfer
intent rather than direct token transfer."

Decision (human): real quotes use `recipientType: "CONFIDENTIAL_INTENTS"` with `recipient` = the
trader's mainnet account, so the output stays in that account's Confidential Intents balance. The
server refuses any real quote whose output would go on-chain to the paying account. Refunds stay
`ORIGIN_CHAIN` to the payer (a refund shows only that the deposit came back). Dry quotes keep the
on-chain recipient `intents.near` (nothing is sent). Not yet confirmed with real funds: the first
Phase 4 trades must check SUCCESS, the status response's final amounts, and that the output shows
up in the trader's Confidential Intents balance. Check how to withdraw from that balance before
trading. Re-test with `pnpm smoke:quote --recipient-type CONFIDENTIAL_INTENTS` (needs the key).
