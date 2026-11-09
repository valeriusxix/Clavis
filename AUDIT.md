# Clavis: independent pre-submission audit

- **Commit audited:** `3da3064` (`origin/main`, 2026-11-02 17:06 UTC). Audit date: 2026-11-02.
- **Environment:** Windows 11 Pro, Node 26.13.0, pnpm 10.28.0 (via `npx pnpm@10.28.0`), Rust 1.93.0 (from `rust-toolchain.toml`), headless Chromium 145 via Playwright.
- **Copies used:**
  - **unmodified**: a fresh `git clone https://github.com/valeriusxix/Clavis`, with `.env` copied from `.env.example` and no keys.
  - **install-fixed**: the same clone, with only `- better-sqlite3` removed from `pnpm-workspace.yaml` (see C1). It was needed to get past the install failure. Every result below says which copy it came from.
- **Scratch tests:** extra checks ran as a scratch test file (`__audit__.test.ts`) inside the temp copy, and Playwright scripts ran outside it. Nothing in this repo was modified except this file.

## Fix status (2026-11-02, local branch `audit-fixes`, 27 commits, not pushed; `main` unchanged)

| ID | Status |
|---|---|
| C1 | **FIXED** (`7eaec70`) |
| C2 | **FIXED** for `pnpm smoke`, the library list, the team line and the example commit tx (`7980d38`, `dac937d`, `4d4025d`, `97f5e07`); **NEEDS YOU** for the hosted URL and the real trader |
| C3 | **FIXED**: `pnpm seed:chain` ran on 2026-11-04 (`b4dd72a`, `7e4a89b`); all 5 demo traders are registered and committed, and Verify is green for each (also on a simulated Render deploy) |
| C4 | **FIXED** wording (`e2b9f72`, `3a56e70`: the README now says today's real trades are visible on-chain) and Trade-page warning (`4d97986`); **NEEDS YOU** for the routing change (dry test needs your 1Click key) |
| H1 | **FIXED** (`b8a854b`) |
| H2 | **FIXED** (`93e5867`) |
| H3 | **FIXED** (`14178f2`); the hosted build must set `VITE_CLAVIS_CONTRACT_ID` |
| H4 | **FIXED** (`99741f4`, wording) |
| H5 | **FIXED** (`c294492`, `dfaf2f9`, with your two conditions). No real-trades file exists yet; `pnpm export:real` prints the accounts when you run it |
| M1 | **FIXED** (`3342cb3`) |
| M2 | **FIXED** (`2083f36`, committer check + wording) |
| M3 | **NEEDS YOU**: code done (`506d4a0`, README note `b948eca`); check it on the hosted demo |
| M4 | **FIXED** (`6d1ca6f`, documented: Windows still needs WSL) |
| L1 | **FIXED** (`1d36679`) |
| L2 | **FIXED** (`8392c8f`) |
| L3 | **FIXED** (`5c34ae3`) |
| L4 | **FIXED** (`dfc9d96`) |
| L5 | **FIXED** (`aa54f53`) |
| L6 | **NEEDS YOU** (contract change + redeploy) |
| L7 | **FIXED** (`f41179a`) |
| L8 | **FIXED** (`69d86f1`) |
| L9 | **NEEDS YOU** (1Click key on the hosted server) |

COULD NOT REPRODUCE: none. Each fix was reproduced first, mostly by a regression test that failed before the change.

**Re-check from a fresh clone of `audit-fixes`, empty `.env` (Windows 11, Node 26.13.0, pnpm 10.28.0):**
- `pnpm install` → exit 0, no build step (C1 fixed). `pnpm dev` → web on 5173, API on 8787, "5 SIMULATED traders, 164 trades, 0 real trades".
- `pnpm test` → 97 passed (shared 11, server 86). `pnpm smoke` → **SMOKE PASSED** (against the running server, and standalone).
- `cargo test` → still fails to build on this Windows machine (linker/NASM; see M4). The contract source is unchanged since the audit, so the 49/49 unit-test result stands.
- README walk in Chromium, at 1280px and 375px: steps 1, 2, 3, 4b (tamper → red), 6 and 7 **PASS**. Step 4 is neutral ("on-chain check skipped"), not green, until C3 is done. Step 5 is a `TODO` until real trades exist. Per-visitor demo ids differ across browsers, survive a refresh, and change on "Reset demo" (keys gone). Demo ids are never on the leaderboard. 5,000,000 NEAR shows "1Click could not quote this trade: No liquidity available." No horizontal overflow.
- H3 checked in the browser: with the build pinned to `clavis-app.testnet` and the server reporting `look-alike.testnet`, the Verify panel is red and makes no RPC call to the look-alike.
- New, minor, not in the original audit: the app has no favicon, so the browser logs one 404 for `/favicon.ico`.

The findings below are the original audit text, with a status after each title.

## Verdict

**No, not ready to submit (as of `3da3064`).**

- On a machine without Python and a C++ toolchain, the judge path fails at `pnpm install`. The one-line fix in C1 is verified.
- After that fix, demo steps 1–3, 6 and 7 work.
- Several steps the README promises cannot happen yet:
  - no hosted URL
  - no real trader or real trades
  - no `pnpm smoke`
  - Verify can never turn green, because no trader shown in the app is committed on-chain
  - no LICENSE file
- Real mode sends each trade's output back to the account that made the deposit. That makes the "public chain sees nothing" claim false for real trades (C4).
- Some integrity claims ("cannot invent trades", "not through the Clavis server") go further than the code supports.
- Most blockers are unfinished Phase 4 and 6 work. The core pieces are sound: the contract, hash chain, PnL engine, 1Click integration and access control.

---

## Findings

### CRITICAL

**C1. `pnpm install` fails without Python and a C++ toolchain, so `pnpm dev` and `pnpm test` fail too** · **FIXED** (`7eaec70`)
- **Where:** `pnpm-workspace.yaml:8`
- **What's wrong:** Listing `better-sqlite3` in `onlyBuiltDependencies` makes pnpm run its implicit `node-gyp rebuild` (the package has `binding.gyp` and no install script). `better-sqlite3@13.0.3` already ships N-API prebuilds (`prebuilds/win32-x64.node`, `linux-x64.node`, …), so the compile step isn't needed.
- **Confirmed (unmodified):**
  - `pnpm install` → `gyp ERR! find Python … not ok` → `ELIFECYCLE Command failed with exit code 1`. No `.bin` links are created.
  - `pnpm dev` → `'tsx' is not recognized` → exit 1.
  - `pnpm test` → `'vitest' is not recognized` → exit 1.
- **Confirmed (install-fixed):** `pnpm install` exits 0 (`Ignored build scripts: better-sqlite3`), the prebuild loads (`sqlite_version 3.53.4`), and dev and test run.
- **Fix:** delete line 8. Linux/macOS behaviour with python3, make and g++ present is UNVERIFIED.

**C2. README steps that can't be followed** · **FIXED** for `pnpm smoke` and the library list (`7980d38`, `dac937d`); **NEEDS YOU** for the hosted URL, real trader, example commit tx and team name
- **Where:** `README.md:17`, `:25`, `:50`, `:159`
- **What's wrong:**
  - Step A1 is `TODO: hosted URL`. There is no hosted demo.
  - Step 5 is `TODO: real trader id`. No real trader exists:
    - `apps/server/src/demo/real-trades.json` is not in the repo.
    - The server logs `demo seed: 5 SIMULATED traders, 163 trades, 0 real trades`.
    - On-chain, `real-trader.clavis-app.testnet` has `commit_count 0`.
  - `pnpm smoke` (README:50) → `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "smoke" not found`. `package.json` only has `smoke:quote`.
  - `scripts/smoke.ts` and `scripts/seed-chain.ts`, both listed at README:159, do not exist.
- **Fix:** ship the hosted URL, the real trades with their export, and `scripts/smoke.ts` plus a `"smoke"` script. Until they exist, remove those steps.

**C3. "Verify log" can never turn green: no trader shown in the app is committed on-chain** · **FIXED** (`b4dd72a`, `7e4a89b`: seeded and committed on testnet; Verify green)
- **Where:** `README.md:24`, `apps/web/src/pages/Leaderboard.tsx:20-21`, `apps/server/src/chain/committer.ts:53`
- **What's wrong:**
  - Contract `clavis-app.testnet`: `list_traders` returns only `clavis-test-trader.testnet` (count 1, with a test head that isn't a real log) and `real-trader.clavis-app.testnet` (count 0).
  - `get_commitment("quiet-whale.clavis-app.testnet")` returns `null`. There is no `seed:chain` script to register the seeded traders.
  - The Leaderboard says "Every trader's log is hash-chained and committed on NEAR", but every card shows "Trades committed 0/N".
- **Confirmed (install-fixed, Playwright):**
  - With no contract: the panel is grey, titled "Log verified locally", with "On-chain check skipped (no contract configured)".
  - With `CLAVIS_CONTRACT_ID=clavis-app.testnet`: "On-chain check skipped: this trader has no record in the contract yet." There is no transaction link.
- **Consequence: Verify cannot catch operator edits yet.**
  - Scratch test: change `amount_out_usd` on one quiet-whale row in the DB, then `refreshChainHead`. On every boot, `seedDb.ts` runs `refreshChainHead` for every trader.
  - The published head moves from `a84b98…` to `e66c2f…`, and the browser's recompute of `/log` matches the new head. So Verify step 2 passes, and with no on-chain commitment nothing turns red.
  - The "Tamper test" button only edits the browser's downloaded copy, so it shows the browser hashes correctly, not that edits by the operator are caught.
- **Fix:** create and register the seeded subaccounts, commit their heads, and configure the contract on the hosted demo. Reword the Leaderboard subtitle until then.

**C4. Real mode links each trade's deposit and output on the public chain** · **FIXED** wording (`e2b9f72`) and Trade-page warning (`4d97986`); **NEEDS YOU** for the routing change (dry test needs your 1Click key)
- **Where:** `apps/server/src/routes/trades.ts:69` and `:71` set `recipient` and `refundTo` to `session.payer`. The comment at `:50-51` says the output "goes back to the same mainnet account".
- **What's wrong:**
  - Every real trade is one mainnet account sending wNEAR to a 1Click deposit address, then the same account receiving USDC about 20 s later.
  - Anyone looking at that account on an explorer can see both legs of every trade. Unlinking deposits from withdrawals doesn't help when both happen in the same account.
  - This contradicts:
    - README:76: "The public chain: Nothing about what was traded"
    - `HowItWorks.tsx:33`: "deposits and withdrawals cannot be linked on the public chain"
    - `HowItWorks.tsx:69`: "cannot link what a trader bought"
    - The Leaderboard subtitle: "Their trades are hidden and run through NEAR Confidential Intents"
- **Severity:** CRITICAL under this audit's rule that a false claim at the core of the pitch is critical. Unlike H4 (overstated), this claim is false for the product's own real-trade path. It is partly inherited from AGENT.md §6.2, which sets `refundTo` to the trader's account.
- **Confirmed:** code reading only. No real trade exists to inspect on-chain.
- **Fix:** send the output to a separate recipient, or keep it in an Intents balance (`recipientType: CONFIDENTIAL_INTENTS`, per the "Confidential Swaps" doc). Otherwise, state the linkage in the trust model and remove the "nothing about what was traded" wording.

### HIGH

**H1. No LICENSE file** · **FIXED** (`b8a854b`)
- **Where:** `README.md:192` ("MIT, see `LICENSE`"); `package.json` says `"license": "MIT"`.
- **What's wrong:** HACKATHON.md Q-014 says to add a LICENSE file. No LICENSE exists in the tree or anywhere in git history.
- **Fix:** add the MIT text as `LICENSE`.

**H2. Simulated trading shows on the public leaderboard without the SIMULATED label** · **FIXED** (`93e5867`)
- **Where:**
  - `apps/server/src/routes/trades.ts:98-108` creates the trader with `is_simulated = session.kind === "demo"`.
  - `trades.ts:175-193`: "simulate" has no `DEMO_MODE` or session-kind gate.
  - `pnl/stats.ts:120` reads `simulated` from that trader row.
- **What's wrong:** Wallet login (NEP-413) is always enabled (`index.ts`), so any testnet wallet can dry-quote and then "Simulate fill". Its trader row gets `is_simulated=0`, so `/api/traders` lists it unlabeled, with PnL built only from simulated fills. This also happens with `DEMO_MODE=false`. It breaks AGENT.md hard rule 9 and the "verified PnL" premise: paper trades at live prices can be cherry-picked.
- **Confirmed (scratch test; only the signature check was stubbed, server rules unchanged):** log in as `bob.testnet` → dry quote → simulate → `/api/traders` returns `{"id":"bob.testnet","simulated":false,"tradeCount":1,…}`. The result is the same with `DEMO_MODE=true` and `DEMO_MODE=false` (quote 200, simulate 200).
- **Fix:** in simulate, mark the trader `is_simulated=1`, or allow it only for `session.kind==="demo"`. Derive `simulated` from "the log contains any SIMULATED entry".

**H3. The server chooses which contract the browser verifies against** · **FIXED** (`14178f2`); the hosted build must set `VITE_CLAVIS_CONTRACT_ID`
- **Where:** `apps/server/src/routes/traders.ts:86`, `apps/web/src/components/VerifyPanel.tsx:53-57`
- **What's wrong:**
  - `VITE_CLAVIS_CONTRACT_ID` is in `.env.example` but never read. The only `import.meta.env` uses are `VITE_API_URL`, `VITE_NEAR_RPC_URL` and `VITE_NETWORK`.
  - The contract id comes from `/api/traders/:id/log`. A dishonest server can return `null` (the panel goes neutral "skipped", not red) or point to a look-alike contract it controls (the panel goes green).
  - So README:99 and the VerifyPanel comment ("does not depend on trusting the Clavis server") overstate it. The RPC read itself does come straight from the browser: Playwright logged `POST https://test.rpc.fastnear.com … get_commitment` from the page.
- **Fix:** take the contract id from `import.meta.env.VITE_CLAVIS_CONTRACT_ID`. Fail red when the server's id differs, or when a configured contract has no record for a log with entries.

**H4. "Clavis cannot invent trades" goes further than the code supports** · **FIXED** (`99741f4`, wording)
- **Where:** `README.md:96`, `:124`; `apps/web/src/pages/HowItWorks.tsx:36`, `:74`; `VerifyPanel.tsx:122`; `jobs/statusPoller.ts:50-72`
- **What's wrong:**
  - The browser never receives the signed quote. `LogEntry` carries only `quoteSignature` and `correlationId`, and the "signature valid" step just displays a server-sent boolean (`signatureValid`).
  - A valid signature proves 1Click *quoted* those numbers. It does not prove the swap was executed. SUCCESS is set by the server's status poll, and `settle()` replaces the amounts with `swapDetails` from the status response, which nobody verifies.
  - So an operator can record a signed, never-funded non-dry quote as SUCCESS.
- **Severity:** filed HIGH rather than CRITICAL because the claim is overstated, not false.
- **Fix:**
  - Reword to "cannot fabricate quote prices; execution status is reported by the Clavis server".
  - Include the raw signed quote and deposit tx in `/log`, so the browser verifies with the SDK and checks `dry === false`.
  - Verify status signatures too: the 1Click doc says status payloads are signed.

**H5. The planned real-trade export would publish the "hidden" real trades and link them to the mainnet account** · **FIXED** (`c294492`, with your two conditions)
- **Where:** `scripts/export-real-trades.ts:18-27`, `apps/server/src/index.ts:43`
- **What's wrong:**
  - `SELECT *` exports `quote_json` (where `quoteRequest.recipient` and `refundTo` are the mainnet account), `status_json`, `tx_hash` (the mainnet deposit), `deposit_address` and `payer`.
  - The trader's `style` field reads "real mainnet trades by <mainnet account>".
  - Once committed to the public repo (as AGENT.md §10.1 instructs), anyone can read every real trade without a key and match each deposit to its output. That contradicts README:76 ("The public chain: Nothing about what was traded") and the key-gating idea.
- **Status:** not realized yet, because the file doesn't exist. Flagged ahead of time.
- **Fix:** export only the `LogEntry` fields plus what verification needs. Drop recipient, refundTo, `tx_hash`, `deposit_address`, `payer` and `status_json`, or disclose the linkage in the README.

### MEDIUM

**M1. Unquotable amounts show "Internal server error" (HTTP 500)** · **FIXED** (`3342cb3`)
- **Where:**
  - `trades.ts:86`: the no-key PUBLIC fallback call isn't wrapped like the first call.
  - `trades.ts:68`: `toBaseUnits` throws a plain `Error`.
- **Confirmed (install-fixed, live):**
  - Trade page with 5,000,000 NEAR → the UI shows "Internal server error". The server log shows 1Click `HTTP 400 "No liquidity available"`.
  - Amount `0` → 1Click "Amount is too low" → 500.
  - 25 decimals → 500.
- **Fix:** map 1Click errors from the fallback call to 400/502 with 1Click's message, and map `toBaseUnits` errors to 400.

**M2. "Cannot rewrite history" only holds against the latest commitment** · **FIXED** (`2083f36`, committer check + wording)
- **Where:**
  - `chain/committer.ts:53-66` commits a larger count without checking that `serverChain(log)[onChainCount] === onChain.head_hash`.
  - `contracts/clavis/src/lib.rs:335-369` accepts any head with a larger count.
  - `VerifyPanel.tsx:77` compares only against the current head.
- **What's wrong:** the operator can edit entry k and commit a head for n+1, and Verify still turns green. Earlier heads survive only in `log_committed` events, which nothing checks.
- **Fix:** add that prefix check to the committer, and have the Verify panel check earlier `log_committed` heads as prefixes. Otherwise, qualify the claim in the README.

**M3. Demo mode: every visitor shares one identity, and a demo key unlocks any trader, including the real one** · **NEEDS YOU**: code done (`506d4a0`, `b948eca`); check it on the hosted demo
- **Where:** `routes/auth.ts:58` (`sub: DEMO_VIEWER`), `routes/keys.ts:9-21`
- **What's wrong:**
  - On a hosted demo, judges share keys, simulated trades and "your trader profile". I saw this across two separate browser contexts: `/keys` showed quiet-whale "until Jan 31, 2027", extended twice.
  - `buy-key` accepts any trader id, so the real trader's feed is free to everyone.
- **Fix:** give each browser its own demo id (for example `demo-<random>`). Limit demo `buy-key` to `is_simulated` traders, or disclose this.

**M4. `cargo test` fails on Windows as shipped** · **FIXED** (`6d1ca6f`, documented: Windows still needs WSL)
- **Where:** `contracts/clavis/Cargo.toml` dev-dependencies (`near-sandbox`, `near-api`, `cargo-near-build`)
- **Confirmed:**
  - From Git Bash: `could not exec the linker link.exe` (an environment issue).
  - From PowerShell: `aws-lc-sys: NASM command not found`.
  - With `AWS_LC_SYS_PREBUILT_NASM=1`: `openssl-src: failed to build OpenSSL from source` (needs perl).
- **Unit tests:** 49/49 pass in a copy whose dev-deps were reduced to `near-sdk` (`unit-testing`), with `src/` unchanged and `AWS_LC_SYS_PREBUILT_NASM=1`. The sandbox test was not run (UNVERIFIED).
- **Fix:** document "contract tests: Linux/macOS/WSL", or put the sandbox test behind a cargo feature.

### LOW

**L1. INCOMPLETE_DEPOSIT is treated as final** · **FIXED** (`1d36679`)
- **Where:** `db/db.ts:61`, `:164-169`; `Trade.tsx:369-371`
- **What's wrong:** polling stops at INCOMPLETE_DEPOSIT, so a later REFUNDED (or SUCCESS after a top-up) is never recorded. The UI says "1Click returns the deposit".
- **Fix:** keep polling until the deadline.

**L2. With `DEMO_MODE=false`, leftover demo access still unlocks feeds** · **FIXED** (`8392c8f`)
- **Where:** `disclosure/adapter.ts:39`
- **What's wrong:** demo access is honoured without checking demo mode, and `demo_access` is only cleared while seeding in demo mode (`seedDb.ts:75`).
- **Confirmed (scratch test):** a DB from a demo run, the same `SESSION_SECRET`, and an old demo cookie → `/feed` returns 200.
- **Fix:** ignore `demo_access` unless `DEMO_MODE` is on.

**L3. The API marks SIMULATED rows as signed** · **FIXED** (`5c34ae3`)
- **Where:** `trades.ts:132`, `:183-190`
- **What's wrong:** `oneClickSigned: true` stays on SIMULATED rows in the API. The UI hides the badge (`TradeRow.tsx:31`).
- **Fix:** set `signature_valid` to null on simulate.

**L4. A cap-rejected quote shows as a FAILED trade** · **FIXED** (`dfc9d96`)
- **Where:** `trades.ts:139-140`
- **What's wrong:** an OVER_CAP quote is persisted as FAILED, so it appears in the real trader's feed although nothing was sent.
- **Fix:** don't persist it, or exclude it from the feed.

**L5. Explorer links open a chooser page, not the transaction** · **FIXED** (`aa54f53`)
- **Where:** `apps/web/src/lib/near.ts:16-23`, `docs/DEPLOYMENTS.md`
- **What's wrong:** links to `explorer.testnet.near.org/transactions/…` land on the "Near Explorer Selector" page.
- **Fix:** link `testnet.nearblocks.io` directly.

**L6. Contract hardening** · **NEEDS YOU** (contract change + redeploy)
- **Where:** `lib.rs:262` (`withdraw`), `:277` (`withdraw_platform`), `:372` (`set_committer`), `:159-187` (`update_trader`)
- **What's wrong:**
  - The three methods have no `assert_one_yocto`, so function-call access keys can call them. Funds still go only to the caller or the owner.
  - `update_trader` keeps the stake when storage shrinks.
- **Fix:** add `#[payable]` and `assert_one_yocto`, and refund freed storage.

**L7. README win-rate definition differs from the engine** · **FIXED** (`f41179a`)
- **Where:** `README.md:117`, `pnl/engine.ts:100-103`
- **What's wrong:** the README says "Win rate = profitable sells ÷ all sells". The engine counts only closes of non-stablecoin positions that have a cost basis. This is documented in DECISIONS.md, not in the README.
- **Fix:** align the README wording.

**L8. Hosted-demo hygiene** · **FIXED** (`69d86f1`)
- **Where:** `index.ts:87`
- **What's wrong:** the server listens on `0.0.0.0`. There is no rate limit on `/api/trades/quote`, which spends the operator's 1Click key, and QUOTED rows are never purged.
- **Fix:** take the host from env, and add a rate limit.

**L9. Without a key, "Get confidential quote" returns a PUBLIC quote** · **NEEDS YOU** (1Click key on the hosted server)
- **What's wrong:** it is clearly labelled "PUBLIC (not confidential)" and disclosed at README:55. A confidential (`basic`) quote exists only in the saved fixture (`__fixtures__/mainnet-basic-dry-quote.json`: confidentiality `basic`, signature valid).
- **Fix:** none needed in code. Make sure the hosted demo has the key.

### Checked and fine
- **Repo:** public; an anonymous clone works. The first commit (2026-11-01) is inside the hackathon window. AI use is disclosed (README:188), libraries are listed (README:186, apart from its TODO), and networks are disclosed (README:140-147).
- **Secrets:**
  - All 27 commits scanned with regexes (gitleaks and trufflehog were not installed).
  - No `.env` or key file was ever committed.
  - Every `ed25519:` value is a 1Click quote signature or public key in fixtures.
  - No JWTs, Bearer tokens or assigned secrets.
- **Browser bundle:** `vite build` with canary `ONECLICK_API_KEY`, `COMMITTER_PRIVATE_KEY` and `SESSION_SECRET` values. Neither the values nor the variable names appear in `apps/web/dist`.
- **Access to `/feed` and `/log`:**
  - No cookie, an unsigned forged cookie, a bad signature, or another trader's id → 403 `LOCKED`.
  - A demo key expires: 403 at +31 days.
- **NEP-413 login:**
  - Single-use 32-byte nonce with a 5-minute TTL, consumed before verification. A replay → 401.
  - `verifyMessage` (near-api-js 7.4.0) checks that the key has `FullAccess` via `view_access_key`, then verifies the ed25519 signature over the NEP-413-prefixed borsh payload.
- **Real-trade safety:**
  - Dry run is the default.
  - Turning it off needs a dialog and a linked mainnet wallet ("I understand…" stays disabled otherwise).
  - Sending needs a second dialog, and the wallet signs.
  - The server rejects `dry:false` without a wallet session, for non-NEAR tokens, and above $2 (checked before and after the quote).
  - The server never holds trading keys.
- **Contract (§7.2):**
  - Every rule is implemented: committer-only `commit_log`, strictly increasing count, 64-hex head (stored lowercase), expiry `max(now, current) + period`, floored fee with `earning = price − fee` (no NEAR lost or created), excess refunded, balance zeroed before transfer with restore on failure, storage measured before and after and charged, owner-only `set_committer`, private callbacks, `new` is `#[private]`.
  - `overflow-checks = true` and checked arithmetic. `list_traders` is capped at 100.
  - NEP-297 events are well-formed: `{standard, version, event, data:[…]}`.
  - The 49 unit tests cover every rule, including the negative cases. The deployed `code_hash` `7FVPjac…` matches DEPLOYMENTS.md.
- **Hash chain:**
  - One shared implementation (`packages/shared`), with `sha256` injected.
  - Web Crypto and `node:crypto` give byte-identical chains for all seeded logs.
  - Changing one field changes the head; key order doesn't matter.
  - "Tamper test" turns the browser panel red: "Recomputed head does not match the head Clavis publishes".
- **Canonical JSON:** keys sorted recursively (UTF-16 order), no whitespace, ES number formatting, and it throws on `undefined`, `NaN`, `Infinity` and `bigint`.
- **1Click signature:**
  - Uses the SDK's `verifyQuoteSignature`, as the official "Verify Quote Signatures" doc recommends.
  - A real quote fetched during this audit verifies. Tampering with amountOut, timestamp, recipient, the `dry` flag or the signature makes it invalid.
  - `confidentiality` is not in the signed payload, so the README:125 caveat is accurate.
- **1Click API:**
  - All 14 request fields exist in the OpenAPI `QuoteRequest` schema, and all 12 required fields are sent.
  - `confidentiality: "basic"`; `amount` is an integer string built with BigInt.
  - The `deposit/submit` fields match the spec, and all 7 status values are handled. REFUNDED, FAILED and INCOMPLETE_DEPOSIT show in red.
- **Trade page numbers match the API response** (display rounding only):
  - API `amountOutFormatted 3.836256` and `amountOutUsd 3.833954…` → UI "3.8363 USDC $3.83".
  - In `1.0` / `$3.85` → "1 wNEAR ($3.85)".
  - 20s estimate; "signed by 1Click".
- **SIMULATED labels:** seeded traders are labelled on the leaderboard, profile, every feed row, the Verify panel ("22 of 22 entries are SIMULATED") and My Keys. The exception is H2.
- **1Click down (scratch test, network error):** the quote returns 502 "Could not get a quote: the 1Click API is unreachable right now. Please try again in a minute." `/api/tokens` falls back to the cached list (`source: "seed"`, 6 tokens), and the Trade page says "Token list from cache".
- **Contract unset:** the Verify panel shows "On-chain check skipped (no contract configured)" and doesn't crash. "Connect wallet" in Buy key is disabled, with "No contract configured on this server."
- **Mobile (375px):** no horizontal overflow on `/`, `/trader/:id`, `/trade`, `/keys` or `/how-it-works`.
- **Console errors:** none, apart from the 404 for a deliberately requested unknown trader. API responses take about 0.2 s.
- **README trust model:** says the operator sees trades, and treats native view keys as roadmap only. The `DisclosureAdapter` exists. The overstatements are listed in H3 and H4.

### PnL hand checks (`computePnl`, scratch test, all passed)

| Scenario | Trades | Expected by hand | Engine |
|---|---|---|---|
| Winning round trip | 100 USDC→50 NEAR ($99.8); 50 NEAR ($120)→119.7 USDC | realized −0.2+19.9 = **19.7**; capital (peak basis) 119.7; pct 0.16458; win 1/1 | match |
| Losing round trip | 100 USDC→50 NEAR ($99.8); 50 NEAR ($80)→79.8 USDC | realized **−20.2**; capital 99.8; pct −0.2024; win 0/1 | match |
| Partial sells, 2 assets | 100 USDC→50 NEAR; 60 USDC→0.03 ETH; 20 NEAR($50)→0.025 ETH; 0.02 ETH($44)→44 USDC; mark NEAR 2.5, ETH 2200 | realized (50−40)+(44−40) = **14**; NEAR 30 @ 60; ETH 0.035 @ 70; unrealized 15+7 = 22; capital 174; pct 36/174; win 2/2 | match |
| Edge cases | empty trader; USDC→USDT→USDC; zero-qty sale; 30-day rebase | 0 / cap 1 / win null; −0.2, win null; finite; rebased at day −30 mark ($3→$4: +50 on 150) | match |

### What a judge finds confusing in the first 60 seconds
- Every card shows "Trades committed 0/N", right under "Every trader's log is hash-chained and committed on NEAR".
- "Get confidential quote" returns a red "PUBLIC (not confidential)" quote. Without a key that's correct, but it's the opposite of the button label.
- "Verify log" stays grey ("Log verified locally"); the README promises green with a tx link. Step 5's trader id is a `TODO`.

---

## README judge path ("Test it in 3 minutes")

Local `pnpm dev`, followed literally in headless Chromium at 1280px and 375px. Rows 1–7 come from the install-fixed copy, because the unmodified copy never gets past install (row 0).

| # | Step | README says you'll see | Actually seen | Result |
|---|---|---|---|---|
| 0 | `cp .env.example .env && pnpm install && pnpm dev` (Option B) | API and web start, no keys needed | unmodified: install exit 1 (node-gyp needs Python), then `'tsx' is not recognized`. install-fixed: both start; "demo seed: 5 SIMULATED traders, 163 trades, 0 real trades" | **FAIL** (unmodified) / PASS (install-fixed) |
| A1 | Open hosted URL | Leaderboard | `TODO: hosted URL` | **FAIL** |
| 1 | Open `localhost:5173` | Leaderboard ranked by 30-day PnL with total PnL, win rate, trades committed and key price; trades hidden | Exactly that; 5 SIMULATED traders; quiet-whale +27.3%, "Trades committed 0/22", 5 NEAR | PASS |
| 2 | Click `quiet-whale` | Equity curve and a blurred feed: "N trades hidden" | Chart and "22 trades hidden", "Buy key" (desktop and 375px) | PASS |
| 3 | "Buy key" → "Use demo account" | Banner "Demo account — key purchase simulated"; feed unlocks; time, side, amounts, USD, SIMULATED/status badge | Exact banner; 22 rows with time, BUY/SELL #seq, amounts, USD in→out, SIMULATED | PASS |
| 4 | "Verify log" | Green checklist matching the testnet contract, plus a tx link | Grey "Log verified locally", "On-chain check skipped (no contract configured)", no link. With the contract set: "no record in the contract yet" | **FAIL** (C3) |
| 4b | "Tamper test" | Panel turns red | Red: "Recomputed head does not match the head Clavis publishes" | PASS |
| 5 | Open `TODO: real trader id` | Real mainnet trades with "1Click-signed ✓" | Placeholder; no real trader exists | **FAIL** (C2) |
| 6 | "Trade", Dry run ON, NEAR→USDC, `1`, "Get confidential quote" | Live 1Click quote, `basic`, USD amounts, "signed by 1Click" | Live quote: "You receive 3.8363 USDC $3.83", "signed by 1Click", labelled **PUBLIC (not confidential)** because there's no key. The note at README:55 explains this. The selector reads "NEAR (wNEAR)" | PASS (as documented) |
| 7 | "Simulate fill" | Appears in your own profile ("View in your trader profile →"), SIMULATED | Link present; `/trader/demo-viewer` shows the row with SIMULATED | PASS |
| — | `pnpm test` | All pass | unmodified: FAIL (`vitest` not found). install-fixed: 8 + 61 = 69 passed | FAIL / PASS |
| — | `pnpm smoke` | End-to-end check | `Command "smoke" not found` | **FAIL** |
| — | `cargo test` | Contract tests pass | Fails to build on Windows (M4). Unit tests 49/49 pass in a stripped-dev-deps copy; sandbox test not run | FAIL / UNVERIFIED |
| — | `pnpm smoke:quote` (not in README) | — | Real mainnet dry quote; confidential refused (401) without a key → PUBLIC fallback; signature VALID; exit 3 by design | n/a |

## Definition of done (AGENT.md §0)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Leaderboard with PnL, win rate and trade count, trades hidden, no wallet | PASS* | Judge path row 1 (*after the C1 fix) |
| 2 | Buy key → "Use demo account" → feed unlocks | PASS* | Row 3 |
| 3 | Verify turns green against the testnet contract, with a tx link | **FAIL** | C3: no displayed trader is on-chain; no `seed:chain` |
| 4 | Dry confidential (`basic`) quote with USD amounts | UNVERIFIED | Code requests `basic` (`trades.ts:73`). Locally it falls back to PUBLIC without a key. A `basic` fixture exists. No hosted demo or key to test |
| 5 | A real trader with real mainnet confidential trades, "1Click-signed ✓" | **FAIL** | No `real-trades.json`; `real-trader.clavis-app.testnet` has 0 commits |
| 6 | `pnpm install && pnpm dev` with no keys | **FAIL** (Windows, no Python) | C1; works with the one-line fix; Linux UNVERIFIED |
| 7 | Public repo, README from template, X post, submission | **FAIL** | Repo is public. README still has 7 `TODO`s (lines 17, 25, 138, 145, 147, 186, 196). No LICENSE. Post and submission are the human's job |

## UNVERIFIED (and what's needed)

- **Install and dev on Linux/macOS:** run a fresh clone on a Linux box or container, with and without python3 and build tools.
- **Hosted demo:** no URL yet.
- **Live confidential (`basic`) dry quote through the app:** needs `ONECLICK_API_KEY`.
- **Wallet flows:** real NEP-413 login, on-chain `buy_key` → feed unlock via `has_access`, `withdraw`. Needs a testnet wallet with testnet NEAR.
- **Real mode end to end:** deposit, status polling, SUCCESS settlement, final amounts, and `commit_log` by the committer. Needs a mainnet dev account with funds, the committer key, and human approval.
- **C4 seen on-chain:** confirmed from code only. Check the real trader's mainnet account on an explorer after the first real trade.
- **Contract sandbox integration test** (`tests/test_clavis.rs`): needs Linux/macOS (`near-sandbox`).
- **Deployed wasm matches the source:** the on-chain `code_hash` matches DEPLOYMENTS.md. Needs a `cargo near build` of `d30a098` and a hash comparison.
- **Secret scan with gitleaks or trufflehog:** neither is installed; regex scan only.
- **X demo post, submission, and Q-015 (a second project by the same person):** human actions.
