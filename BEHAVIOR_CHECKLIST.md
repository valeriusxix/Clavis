# Behaviour checklist for the UI polish branch

Recorded 2026-11-11 against `main` at `1de8b11`, dev servers on :5173 (web) and :8787 (API), demo mode, `.env` with a 1Click key and `clavis-app.testnet`.
Every flow below was walked with Playwright (`ui-baseline/report.json`, screenshots in `ui-baseline/`). Re-walk the touched flows after every batch.

## Baseline command results (must still hold after every commit)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm typecheck` | exit 0 (shared, server, web, scripts) |
| `pnpm test` | exit 0: shared 2 files / 11 tests, server 13 files / 88 tests, all passed |
| `pnpm build` | exit 0. Web bundles: index 364.50 kB (116.61 gz), Trader 382.00 kB (111.38 gz), Trade 16.72 kB, build 58.78 kB, css 33.33 kB |
| lint | no lint script and no linter config in the repo: nothing to run |
| Browser console on every page at 375 / 768 / 1440 | 0 errors |

## Flows

Legend: PASS = works at baseline. BROKEN = already broken before this branch (do not "fix" silently, do not get blamed).

### A. Leaderboard `/`
1. Open `/` → hero "Trades stay sealed. PnL stays public.", key cut from the first trader's head hash, caption with the short hash. **PASS**
2. Table lists 6 traders ranked by 30-day PnL: 5 SIMULATED + `real-trader`. Columns at ≥1024: #, Trader, 30-day PnL, Total PnL, Win rate, Trades committed (with mini key), Key price. Below 1024 each row stacks: name + style, PnL, "win · trades", mini key, price. **PASS**
3. Hover or keyboard-focus a row → the hero key recuts to that trader's hash (320 ms tween, none under reduced motion). **PASS**
4. Click a row → `/trader/<id>`. **PASS**
5. API unreachable → red line under the header "Cannot reach the Clavis API (…)" and "Could not load traders: …" in the table slot. **PASS**
6. Slow API → "Loading" spinner in the table slot, hero key shows "uncut". **PASS**

### B. Trader profile `/trader/:id` (locked)
1. Shows name, SIMULATED badge when simulated, style line, account id, 30-day PnL, equity curve (area chart, tooltip on hover), key panel with price "/ 30 days" and **Buy key**, stats (Total PnL, PnL % all time, Win rate, Peak capital, Trades committed), blurred locked feed "N trades hidden" with a second **Buy key**. **PASS**
2. `real-trader`: 3/3 committed, equity curve is a single point (only one day of history). **PASS** (looks odd, but it is real data)
3. **Already BROKEN at baseline:** `real-trader` and any trader with a long style line overflows horizontally at 375–430 px (page width 525 px, `Trader.tsx:84`). Fixing this is in scope (presentation only).
4. Unknown id → ErrorNote with the API message. **PASS**
5. Back link "← Leaderboard" → `/`. **PASS**

### C. Buy a key
1. Click either **Buy key** → modal "Buy key", trader name, key image, price, two options: **Use demo account** (demo mode only) and **Connect wallet**; Cancel and × close it; Escape closes; focus lands in the dialog, Tab is trapped, focus returns to the opener on close. **PASS**
2. **Use demo account** → server creates/uses this browser's demo account, `POST /api/demo/buy-key`, modal closes, green banner "Demo account — key purchase simulated", header shows `demo-… (demo)`, **Reset demo** and a log-out icon; feed unlocks. **PASS**
3. **Connect wallet** → opens the NEAR Connector wallet picker (Meteor, Intear, Ledger, Nightly, NEAR CLI). Not exercised past the picker (no wallet in the audit environment). **NOT VERIFIED, unchanged code path**
4. Wallet purchase banner text "Key bought on-chain (tx …). Access is checked against the contract." **NOT VERIFIED, unchanged code path**

