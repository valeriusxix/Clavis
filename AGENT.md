# AGENT.md — Clavis

> Build spec for an AI coding agent (Claude Code, Codex, or similar).
> Project name: **Clavis** (Latin for "key"). Use it everywhere: repo, UI, contract, README.
> Event: **NEAR HACKATHON: Build Beyond Boundaries** · development 2026-11-01T00:00Z → **2026-11-14T23:59Z** (hard deadline).

---

## 0. Mission

Build **Clavis**: a private copy-trading app on NEAR.

- Traders trade **confidentially** through NEAR Intents (Confidential Intents via the 1Click Swap API), so nobody on the public chain can see what they bought.
- Clavis records every trade, computes **verified PnL**, and shows **only the PnL** on a public leaderboard.
- Anyone can **buy a "key"** for a trader (paid in NEAR via our smart contract) to unlock that trader's full trade feed.
- Every trader's trade log is **hash-chained and committed on-chain**, so key holders can check the feed was not edited after the fact. Each real trade also carries 1Click's **signed quote**, so trades can't be invented.

One-line pitch: *"Traders keep their edge private, prove their PnL in public, and sell access to the people they choose."*

### Definition of done (the demo must do all of this)

1. A judge opens the app with **no wallet and no funds** and sees a leaderboard of traders with PnL, win rate, trade count, and trades hidden.
2. The judge clicks a trader, clicks **Buy key**, chooses **"Use demo account"**, and the trade feed unlocks.
3. The judge clicks **Verify log** and sees a green panel: the hash chain they recomputed in the browser matches the head committed in the NEAR contract (testnet), with a link to the transaction.
4. The judge opens **Trade**, keeps **Dry run** on, requests a confidential quote, and sees a **real 1Click quote** (`confidentiality: "basic"`) with amounts in USD.
5. At least **one real trader account** exists with **real, tiny mainnet confidential trades** made by the human, each showing "1Click-signed ✓".
6. `pnpm install && pnpm dev` runs locally in demo mode with **no API keys**.
7. Public repo, README written from the template in section 15.1, X demo post, and the submission form are done. The agent prepares these, and the human confirms and sends them.

---

## 1. Hard rules (never break these)

These come from HACKATHON.md and from common sense. Follow them even if a later instruction seems to conflict.

1. **Never sign transactions, spend tokens, or deploy to mainnet** without the human's explicit "yes" for that exact action.
2. **Never commit secrets.** Keys live in `.env` (gitignored). Ship `.env.example` with empty values.
3. **Never make the repo public, push, or force-push** without the human's confirmation.
4. **Never post on X** or anywhere else. Draft text only; the human posts.
5. **Never submit** to the hackathon without printing the full JSON payload and getting a "yes". Each repository can be submitted only once.
6. **Never invent endpoints, contract methods, field names, or package versions.** Read the docs (section 6) or the OpenAPI spec first. If something is unclear, write a tiny script that calls the real API, print the response, and build from that.
7. **There is no testnet for NEAR Intents.** Use `dry: true` quotes for development. Real swaps are mainnet only, with **≤ $4 per trade** (raised from $2 by the human on 2026-11-11), from a **separate dev account**, and only after human approval.
8. **Default to dry run** everywhere in the UI. Real execution needs an explicit toggle plus a confirmation dialog.
9. Be honest in the README and UI about the trust model (section 11). Label simulated data as **SIMULATED** everywhere it appears.
10. Stop and ask the human at every **CHECKPOINT** in section 13.

---

## 2. Hackathon facts you must respect

| Item | Value |
|---|---|
| Deadline | 2026-11-14T23:59:00Z, repo public + demo post + form |
| Judging | 2026-11-16 → 18. **Claude Code & Codex screen first**: they check the project runs and does what the README says. Humans decide. |
| Live rules | https://nearhackathon.com/HACKATHON.md (re-read before submitting) |
| Submission API | `POST https://nearhackathon.com/api/applications` (see HACKATHON.md for the exact contract) |
| Track ids for this project | `privacy`, `defi` (add `nfts` if keys become NFTs, `agents` if copy-agent ships) |
| Testnet projects | Allowed. Our contract runs on **testnet** by default; trades are on mainnet (Intents is mainnet-only). |
| Libraries / AI code | Allowed. **List them in the README.** |
| Local-only demo | Allowed, but a hosted demo is a plus. Keep it up until at least 2026-11-18 (ideally 11-25). |
| License | Add a `LICENSE` file (MIT). |

Write the README for a **machine reader as well as a human**: clear "do X → see Y" steps, no marketing fluff.

---

## 3. Product spec

### 3.1 Roles

- **Visitor**: browses the leaderboard. Sees PnL, never trade details.
- **Key holder**: bought a key for a trader. Sees that trader's full feed while the key is active. Can one-tap copy a trade (stretch P1).
- **Trader**: registers, sets a key price, trades confidentially through Clavis, earns from key sales (and copy-trade fees, stretch P1).

### 3.2 Core user flows

**Flow A: Browse (visitor)**
Leaderboard → trader card (30-day PnL %, total PnL $, win rate, trades committed, key price) → trader profile with equity curve. Trade rows are shown blurred as "🔒 N trades hidden".

**Flow B: Buy a key (key holder)**
Trader profile → **Buy key** → either:
- **Connect wallet** (NEAR testnet, Wallet Selector) → contract `buy_key(trader_id)` with attached NEAR → access granted until expiry, or
- **Use demo account** (demo mode only) → server simulates the purchase in SQLite → access granted.
Then the feed unlocks: time, pair, side, amount in/out, USD values, status, signature badge.

**Flow C: Verify (key holder)**
**Verify log** button → browser downloads the trader's full log, recomputes the hash chain locally, reads the committed head from the contract (`get_commitment`), and compares them. It then shows a checklist panel (section 11.3).

