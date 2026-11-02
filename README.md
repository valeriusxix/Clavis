# 🔑 Clavis

**Trade in private. Prove your PnL in public. Sell the key to your trades.**

Clavis (Latin for "key") is a private copy-trading app built on NEAR. Traders trade confidentially through **NEAR Confidential Intents**, their profit and loss is shown publicly and anchored on-chain, and followers **buy a key** to see the actual trades.

> Built at **NEAR HACKATHON: Build Beyond Boundaries** (Nov 1–14, 2026) · Tracks: `privacy`, `defi`

---

## 🧪 Test it in 3 minutes (for judges)

No wallet, no funds and no API keys needed. Every step says what to do and what you should see.

### Option A: Hosted demo (fastest)

1. **Open** `TODO: hosted URL`
   → You see the **Leaderboard**: traders ranked by 30-day PnL, with total PnL, win rate, trades committed and key price. Their trades are hidden.
2. **Click any trader** (try `quiet-whale`).
   → You see their equity curve and a blurred feed with a lock: **"N trades hidden"**.
3. **Click "Buy key" → "Use demo account".**
   → A banner says "Demo account — key purchase simulated". The feed **unlocks** and shows every trade: time, side, amounts, USD values, and a SIMULATED or status badge.
4. **Click "Verify log".**
   → Your browser rebuilds the trader's hash chain and compares it with the hash stored in the Clavis contract on NEAR testnet. You see a **green checklist** and a link to the on-chain transaction. Click **"Tamper test"** to edit one entry in your downloaded copy: the panel turns **red**.
5. **Open the trader `TODO: real trader id`, then click "Buy key" → "Use demo account".**
   → These are **real mainnet confidential trades** (tiny amounts). Each row shows **"1Click-signed ✓"**, meaning the quote was signed by NEAR Intents' 1Click service.
   This demo trader's trades are published in the repo on purpose, so anyone can re-check the 1Click signatures. In normal use, trade feeds stay private until a key is bought.
6. **Go to "Trade"**, leave **Dry run ON**, pick NEAR → USDC, enter `1`, click **"Get confidential quote"**.
   → You see a **live quote from the NEAR Intents 1Click API**, requested with `confidentiality: "basic"`, with the amounts in USD and "signed by 1Click". No funds move.
7. *(Optional)* Click **"Simulate fill"**.
   → The simulated trade appears in your own trader profile (**"View in your trader profile →"**), labeled **SIMULATED**.

Your demo account is yours alone: each browser gets its own (shown in the header as `demo-… (demo)`), and **"Reset demo"** in the header starts a fresh one. Demo keys and simulated trades are deleted after 24 hours, a demo account can record up to 20 simulated trades, and demo profiles never appear on the leaderboard.

### Option B: Run it locally

Requirements: Node 22.22+ and pnpm.

```bash
git clone https://github.com/valeriusxix/Clavis
cd Clavis
cp .env.example .env        # demo mode is on by default, no keys needed
pnpm install
pnpm dev                    # web → http://localhost:5173 · API → http://localhost:8787
```

Then follow steps 1–7 above at `http://localhost:5173`.

Check everything automatically:

```bash
pnpm test     # PnL engine, hash chain, signature checks, access rules, API
pnpm smoke    # end-to-end check of every public endpoint + the demo flow
cd contracts/clavis && cargo test   # contract: unit tests + local NEAR sandbox test (Rust; Linux or macOS)
```

> `cargo test` needs Linux or macOS: the sandbox test runs a local NEAR node (`near-sandbox`), which has no Windows build, and the test dependencies compile NASM and OpenSSL code. On Windows, run it inside WSL.

> In local demo mode with no contract configured, step 4 still recomputes the hash chain and marks the on-chain check as "skipped". Set `CLAVIS_CONTRACT_ID` in `.env` to compare against testnet.
>
> Without `ONECLICK_API_KEY`, step 6 returns a clearly labelled **PUBLIC** dry quote instead: 1Click only serves confidential quotes to requests with a partner key. The hosted demo has a key.

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
| **The public chain** | That the trader deposited some amount of token A into 1Click, but not what it was swapped into or where it went, as long as the output is not sent back to the same public account. |

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
2. **Record and prove.** Clavis stores each trade with 1Click's **signed quote**, so its prices and amounts can't be made up.
3. **Commit.** Each trader's trade log forms a **hash chain** (`h0 = sha256("clavis:v1:" + trader)`, each next hash covers the previous one and the entry). The latest hash is written to the Clavis contract, so history can't be rewritten after keys are sold.
4. **Sell access.** Followers buy a key on-chain. The server only serves a trader's feed to accounts where the contract says `has_access = true`.
5. **Verify.** Key holders recompute the hash chain in their own browser and check it against the contract. The browser reads the contract directly from a NEAR RPC node, not through the Clavis server, and the contract id is fixed in the web build (`VITE_CLAVIS_CONTRACT_ID`), so the server can't point the check at another contract.

**Why `confidentiality: "basic"`:** the 1Click docs list `public`, `basic` and `advanced` and document no difference between `basic` and `advanced`. `basic` is the default the spec asks for. Details and the live API probes are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

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
- **PnL %** = total PnL ÷ peak capital deployed. **Win rate** = profitable closes ÷ all closes. A close is selling a non-stablecoin asset you bought earlier; buying with stablecoins is not a close (otherwise every DCA buy would count as a losing sell), though its fees still count in PnL.