### D. Unlocked feed
1. Feed table (≥1024: Entry, Time, Side, Sent → Received, USD value, Status; below: stacked rows). Simulated rows show SIMULATED; real rows show a status badge (SUCCESS / PENDING_DEPOSIT / …) and "1Click-signed ✓" when the signature verified. **PASS**
2. `real-trader` feed lists 3 SUCCESS trades (#1–#3) and 8 PENDING_DEPOSIT quote rows with "#—". These are abandoned quotes the API returns; they are real data, not a UI bug. **PASS (data as served)**
3. Key panel reads "You hold this key · Every trade below is unlocked. My Keys". Own profile reads "Your trader profile". **PASS**
4. Empty unlocked feed → "No trades yet. Dry quotes you simulate on the Trade page appear here." **PASS** (fresh demo account's own profile before any simulate)

### E. Verify log
1. **Verify log** toggles the panel; it auto-runs: downloads the log, recomputes the hash chain with Web Crypto, reads `get_commitment` from NEAR testnet RPC, checks 1Click signatures. Green frame + title "Verified: this log matches its on-chain commitment", lock/key fit figure, 5 checklist lines, links to the contract and the registration/commit transaction. **PASS** (quiet-whale, 28/28)
2. **Tamper test** → edits one entry in the downloaded copy, red frame, title "Verification failed (tamper test)", red overlap in the fit figure, two failed lines. **Undo tamper test** restores green. **PASS**
3. **Re-verify** → asks the server to re-check signatures and re-runs. **PASS** (no real trades for quiet-whale, so the line stays "no 1Click signatures to check")
4. No contract / RPC error / uncommitted trader → neutral grey panel with "skipped" lines. **NOT RE-VERIFIED this session** (verified in AUDIT.md on 2026-11-04; code unchanged)

### F. Trade `/trade`
1. Loads live token list from `/api/tokens` (source "live"); From defaults to NEAR (wNEAR), To defaults to USDC on NEAR, amount 1, Dry run ON. **PASS**
2. Invalid amount (`abc`, `0`) → red input border, **Get confidential quote** disabled. **PASS**
3. **Get confidential quote** → logs the demo account in if needed, `POST /api/trades/quote` dry → card "Dry quote from the NEAR Intents 1Click API", badge `confidentiality: basic`, "You receive X USDC", "You send 1 wNEAR ($…)", estimated time, "signed by 1Click", correlation id, footer "Dry run: no deposit address…". **PASS** (live quote, 3.73 USDC at the time)
4. **Simulate fill** → `POST /api/trades/:id/simulate` → "Trade #N recorded SIMULATED" + "View in your trader profile →" which opens the demo account's own profile with the trade listed. **PASS**
5. Dry run switch OFF → "Turn off dry run?" red dialog with **Connect mainnet wallet**, **Keep dry run**, **I understand, use real mode** (disabled until a linked mainnet wallet is connected). Keep dry run / Escape closes and leaves dry run ON. **PASS**
6. Real mode quote, deposit with wallet, status polling (KNOWN_DEPOSIT_TX → PROCESSING → SUCCESS), "Send real funds?" dialog. **NOT VERIFIED (operator-only, real funds)**. Code path must stay untouched.
7. Token API unreachable → "Token list from cache…" note. **NOT RE-VERIFIED (code unchanged)**

### G. My Keys `/keys`
1. Logged out → uncut key card "Log in to see your keys…" + **Use demo account**. **PASS**
2. Logged in as demo with keys → card per key: key image (cut from the trader's head hash, grey when expired), trader name, "until <date>". Card links to the trader. Both cards currently show SIMULATED because the demo purchase is simulated (`Keys.tsx:89` uses the key's `simulated` flag, so `real-trader` also reads SIMULATED). **PASS as coded; label is misleading and is in scope to fix (presentation only: badge condition)**
3. Logged in with no keys → uncut key card "No keys yet. Open a trader on the Leaderboard and click Buy key." **PASS** (after Reset demo)
4. Wallet session → keys read from the contract via `get_access` per trader. **NOT VERIFIED (no wallet)**

### H. How it works `/how-it-works`
1. Intro, key cut from the first trader's hash, 5 numbered steps, PnL rules, trust model, demo-mode note. **PASS**

### I. Header, session, footer
1. **Connect wallet** → "Connecting…" then the NEAR Connector picker; Escape closes it and the button returns to "Connect wallet". **PASS**
2. Demo session: account chip (≥1024 only), **Reset demo** (deletes demo keys and trades, reloads), log-out icon (ends the session, feed relocks). **PASS**
3. Footer: network sentence and a link to the contract on the testnet explorer. **PASS**
4. Nav: 4 links, active one underlined green; at <768 the nav drops to its own row under the logo and scrolls horizontally if needed. **PASS**

### J. Global
1. Unknown route → "Page not found. Leaderboard". **PASS**
2. `prefers-reduced-motion: reduce` → no page entry animation, no dot-grid intro or pointer physics, no key recut tween. **PASS**
3. Keyboard: Tab order logo → nav → Connect wallet → rows; 2 px green focus ring everywhere; Enter on a row opens it. **PASS**
4. No horizontal scroll at 375 / 768 / 1440 on `/`, quiet-whale, `/trade`, `/keys`, `/how-it-works`. **PASS**. Exception: B3 above.
5. Dialog stacking: the Buy key dialog is a plain fixed layer (not `<dialog>`) so the wallet popup can sit above it. Keep it that way.

## Selectors and strings that code depends on (do not rename)

- `ui.tsx` dialog focus trap queries `a[href], button:not(:disabled), input, select` inside the panel: keep interactive elements as those tags.
- `.rise` (index.css reduced-motion rule), `.dot-grid`, `.dot-grid__canvas` (DotGrid.css).
- `aria-label="Amount"` on the Trade amount input, `role="switch"` on Dry run, `aria-live` on the Verify panel, `role="dialog"` with `aria-labelledby` ids `buykey-title`, `real-title`, `send-title`.
- The word **SIMULATED** must stay on every simulated trader, key and trade (AGENT.md hard rule 9).
- README judge path depends on these visible strings: "Buy key", "Use demo account", "Demo account — key purchase simulated", "Verify log", "Tamper test", "1Click-signed ✓", "Get confidential quote", "Simulate fill", "View in your trader profile →", "Reset demo", "Dry run".
- `scripts/smoke.ts` and server tests hit the API only; no DOM selectors anywhere in the repo.

## Re-walk on `ui-polish` at `4707dfd` (2026-11-11, 13 commits)

Same Playwright walk as the baseline (`ui-after/report.json`, screenshots in `ui-after/`). Every PASS above is still PASS; the NOT VERIFIED wallet and real-funds paths were not touched (no diff outside `apps/web/src`).

| Check | Baseline | After |
|---|---|---|
| `pnpm typecheck` | exit 0 | exit 0 |
| `pnpm test` | 99 passed | 99 passed |
| `pnpm build` | exit 0, index 116.61 kB gz, Trader 111.38 kB gz, css 7.30 kB gz | exit 0, index 117.10 kB gz, Trader 112.11 kB gz, css 7.74 kB gz |
| Console errors, all pages, 375 / 768 / 1440 | 0 | 0 |
| Horizontal overflow | real-trader profile 150 px at 375 (B3) | none on any page at any width |
| Tap targets under 44 px tall at 375 | Connect wallet, Buy key, Verify log, Reset demo, Log out, Dry run switch, footer link, back link | only inline links inside sentences: "My Keys" in the key panel (18 px) and the two links in the Verify panel text (16 px). Correction: an earlier version of this row said "My Keys" was 44 px; it is 18 px. Enlarging inline links was tried and reverted, because at 375 px the Verify links sit on adjacent lines and the enlarged areas overlapped, sending a tap to the wrong link. WCAG 2.5.8 exempts inline links in running text. |
| Flows A–J | as listed | A1–A6, B1–B5 (B3 fixed), C1–C2, D1–D4, E1–E3, F1–F5, G1–G3 (G2 label fixed), H1, I1–I4, J1–J4 all PASS |
| Keyboard: focus ring on first 9 tab stops, dialog trap, Escape restores opener | PASS | PASS |
| `prefers-reduced-motion` | PASS | PASS (entry animation off, dot-grid still, key tween skipped) |

Already-broken items from the baseline that are now fixed on purpose: B3 (overflow), G2 (misleading SIMULATED on a demo key).

Rendered-text changes a reader of the README might notice: the leaderboard subtitle, the key caption (now a link), the purchase banner gains a "Next: Verify log…" sentence after the unchanged "Demo account — key purchase simulated", the My Keys badge reads "SIMULATED purchase", the 404 page, and the empty quote card. No README step string was changed.

## Re-walk on `ui-polish` at `ac53ec7` (2026-11-11, 15 commits, pushed)

Two more commits after `4707dfd`, made after the user said "proceed" on the items the presentation-only rule had blocked:

- `6624eee` copy a trade (adds a URL-prefill path to `/trade`; additive, existing behaviour unchanged)
- `ac53ec7` Newsreader weight-only font file (132 kB to 58 kB latin, no new dependency)

| Check | Result on `ac53ec7` |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm typecheck` | exit 0 (one earlier attempt failed on a missing server package under OneDrive sync; immediate retry passed, server untouched) |
| `pnpm test` | 99 passed on four runs. One run straight after `pnpm install` failed 4 server tests; it did not repeat. The branch changes only `apps/web/src`, which server tests do not import. |
| `pnpm build` | exit 0. index 117.40 kB gz, Trader 112.46 kB gz, css 7.73 kB gz, Newsreader latin 58.08 kB (was 132.00 kB) |
| `pnpm smoke` | SMOKE PASSED. One earlier attempt got HTTP 502 "1Click API is unreachable"; the retry passed. |
| Full page-and-flow walk, 375 / 768 / 1440 | 0 console errors, no overflow, verify green at 375 and 1440, keyboard and reduced motion PASS |
| Verify + tamper at 1440 | quiet-whale, zec-maxi, real-trader: green, then red on tamper |
| Copy walk (31 checks, 375 and 1440) | 31/31 on four of five runs. One run failed three token-list-dependent steps at 1440 during the same period as the 1Click and NEAR RPC blips; two re-runs with API-failure logging showed no failed requests and passed. |

Copy walk checks: `/trade` with no parameters keeps wNEAR → USDC, amount 1, dry run ON and no notice; no Copy on locked feeds, folded unsettled quotes or your own profile; Copy only where both tokens are on NEAR (real-trader 3, scalp-sensei 14, none for quiet-whale); prefill keeps amount 1 and dry run ON; the user can change the pair afterwards; a dry quote works from the copied pair; an unusable pair falls back to the defaults with a notice; 44 px Copy target at 375; no console errors.

Already broken before this branch, found while building Copy and left unchanged: in dry run the Trade page offers BTC, ETH, SOL and ZEC as destinations, but 1Click rejects those dry quotes with "recipient is not valid" because the server sends a NEAR account as the recipient (`apps/server/src/routes/trades.ts:85`).

## Follow-up `e96f9c0` (pushed)

One muted line under unlocked feeds whose settled trades include some with no Copy link (quiet-whale: "None of these trades can be copied yet…"; scalp-sensei: "Copy appears on trades between NEAR tokens…"; real-trader: no line). Typecheck 0, 99 tests passed, build 0, copy walk 37/37 at 375 and 1440, 0 console errors and no overflow at 375 / 768 / 1440.