**Flow D: Trade (trader)**
Trade page → pick origin and destination token (from `GET /v0/tokens`) → amount → **Dry run ON** (default) → **Get confidential quote** → shows `amountOutFormatted`, `amountInUsd`, `amountOutUsd`, `timeEstimate`.
- Dry run: user may click **Simulate fill**, which records a SIMULATED trade so the flow can be demoed.
- Real mode (human only, mainnet): the wallet sends tokens to `depositAddress` → app submits the tx hash → server polls status → on `SUCCESS` the trade is logged, the chain head updates, and the head is committed on-chain.

**Flow E: Trader setup & earnings**
Become a trader (`register_trader(price, period_days)`) → see earnings → `withdraw()`.

### 3.3 Non-goals (do not build)

- Custody of user funds. Clavis never holds trading funds.
- Fully automatic copy trading that moves follower funds without a signature.
- Perps, leverage, lending.
- A token.

---

## 4. Architecture

```
┌────────────────────┐      REST/JSON      ┌───────────────────────────┐
│  apps/web          │ ──────────────────▶ │  apps/server              │
│  Vite + React + TS │ ◀────────────────── │  Node + TS (Fastify)      │
│  Wallet Selector   │                     │  SQLite (better-sqlite3)  │
└─────────┬──────────┘                     │  1Click client            │
          │ view calls / buy_key           │  PnL engine · hash chain  │
          ▼                                │  status poller · committer│
┌────────────────────┐   commit_log (tx)   └──────────┬────────────────┘
│ contracts/clavis  │ ◀────────────────────────────── │
│ Rust, near-sdk     │                                 │ quote / deposit / status
│ (NEAR testnet)     │                                 ▼
└────────────────────┘                     ┌───────────────────────────┐
                                           │ NEAR Intents 1Click API   │
                                           │ confidentiality: "basic"  │
                                           │ (mainnet, private shard)  │
                                           └───────────────────────────┘
```

### 4.1 Repo layout (pnpm workspace monorepo)

```
clavis/
├─ AGENT.md                  # this file
├─ README.md                 # write from the template in section 15.1
├─ LICENSE                   # MIT
├─ .env.example
├─ package.json              # workspace scripts: dev, build, test, seed, smoke
├─ pnpm-workspace.yaml
├─ apps/
│  ├─ web/                   # Vite + React + TS + Tailwind + Recharts
│  │  └─ src/
│  │     ├─ pages/           # Leaderboard, Trader, Trade, Keys, HowItWorks
│  │     ├─ components/      # TraderCard, EquityChart, TradeRow, LockedFeed,
│  │     │                   # VerifyPanel, QuoteCard, BuyKeyDialog, Badge
│  │     ├─ lib/             # api.ts, near.ts (wallet + view calls), hashchain.ts (shared)
│  │     └─ main.tsx
│  └─ server/
│     └─ src/
│        ├─ index.ts         # Fastify bootstrap
│        ├─ config.ts        # env parsing (zod)
│        ├─ db/              # schema.sql, db.ts, migrations
│        ├─ oneclick/        # client.ts, verifySignature.ts, types.ts
│        ├─ pnl/             # engine.ts + engine.test.ts
│        ├─ chain/           # hashchain.ts (+ test), committer.ts (near-api-js)
│        ├─ auth/            # nep413.ts (signed-message login), session.ts
│        ├─ jobs/            # statusPoller.ts, priceRefresher.ts
│        ├─ routes/          # traders.ts, trades.ts, keys.ts, auth.ts, meta.ts
│        └─ demo/            # seed.ts (deterministic), demoAccount.ts
├─ packages/
│  └─ shared/                # hashchain + canonical JSON + types used by web AND server
├─ contracts/
│  └─ clavis/               # Rust near-sdk contract + tests
└─ scripts/
   ├─ smoke-quote.ts         # Phase 0: one dry confidential quote, prints JSON
   ├─ seed-chain.ts          # commits seeded demo logs to testnet contract
   └─ smoke.ts               # end-to-end API smoke test for judges/CI
```

---

## 5. Tech stack & setup

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite, React 18+, TypeScript, Tailwind, Recharts, React Router | Mobile-responsive. Dark UI. |
| Wallet | NEAR Wallet Selector (`@near-wallet-selector/core`, `/modal-ui`, plus 2–3 wallet modules, e.g. MyNearWallet, Meteor, HOT) | **Confirm current package names and versions in the docs before installing.** |
| NEAR JS | `near-api-js` (or the newer `@near-js/*` packages) | View calls, server-side committer tx, NEP-413 verification. Check docs.near.org for the current recommendation. |
| Backend | Node 20+, Fastify, zod, better-sqlite3 | Simple, one process. |
| 1Click | `@defuse-protocol/one-click-sdk-typescript` **or** plain `fetch` | Base `https://1click.chaindefuser.com`. |
| Contract | Rust, `near-sdk` (current 5.x), `cargo-near`, `near-cli-rs` | Testnet by default. |
| Tests | vitest (TS), `cargo test` (contract), optional `near-workspaces` | |
| Hosting | Web on Vercel; server on Render, Railway, or Fly | Demo mode reseeds on boot. |

### 5.1 First commands (Phase 0)

```bash
# agent skill for NEAR Intents (read its SKILL.md before writing 1Click code)
npx skills add near/agent-skills --skill near-intents

pnpm init && pnpm add -w -D typescript vitest tsx
# scaffold apps/web with Vite React TS, apps/server with Fastify, packages/shared
# Rust toolchain + wasm target + cargo-near + near-cli-rs (follow docs.near.org quickstart)
```

### 5.2 `.env.example`