Fees are included automatically because we use what was actually received. Full spec and tests are in `apps/server/src/pnl/` (the exact rules for edge cases are in `docs/DECISIONS.md`).

## Trust model (honest version)

- Clavis's server **sees the trades placed through it**, because it relays the quotes. Traders trust the Clavis operator with their trade details.
- The public chain sees that a trader deposited some amount of token A into 1Click. It does not see what that was swapped into or where it went, **as long as the output is not sent back to the same public account**. If the output lands in the account that paid, anyone looking at that account sees both sides of the trade.
- Clavis **cannot make up quote prices**: each real trade carries 1Click's signed quote. The signature proves 1Click quoted those assets and amounts; it does not prove the swap was executed. Execution status comes from the Clavis server, which polls 1Click, and the "signature valid" check in the Verify panel is run by the server.
- History that is committed can't be changed **silently**. The Clavis server refuses to commit a log whose first N entries don't hash to the head already on-chain. The contract can't check that by itself, and the Verify panel compares with the latest head only, so an operator who changed its own server could rewrite history and commit again. Every earlier head stays visible in the contract's `log_committed` events.
- A 1Click signature covers the quote's assets, amounts, recipient and timestamp. It does **not** cover the confidentiality setting, so "1Click-signed ✓" alone does not prove a swap was confidential.
- Only trades placed **through Clavis** count, so traders can't cherry-pick wins made elsewhere.
- **Roadmap:** run the relay inside a TEE with remote attestation, then switch to **native Confidential Intents view keys** when NEAR ships them. That removes Clavis's operator from the trust path. The code already isolates this behind a `DisclosureAdapter` interface.

## Features

- Public leaderboard with verified PnL, win rate and equity curves
- Locked and unlocked trade feeds, gated by the on-chain key contract
- In-browser hash-chain verification against the NEAR contract, with a tamper test
- Live confidential quotes from the 1Click API, with dry run on by default
- Real mainnet confidential trades with signature verification
- Wallet login with NEP-413 signed messages (NEAR Connect)
- Demo mode: seeded traders and a demo account so anyone can test it

## Networks and addresses

| Item | Value |
|---|---|
| Clavis contract | `clavis-app.testnet` (NEAR **testnet**) |
| Example commit transaction | `TODO: explorer link` |
| Trade execution | NEAR Intents **mainnet**. Intents has no testnet, so real trades used ≤ $2 each from a dev account. |
| Real trader account | `TODO` |

Simulated traders are labeled **SIMULATED** everywhere they appear. Each has a deterministic, seeded 45-day history and a testnet account id under the contract (for example `quiet-whale.clavis-app.testnet`). Their log hashes are on-chain only once those accounts are registered with the contract; "Trades committed" on each card shows how many trades the on-chain hash covers.

## Project structure

```
apps/web         React + Vite frontend
apps/server      Node API: 1Click client, PnL engine, hash chain, committer, demo seed
packages/shared  Hash chain + canonical JSON used by both browser and server
contracts/clavis Rust NEAR contract: keys, access, earnings, log commitments
scripts/         smoke, smoke-quote, seed-chain, export-real-trades
docs/            DECISIONS.md (what we learned and chose), DEPLOYMENTS.md (contract + transactions), SEEDING.md (demo traders on testnet)
```

## Configuration

Copy `.env.example` to `.env`. Everything is optional in demo mode.

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | `true` = seeded traders + demo account |
| `ONECLICK_API_KEY` | 1Click partner key. Optional: without it, dry quotes still work but fall back to PUBLIC (confidential quotes need a key) and carry an extra fee. |
| `CLAVIS_CONTRACT_ID` | Contract to read and commit to |
| `COMMITTER_ACCOUNT_ID` / `COMMITTER_PRIVATE_KEY` | Account allowed to call `commit_log` (keep secret) |
| `NEAR_RPC_URL` | NEAR RPC for the server (defaults to FASTNEAR for the network) |
| `SEED_ACCOUNT_PARENT`, `SEED_ACCOUNT_VERSION` | Testnet accounts of the demo traders (`<handle>[-<version>].<parent>`); see `docs/SEEDING.md` |
| `SESSION_SECRET`, `WEB_ORIGIN` | Session cookie signing key; browser origins allowed to call the API |
| `VITE_API_URL`, `VITE_NETWORK`, `VITE_CLAVIS_CONTRACT_ID` | Frontend settings |

## Limitations

- The server operator can see trades (see Trust model).
- Contract runs on testnet for the hackathon; mainnet deployment is a config change.
- Only trades routed through Clavis are tracked.
- Demo traders are simulated; one trader is real.
- Confidential quotes need a 1Click partner key.

## Built with

NEAR Intents 1Click Swap API (`@defuse-protocol/one-click-sdk-typescript` for types and quote-signature verification) · Confidential Intents · NEAR smart contracts (Rust, `near-sdk` 5.29, `cargo-near`) · NEAR Connect (`@hot-labs/near-connect`) · `near-api-js` (NEP-413 verification) · React 19, Vite, Tailwind CSS 4, Recharts, React Router, Lucide icons · Node, Fastify (`@fastify/cookie`, `@fastify/cors`), zod, SQLite (`better-sqlite3`) · TypeScript, `tsx`, vitest · contract tests: `near-sandbox`, `near-api`, `cargo-near-build`, `tokio`, `testresult`.

AI coding assistants were used during development.

## License

MIT, see `LICENSE`.

## Team

`TODO: name` · X: [@_valeriusx](https://x.com/_valeriusx)