```bash
# --- mode ---
DEMO_MODE=true                 # true = seeded traders, demo account, no keys needed
NETWORK=testnet                # contract network (testnet default)

# --- 1Click (optional in demo mode) ---
ONECLICK_BASE_URL=https://1click.chaindefuser.com
ONECLICK_API_KEY=              # X-API-Key from https://partners.near-intents.org (without it an extra fee applies)

# --- NEAR contract ---
CLAVIS_CONTRACT_ID=           # e.g. clavis.<you>.testnet
COMMITTER_ACCOUNT_ID=          # account allowed to call commit_log
COMMITTER_PRIVATE_KEY=         # ed25519:... NEVER COMMIT
NEAR_RPC_URL=                  # public RPC from docs.near.org/api/rpc/providers

# --- server ---
PORT=8787
SESSION_SECRET=
DATABASE_PATH=./data/clavis.db

# --- web (Vite exposes VITE_*) ---
VITE_API_URL=http://localhost:8787
VITE_NETWORK=testnet
VITE_CLAVIS_CONTRACT_ID=
```

If `CLAVIS_CONTRACT_ID` is empty in demo mode, the Verify panel still recomputes the chain locally and shows "on-chain check skipped (no contract configured)". Never crash.

---

## 6. NEAR Intents 1Click API — what you need

**Read first:**
- Docs index for LLMs: https://docs.near-intents.org/llms.txt
- Making a request: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md
- Confidential swaps: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.md
- Verify quote signatures: https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature.md
- Signed intent execution (stretch): https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md
- OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml
- App fees: https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config.md
- Using NEAR tokens: https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/near-token.md

### 6.1 Endpoints (base `https://1click.chaindefuser.com`)

| Method | Path | Use |
|---|---|---|
| GET | `/v0/tokens` | Token list: `assetId`, `decimals`, `blockchain`, `symbol`, `price`, `priceUpdatedAt`. Also our **price source** for mark-to-market. |
| POST | `/v0/quote` | Get a quote. `dry: true` = no deposit address, nothing executes. |
| POST | `/v0/deposit/submit` | Optional: `{ depositAddress, txHash }` to speed up detection. |
| GET | `/v0/status?depositAddress=...` | Poll until `SUCCESS`, `REFUNDED`, or `FAILED`. Add `depositMemo` if the quote returned one. |

**Auth:** header `X-API-Key: <key>` (recommended; JWT bearer is legacy). Without a key, quotes still work but carry an extra fee. Demo mode must work **without** a key.

### 6.2 Quote request (confidential, foreign-to-foreign — our default)

```json
{
  "dry": true,
  "swapType": "EXACT_INPUT",
  "slippageTolerance": 100,
  "originAsset": "nep141:wrap.near",
  "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "<assetId from /v0/tokens>",
  "amount": "<integer string in smallest units>",
  "recipient": "<trader's receiving address on destination chain>",
  "recipientType": "DESTINATION_CHAIN",
  "refundTo": "<trader>.near",
  "refundType": "ORIGIN_CHAIN",
  "confidentiality": "basic",
  "deadline": "<now + 10 min, ISO>",
  "referral": "clavis"
}
```

- `confidentiality`: `public` (default) | `basic` | `advanced`. **Always send `basic`** unless testing shows `advanced` is needed. Document the choice in the README.
- `amount` must be an **integer string in base units**. Convert with `decimals` from `/v0/tokens`. Never send `"0.01"`.
- Keep origin tokens on **NEAR (NEP-141)**, e.g. `wrap.near` or NEAR-native USDC, so the deposit is one wallet `ft_transfer` call. Read "Using NEAR tokens" before handling native NEAR.

### 6.3 Quote response fields we store

`correlationId`, `timestamp`, `signature`, `quoteRequest`, and `quote.{depositAddress, depositMemo, amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut, amountOutFormatted, amountOutUsd, minAmountOut, deadline, timeEstimate}`.

**Store the full raw quote JSON and `signature`.** 1Click's docs say to keep these. They are our proof a trade was really quoted by 1Click.

### 6.4 Status values

`PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, `FAILED`. Show `REFUNDED` and `FAILED` clearly in the UI. Only `SUCCESS` trades enter the PnL log. **Inspect a real status response** (Phase 4) and store its final amounts if present; otherwise use the quote amounts and mark them "quoted".

### 6.5 Things that are NOT available — do not depend on them

- **Native view keys** for Confidential Intents: announced as planned, not confirmed shipped. Build a `DisclosureAdapter` interface with one implementation (`ClavisRelayAdapter`, our server) so native view keys can be added later.
- `GET /v0/account/history` is **invite-only**. Don't use it.

### 6.6 Phase 0 smoke script (do this before anything else)

`scripts/smoke-quote.ts`: fetch `/v0/tokens`, pick `wrap.near` → a USDC asset, request a **dry** quote with `confidentiality: "basic"`, and print the full JSON. Then verify the signature per the docs. **CHECKPOINT:** show the human the output.

---

## 7. Smart contract — `contracts/clavis` (Rust, near-sdk)

Purpose: key sales, access records, trader earnings, and **on-chain commitments** of each trader's trade-log hash.

### 7.1 State

```rust
pub struct Clavis {
    owner_id: AccountId,
    committer_id: AccountId,        // server account that may call commit_log
    platform_fee_bps: u16,          // e.g. 500 = 5%
    traders: IterableMap<AccountId, Trader>,
    access: LookupMap<(AccountId /*trader*/, AccountId /*holder*/), u64 /*expiry ns*/>,
    balances: LookupMap<AccountId, NearToken>,   // withdrawable earnings
    platform_balance: NearToken,
}

pub struct Trader {
    display_name: String,
    price: NearToken,         // per period
    period_days: u32,         // e.g. 30
    created_at: u64,
    commit_count: u64,        // number of trades covered by head_hash
    head_hash: String,        // hex sha256
    last_commit_at: u64,
    keys_sold: u64,
}
```

Use the collection types recommended by the current near-sdk docs (`store::IterableMap` / `LookupMap`).

### 7.2 Methods

| Method | Type | Rules |
|---|---|---|
| `new(owner_id, committer_id, platform_fee_bps)` | init | |
| `register_trader(display_name, price, period_days)` | change, payable | Caller becomes a trader. Attached deposit covers storage. Reject duplicates. |
| `update_trader(display_name?, price?, period_days?)` | change | Trader only. |
| `buy_key(trader_id)` | change, payable | `attached ≥ price + storage`. Extend expiry: `max(now, current_expiry) + period`. Credit `price × (1 − fee)` to trader, fee to platform, refund excess. Increment `keys_sold`. |
| `withdraw()` | change | Transfer the caller's balance. Zero it **before** the transfer promise. |
| `commit_log(trader_id, trade_count, head_hash)` | change | `committer_id` only. Require `trade_count > commit_count`. `head_hash` must be 64 hex chars. |
| `set_committer(account_id)` | change | Owner only. |
| `get_trader(trader_id)` | view | |
| `list_traders(from_index, limit)` | view | |
| `has_access(trader_id, account_id) → bool` | view | Trader always has access to self. |
| `get_access(trader_id, account_id) → Option<u64>` | view | Expiry in ns. |
| `get_commitment(trader_id) → { trade_count, head_hash, last_commit_at }` | view | Used by the Verify panel. |
| `get_balance(account_id)` | view | |

- Emit **NEP-297 JSON events** (`EVENT_JSON:` logs) for `trader_registered`, `key_purchased`, `log_committed`, `withdrawn`.
- Handle **storage staking** correctly: measure `env::storage_usage()` before and after, charge the caller, and refund the rest.
- Unit tests for every rule above, including: non-committer rejected, non-increasing count rejected, expiry extends instead of resetting, excess refunded, fee math.
- Deploy to **testnet** (`clavis.<human>.testnet`). **CHECKPOINT** before deploy. Get testnet NEAR from the faucet.

### 7.3 Stretch (P2): keys as NFTs

Mint a NEP-171 token per key (metadata: trader, expiry). `has_access` checks the token owner, so keys become **transferable and resellable**. This adds track `nfts`. Only do this after the core ships.

---

## 8. Backend — `apps/server`

### 8.1 SQLite schema

```sql
CREATE TABLE traders (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE trades (
  id TEXT PRIMARY KEY,                  -- uuid
  trader_id TEXT NOT NULL REFERENCES traders(account_id),
  seq INTEGER NOT NULL,                 -- 1..n per trader, set on SUCCESS
  status TEXT NOT NULL,                 -- QUOTED|PENDING_DEPOSIT|...|SUCCESS|REFUNDED|FAILED|SIMULATED
  is_simulated INTEGER NOT NULL DEFAULT 0,
  origin_asset TEXT NOT NULL, origin_symbol TEXT NOT NULL,
  dest_asset TEXT NOT NULL,   dest_symbol TEXT NOT NULL,
  amount_in TEXT NOT NULL,  amount_in_formatted TEXT NOT NULL,  amount_in_usd TEXT NOT NULL,
  amount_out TEXT NOT NULL, amount_out_formatted TEXT NOT NULL, amount_out_usd TEXT NOT NULL,
  confidentiality TEXT NOT NULL,        -- basic|advanced
  deposit_address TEXT, deposit_memo TEXT, tx_hash TEXT,
  quote_json TEXT NOT NULL,             -- full raw response
  quote_signature TEXT,                 -- null for simulated
  signature_valid INTEGER,              -- 1/0/null
  created_at TEXT NOT NULL, settled_at TEXT,
  UNIQUE (trader_id, seq)
);

CREATE TABLE chain_heads (
  trader_id TEXT PRIMARY KEY,
  trade_count INTEGER NOT NULL,
  head_hash TEXT NOT NULL,
  committed_count INTEGER NOT NULL DEFAULT 0,
  commit_tx TEXT
);

CREATE TABLE demo_access (               -- demo-mode simulated key purchases
  trader_id TEXT, holder_id TEXT, expires_at TEXT,
  PRIMARY KEY (trader_id, holder_id)
);

CREATE TABLE prices (asset_id TEXT PRIMARY KEY, symbol TEXT, price REAL, updated_at TEXT);
```

### 8.2 Services

- **oneclick/client.ts**: typed `getTokens()`, `getQuote(req)`, `submitDeposit()`, `getStatus()`. Retries with backoff on 5xx. Sends `X-API-Key` only if set.
- **oneclick/verifySignature.ts**: implement exactly as the "Verify Quote Signatures" doc says. Unit-test it against a real saved quote.
- **jobs/statusPoller.ts**: every 5 s, poll non-terminal trades. On `SUCCESS`: assign `seq`, append to the hash chain, recompute PnL cache, queue a commit.
- **chain/committer.ts**: signs `commit_log` with `COMMITTER_PRIVATE_KEY`. Batch at most one commit per trader per 30 s. Store the tx hash.
- **jobs/priceRefresher.ts**: refresh `prices` from `/v0/tokens` every 60 s. Stablecoins (USDC/USDT) = 1.0.
- **pnl/engine.ts**: section 9. Pure functions with heavy unit tests.
- **auth/nep413.ts**: login by signed message (NEP-413) from Wallet Selector `signMessage`. Verify the signature and that the public key is a full-access key of the account (RPC `view_access_key`). Issue an HTTP-only session cookie.
- **demo/seed.ts**: section 10.

### 8.3 REST API

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/meta` | none | `{ demoMode, network, contractId, hasOneClickKey }` |
| GET | `/api/traders` | none | Leaderboard: id, name, simulated flag, pnl30dPct, pnlTotalUsd, winRate, tradeCount, committedCount, headHash, keyPrice. **No trade details.** |
| GET | `/api/traders/:id` | none | Profile + equity curve points + `lockedCount`. |
| GET | `/api/traders/:id/feed` | session or demo | Full trade list, **only if** `has_access` (contract) or `demo_access` row. Otherwise 403 with `{ locked: true }`. |
| GET | `/api/traders/:id/log` | session or demo | Canonical log entries for hash verification (same access rule). |
| GET | `/api/tokens` | none | Cached token list (filtered to a sensible top set). |
| POST | `/api/trades/quote` | session (trader) or demo | Calls 1Click with `confidentiality: "basic"`. Body: `{ originAsset, destinationAsset, amountHuman, recipient, dry }`. |
| POST | `/api/trades/:id/simulate` | demo or dry | Records a SIMULATED fill from a dry quote. |
| POST | `/api/trades/:id/deposit` | session (trader) | `{ txHash }` → `/v0/deposit/submit`, status → `KNOWN_DEPOSIT_TX`. |
| GET | `/api/trades/:id` | session (trader) | Live status. |
| POST | `/api/demo/login` | demo only | Session as `demo-viewer`. |
| POST | `/api/demo/buy-key` | demo only | Inserts a `demo_access` row (30 days). |
| POST | `/api/auth/nep413` | none | Verify signed message → session. |

Return clear JSON errors: `{ error: { code, message } }`.

---

## 9. PnL engine (deterministic, documented, tested)

Input: a trader's `SUCCESS` (and `SIMULATED`) trades ordered by `seq`, plus current prices.

For each trade: sell `qIn` of asset X, receive `qOut` of asset Y. Let `vIn = amount_in_usd` and `vOut = amount_out_usd` at execution.

```
For asset X (disposed):
  if holdings[X] has a cost basis:
      cost = avgCost[X] * qIn
  else:                                   # first time we see X = funding
      cost = vIn
  realized += vOut - cost                 # what you got minus what it cost
  holdings[X] -= qIn (floor at 0); costBasis[X] -= cost (floor at 0)
  winCount += (vOut - cost > 0) ? 1 : 0; disposals += 1

For asset Y (acquired):
  holdings[Y] += qOut; costBasis[Y] += vOut

unrealized = Σ_assets (holdings[a] * price[a] - costBasis[a])
totalPnL   = realized + unrealized
capital    = peak Σ costBasis over time (never 0; min $1)
pnlPct     = totalPnL / capital
winRate    = winCount / disposals
pnl30d     = same calc limited to trades in the last 30 days, using the
             portfolio state at day −30 as the starting basis
equityCurve = daily points of (realized + unrealized) using historical
              prices from trade records (or the seed's price path)
```

- Stablecoins have price 1.0 and no unrealized PnL.
- Fees are naturally included because we use what was actually received.
- Put this exact explanation in the README's "How PnL is calculated" section.
- Unit tests: single round-trip win, single loss, partial sells, multi-asset, a stablecoin-only path (≈ −fees), and the empty trader.

---

## 10. Demo mode (this is what most judges will see)

`DEMO_MODE=true` is the default in `.env.example`.

### 10.1 Seeded traders (deterministic, `seed = 2026`)

Five traders, clearly labeled **SIMULATED**, each with 25–60 trades over the last 45 days across 4–6 real assets from `/v0/tokens` (e.g. NEAR, BTC, ETH, SOL, ZEC, USDC). Use a seeded random walk for price paths. Give each a personality so the leaderboard is interesting:

| Handle | Style | Outcome |
|---|---|---|
| `quiet-whale` | few large swing trades | +38% |
| `zec-maxi` | rotates into ZEC on dips | +21% |
| `scalp-sensei` | many small trades | +7%, high win rate |
| `degen-dora` | chases pumps | −14% (show losers too, it builds trust) |
| `steady-eddie` | weekly BTC/ETH DCA | +11% |

Plus **one real trader** (the human's dev account, e.g. `clavis-dev.near`) whose rows come from real mainnet confidential trades made in Phase 4. Its rows show "1Click-signed ✓". Persist them in `apps/server/src/demo/real-trades.json` (no secrets, only public quote data) so demo mode always includes them.

### 10.2 Demo account

`Use demo account` button → `POST /api/demo/login` → `POST /api/demo/buy-key`. No wallet needed. A banner says "Demo account — key purchase simulated".

### 10.3 On-chain commitments for seeded data

`pnpm seed:chain` commits each seeded trader's head to the testnet contract once (human runs it after deploy). This makes the **Verify** button do a real on-chain comparison, even in demo mode. Store the resulting tx hashes in the seed output so the UI can link to the explorer.

### 10.4 Dry-run trading in demo

The Trade page calls the **real** 1Click quote endpoint with `dry: true` (works without an API key), then **Simulate fill** records a SIMULATED trade for `demo-viewer`'s own trader profile. This proves live integration with zero funds.

---

## 11. Integrity & trust model

### 11.1 Canonical log entry (in `packages/shared`, used by server AND browser)

```ts
type LogEntry = {
  seq: number;
  traderId: string;
  settledAt: string;          // ISO
  originAsset: string; destAsset: string;
  amountIn: string; amountOut: string;          // base units
  amountInUsd: string; amountOutUsd: string;
  confidentiality: "basic" | "advanced" | "simulated";
  quoteSignature: string | null;
  correlationId: string | null;
};
```

Canonical JSON = keys sorted alphabetically, no whitespace, UTF-8.

### 11.2 Hash chain

```
h0 = sha256("clavis:v1:" + traderId)
hi = sha256(h(i-1) + canonicalJSON(entry_i))     # hex strings
head = h_n, committed on-chain via commit_log(traderId, n, head)
```

Use Web Crypto in the browser and `node:crypto` on the server. One shared implementation, tested for identical output on both.

### 11.3 Verify panel checklist (browser-side)

1. ✅ Downloaded N log entries.
2. ✅ Recomputed hash chain in your browser → `head = abcd…`.
3. ✅ On-chain commitment for this trader (contract `get_commitment`) → `trade_count = N`, `head = abcd…` → **match**. Explorer link.
4. ✅ / ➖ For real trades: 1Click quote signature valid (server-verified flag + "re-verify" button that calls the server verifier).
5. ➖ SIMULATED entries counted and labeled.

Mismatch → red panel explaining which step failed.

### 11.4 Honest trust model (copy into README)

- **What the public sees:** PnL, win rate, trade count, and the on-chain hash head. Not trades.
- **What the chain sees:** Deposits into 1Click and the hash commitments. Confidential Intents makes deposits and withdrawals unlinkable, so observers can't tell what a trader bought.
- **What Clavis's server sees:** Every trade a trader places through Clavis, because it relays the quotes. **Traders trust Clavis's operator with their trade details** (the same trust a key holder places in the trader).
- **What stops cheating:** The commitments mean history can't be rewritten after a key is sold. 1Click signatures mean trades can't be invented. Clavis only counts trades routed through it, so traders can't cherry-pick wins from elsewhere.
- **Roadmap:** (a) run the relay and logger inside a TEE with remote attestation; (b) switch to **native Confidential Intents view keys** via `DisclosureAdapter` once NEAR ships them, which removes the operator from the trust path.

---

## 12. Stretch goals (only after section 13 Phase 4 passes)

Priority order:

- **P1: One-tap copy + trader fees.** A key holder sees a trade and clicks **Copy** → prefilled quote at their own size → their wallet signs their own deposit. Add `appFees: [{ recipient: <trader intents account>, fee: 10 }]` (bps) so the trader earns on copies. **Read the fee-config doc first** and confirm the recipient semantics. Adds track `agents` if paired with P3.
- **P2: Keys as NFTs** (section 7.3). Adds track `nfts`.
- **P3: Private strategy card.** For key holders only, send the trader's log to a TEE-hosted model on **NEAR AI Cloud** (OpenAI-compatible API, base `https://cloud-api.near.ai/v1`) to summarise the strategy. Fetch and verify the attestation with a fresh nonce per https://docs.near.ai/cloud/verification and show a "Verified private inference" panel. Keep nothing server-side after the response.
- **P4: Any-chain wallets.** Evaluate an intent-based connect option (e.g. Aurora's / HOT's chain-abstraction connectors). **Read their docs first; do not guess package names.**

---

## 13. Build plan (target dates, with checkpoints)

Today is 2026-11-01. Leave the last 2 days for polish and submission.

### Phase 0 — Ground truth (Nov 1–2)
- Read section 6 docs and install the `near-intents` skill.
- Scaffold the monorepo. Write `scripts/smoke-quote.ts`.
- **Acceptance:** a printed dry confidential quote and a signature check result.
- **CHECKPOINT 0:** show the human the output and the proposed file layout. Wait for OK.

### Phase 1 — Contract (Nov 2–4)
- Implement section 7 with unit tests (`cargo test` green).
- **CHECKPOINT 1:** ask before deploying to testnet. Deploy, init, and register 1 test trader.
- **Acceptance:** `near view <contract> get_commitment` works. A `buy_key` from a second testnet account works.

### Phase 2 — Server core (Nov 3–6)
- DB, 1Click client, PnL engine (tests), hash chain (tests, shared package), demo seed, routes.
- **Acceptance:** `pnpm test` green. `GET /api/traders` returns 5 SIMULATED traders with sensible numbers. `/feed` is 403 without access and 200 after `/api/demo/buy-key`.

### Phase 3 — Web app (Nov 5–9)
- Pages: Leaderboard, Trader (locked/unlocked + Verify), Trade (dry quote + simulate), My Keys, How it works. Wallet Selector on testnet.
- Use a deliberate visual design (frontend-design guidance): dark theme, one accent colour, monospace for numbers and hashes, blurred locked rows with a key icon. Works at 375 px width.
- **Acceptance:** the full judge path in README section "Test it in 3 minutes" works in a fresh browser with no wallet.

### Phase 4 — Real trades (Nov 8–10)
- **CHECKPOINT 4:** ask the human to fund a separate mainnet dev account with ~$10 and approve **3–5 trades of ≤ $4**.
- Execute via the app (real mode), confirm `SUCCESS`, store real quotes, verify signatures, commit heads, and export to `real-trades.json`.
- **Acceptance:** the real trader shows on the leaderboard with "1Click-signed ✓" rows and a matching on-chain head.

### Phase 5 — Stretch (Nov 10–12), only P1 first
- **CHECKPOINT 5:** ask which stretch goals to do given the remaining time.

### Phase 6 — Ship (Nov 12–14)
- Deploy web and server. Run `pnpm seed:chain` (human approves). Finalize the README. Add `LICENSE`.
- Write `scripts/smoke.ts` (hits every public endpoint and the demo flow, exits non-zero on failure). The screening bots love this.
- Draft the demo video script (section 15.2) and X post (section 15.3).
- **CHECKPOINT 6:** human makes the repo public, records and posts the demo, and gives you the post URL.
- **CHECKPOINT 7:** build the submission payload (section 15.4), print it, and wait for "yes".

---

## 14. Testing checklist

- `pnpm test` → vitest: PnL engine, hash chain (server ≡ browser output), canonical JSON, signature verifier (saved real quote), access rules.
- `cargo test` → contract rules (section 7.2).
- `pnpm smoke` → end-to-end against a running server in demo mode.
- Manual: the README judge path on desktop and mobile width. Verify panel green. Dry quote returns. A deliberately corrupted log entry → Verify panel red.
- Fresh clone test: `git clone … && pnpm install && pnpm dev` with an **empty** `.env` (copied from example) must work.

---

## 15. README, demo, post, submission

### 15.1 README.md — write it from this template

Create `README.md` in the repo root using the template below. Rules:

- **Keep the order.** The judge test steps come first, right after the title, tagline and one-paragraph intro.
- **Match the real UI exactly.** Every button label, page name and trader handle in the test steps must be what the app actually shows. If you rename something in the UI, update the README in the same commit. The screening bots follow these steps literally.
- **Replace every `TODO`** (hosted URL, repo URL, contract id, explorer links, real trader id, final library list, team name). No `TODO` may remain at submission; grep for it.
- **Keep the trust model and limitations honest.** Don't remove them.
- **Update the Features list** with the stretch goals that actually shipped, and nothing that didn't.
- Plain language, short sentences, no marketing fluff. A judge, an LLM and a non-technical viewer should all understand it.

Template (everything between the four-backtick fences):

````markdown
# 🔑 Clavis

**Trade in private. Prove your PnL in public. Sell the key to your trades.**

Clavis (Latin for "key") is a private copy-trading app built on NEAR. Traders trade confidentially through **NEAR Confidential Intents**, their profit and loss is shown publicly and anchored on-chain, and followers **buy a key** to see the actual trades.

> Built at **NEAR HACKATHON: Build Beyond Boundaries** (Nov 1–14, 2026) · Tracks: `privacy`, `defi`

---

## 🧪 Test it in 3 minutes (for judges)

No wallet, no funds and no API keys needed. Every step says what to do and what you should see.

### Option A: Hosted demo (fastest)

1. **Open** `TODO: hosted URL`
   → You see the **Leaderboard**: traders ranked by 30-day PnL, with win rate, trade count and key price. Their trades are hidden.
2. **Click any trader** (try `quiet-whale`).
   → You see their equity curve and a blurred feed: **"🔒 N trades hidden"**.
3. **Click "Buy key" → "Use demo account".**
   → A banner says "Demo account — key purchase simulated". The feed **unlocks** and shows every trade: time, pair, size, USD value, status.
4. **Click "Verify log".**
   → Your browser rebuilds the trader's hash chain and compares it with the hash stored in the Clavis contract on NEAR testnet. You see a **green checklist** and a link to the on-chain transaction.
5. **Open the trader `TODO: real trader id`.**
   → These are **real mainnet confidential trades** (tiny amounts). Each row shows **"1Click-signed ✓"**, meaning the quote was signed by NEAR Intents' 1Click service.
6. **Go to "Trade"**, leave **Dry run ON**, pick NEAR → USDC, enter `1`, click **"Get confidential quote"**.
   → You see a **live quote from the NEAR Intents 1Click API**, requested with `confidentiality: "basic"`. No funds move.
7. *(Optional)* Click **"Simulate fill"**.
   → The simulated trade appears in your own trader profile, labeled **SIMULATED**.

### Option B: Run it locally

Requirements: Node 20+ and pnpm.

```bash
git clone TODO: repo URL
cd clavis
cp .env.example .env        # demo mode is on by default, no keys needed
pnpm install
pnpm dev                    # web → http://localhost:5173 · API → http://localhost:8787
```

Then follow steps 1–7 above at `http://localhost:5173`.

Check everything automatically:

```bash
pnpm test     # PnL engine, hash chain, signature checks, access rules
pnpm smoke    # end-to-end check of every public endpoint + the demo flow
```

> In local demo mode with no contract configured, step 4 still recomputes the hash chain and marks the on-chain check as "skipped". Set `CLAVIS_CONTRACT_ID` in `.env` to compare against testnet.

---

## The problem

On-chain trading is fully public. That leaves good traders two bad choices:

- **Trade in public**, and bots and copycats front-run or copy you for free.
- **Trade privately**, and you can never prove you're any good, so you can't build a following or earn from it.

Followers are stuck too. Screenshots of PnL are easy to fake, and "signal groups" can hide their losing trades.

## The solution

Clavis splits a trader's record into two layers:

| Who | Sees |
|---|---|
| **Everyone** | Verified PnL, win rate, trade count, and an on-chain fingerprint (hash) of the full trade history |
| **Key holders** | Every trade, in full, while their key is active |
| **The public chain** | Nothing about what was traded. Confidential Intents makes deposits and withdrawals unlinkable. |

Traders set a key price in NEAR. Followers pay through the Clavis smart contract, and the trader withdraws their earnings.

## How it works

```
Trader ──▶ Clavis app ──▶ NEAR Intents 1Click API (confidentiality: "basic")
                │                      │
                │                      └─▶ trade executes privately on NEAR's private shard
                ▼
        Clavis server records the trade + 1Click's signed quote
                │
                ├─▶ updates PnL ──▶ public leaderboard
                └─▶ extends the trader's hash chain ──▶ commit_log() on the Clavis contract

Follower ──▶ buy_key() on the contract ──▶ feed unlocks ──▶ "Verify log" in the browser
```

1. **Trade privately.** The trader requests a quote with `confidentiality: "basic"`, sends the deposit, and NEAR Intents executes the swap on a private shard.
2. **Record and prove.** Clavis stores each trade with 1Click's **signed quote**, so trades can't be invented.
3. **Commit.** Each trader's trade log forms a **hash chain**. The latest hash is written to the Clavis contract, so history can't be rewritten after keys are sold.
4. **Sell access.** Followers buy a key on-chain. The server only serves a trader's feed to accounts where the contract says `has_access = true`.
5. **Verify.** Key holders recompute the hash chain in their own browser and check it against the contract.

## Where NEAR does the work

- **Confidential Intents (via the 1Click Swap API):** private cross-chain execution. Without it, the "private" in private copy-trading isn't possible.
- **NEAR smart contract (Rust):** key sales, access expiry, trader earnings, and on-chain commitments of every trader's trade log.
- **NEAR accounts and signed messages (NEP-413):** wallet login without passwords.
- **NEAR Intents token list:** live prices for marking open positions.

## How PnL is calculated

Every trade sells some amount of asset X and receives some amount of asset Y, with USD values recorded at execution.

- **Selling X:** realized PnL += what you received (USD) − what X cost you (average cost basis).
- **Buying Y:** Y's holdings and cost basis go up by what you received.
- **Unrealized PnL** = current value of holdings − their cost basis.
- **PnL %** = total PnL ÷ peak capital deployed. **Win rate** = profitable sells ÷ all sells.

Fees are included automatically because we use what was actually received. Full spec and tests are in `apps/server/src/pnl/`.

## Trust model (honest version)

- Clavis's server **sees the trades placed through it**, because it relays the quotes. Traders trust the Clavis operator with their trade details.
- Clavis **cannot invent trades** (each real trade carries 1Click's signature) and **cannot rewrite history** (hash heads are on-chain).
- Only trades placed **through Clavis** count, so traders can't cherry-pick wins made elsewhere.
- **Roadmap:** run the relay inside a TEE with remote attestation, then switch to **native Confidential Intents view keys** when NEAR ships them. That removes Clavis's operator from the trust path. The code already isolates this behind a `DisclosureAdapter` interface.

## Features

- Public leaderboard with verified PnL, win rate and equity curves
- Locked and unlocked trade feeds, gated by the on-chain key contract
- In-browser hash-chain verification against the NEAR contract
- Live confidential quotes from the 1Click API, with dry run on by default
- Real mainnet confidential trades with signature verification
- Demo mode: seeded traders and a demo account so anyone can test it
- `TODO: add any stretch features shipped (one-tap copy with trader fees, NFT keys, private AI strategy card)`

## Networks and addresses

| Item | Value |
|---|---|
| Clavis contract | `TODO: clavis.<account>.testnet` (NEAR **testnet**) |
| Example commit transaction | `TODO: explorer link` |
| Trade execution | NEAR Intents **mainnet**. Intents has no testnet, so real trades used ≤ $4 each from a dev account. |
| Real trader account | `TODO` |

Simulated traders are labeled **SIMULATED** everywhere they appear.

## Project structure

```
apps/web         React + Vite frontend
apps/server      Node API: 1Click client, PnL engine, hash chain, committer, demo seed
packages/shared  Hash chain + canonical JSON used by both browser and server
contracts/clavis  Rust NEAR contract: keys, access, earnings, log commitments
scripts/         smoke-quote, seed-chain, smoke
```

## Configuration

Copy `.env.example` to `.env`. Everything is optional in demo mode.

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | `true` = seeded traders + demo account |
| `ONECLICK_API_KEY` | 1Click partner key. Optional: without it, quotes still work with an extra fee. |
| `CLAVIS_CONTRACT_ID` | Contract to read and commit to |
| `COMMITTER_ACCOUNT_ID` / `COMMITTER_PRIVATE_KEY` | Account allowed to call `commit_log` (keep secret) |
| `VITE_API_URL`, `VITE_NETWORK`, `VITE_CLAVIS_CONTRACT_ID` | Frontend settings |

## Limitations

- The server operator can see trades (see Trust model).
- Contract runs on testnet for the hackathon; mainnet deployment is a config change.
- Only trades routed through Clavis are tracked.
- Demo traders are simulated; one trader is real.

## Built with

NEAR Intents 1Click Swap API · Confidential Intents · NEAR smart contracts (Rust, near-sdk) · NEAR Wallet Selector · React, Vite, Tailwind, Recharts · Node, Fastify, SQLite · `TODO: final library list`.

AI coding assistants were used during development.

## License

MIT, see `LICENSE`.

## Team

`TODO: name` · X: [@_valeriusx](https://x.com/_valeriusx)
````

### 15.2 Demo video (≤ 2 min, the human records)

1. (0:00) Problem in one line: "On-chain traders either expose their edge or can't prove they have one."
2. (0:10) Leaderboard: PnL visible, trades locked.
3. (0:25) Buy key → feed unlocks.
4. (0:45) Verify → green checks → explorer link to `commit_log`.
5. (1:05) Trade page → confidential quote (`basic`) → real trade row with "1Click-signed ✓".
6. (1:35) NEAR's role in one sentence + repo link.

### 15.3 X post draft (human edits and posts)

```
On-chain traders have two bad options: trade in public and get copied, or trade privately and never prove you're good.

Clavis fixes that. Trades run through NEAR Confidential Intents, so nobody sees them. PnL is hash-committed on NEAR, so everyone can trust it. Followers buy a key to unlock the feed.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

Demo: <url>
Repo: <url>

Traders: would you sell access to your trades if your PnL was provable?
```

### 15.4 Submission payload (send only after explicit "yes")

Collect every value from the human. **Never invent any.** `projectName`, `leadName`, `email`, `size` (`"1"` for solo), `tracks` (`["privacy","defi", ...]`), `nearAddress` (mainnet prize account), `projectUrl`, `demoUrl`, `idea` (20–2000 chars: problem, product, NEAR's role), and `consent: true` after reading them the contact notice verbatim. Generate `requestId` once (UUID) and reuse it on retries. Do **not** send a `website` field. Full contract: https://nearhackathon.com/HACKATHON.md.

---

## 16. Known unknowns — resolve early, record the answers in `docs/DECISIONS.md`

1. Exact signature verification steps → read the verify-quote-signature doc in Phase 0.
2. Final amounts in the status response → inspect a real response in Phase 4.
3. Best origin token for a one-call wallet deposit (wNEAR vs NEAR-native USDC) → test with dry quotes in Phase 0.
4. `basic` vs `advanced` confidentiality differences → check the docs and changelog; default `basic`.
5. Whether NEAR ships native view keys before Nov 14 → if yes, implement `NativeViewKeyAdapter` as a stretch.
6. `appFees` recipient format for P1 → read fee-config.

When blocked for more than ~30 minutes on any external API, stop, write what you tried, and ask the human.
