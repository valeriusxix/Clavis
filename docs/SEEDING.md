# Seeding the demo on testnet

"Verify log" turns green only when a trader's log hash is committed in the Clavis contract. The five
SIMULATED demo traders (`quiet-whale`, `zec-maxi`, `scalp-sensei`, `degen-dora`, `steady-eddie`)
must first exist as testnet accounts registered with the contract. `pnpm seed:chain` does that once.
After that, the running Clavis server commits each trader's hash by itself.

Testnet only: the script refuses to run unless `NETWORK=testnet` and every account ends in
`.testnet`. It uses free testnet NEAR, about 0.05 NEAR in total.

## What you need

- The full-access key of the parent account `clavis-app.testnet` (from your `.secrets/` folder).
- The committer key (`clavis-committer.testnet`), already used for `COMMITTER_PRIVATE_KEY`.

## Steps

1. Put these lines in `.env` (the file is gitignored; never commit it):

   ```bash
   NETWORK=testnet
   CLAVIS_CONTRACT_ID=clavis-app.testnet
   VITE_CLAVIS_CONTRACT_ID=clavis-app.testnet
   COMMITTER_ACCOUNT_ID=clavis-committer.testnet
   COMMITTER_PRIVATE_KEY=ed25519:...           # the committer's key
   SEED_PARENT_PRIVATE_KEY=ed25519:...         # clavis-app.testnet's full-access key
   ```

   Instead of `SEED_PARENT_PRIVATE_KEY` you can pass a near-cli key file:
   `--parent-key-file .secrets/clavis-app.testnet.json`.

2. See what it will do. Nothing is sent:

   ```bash
   pnpm seed:chain --dry-run
   ```

   It lists the five accounts, the action for each (`create + fund + register`, `register only` or
   `skip`), and the total testnet NEAR it will send from `clavis-app.testnet`.

3. Do it:

   ```bash
   pnpm seed:chain
   ```

   For each account it prints `created …` and `registered …` with transaction ids, then a table of
   accounts with explorer links. New accounts' keys are saved in `.secrets/seed-accounts/` (never
   printed). Account names and registration transactions are saved to
   `apps/server/src/demo/seed-chain.json`. The Verify panel uses that file for its links.

   If it stops halfway, run it again: accounts that are already registered are skipped.

4. Start the server with the committer key set:

   ```bash
   pnpm dev
   ```

   Within about a minute the server log shows `committed head` once for each demo trader.

5. Check it: open http://localhost:5173, click `quiet-whale`, then "Buy key" → "Use demo account" →
   "Verify log". The panel is green and links to the contract and the registration transaction.

6. Commit the public account list (it holds account names and transaction ids, no keys):

   ```bash
   git add apps/server/src/demo/seed-chain.json
   git commit -m "chore: demo traders registered on testnet"
   ```

7. On the hosted server, set the same `CLAVIS_CONTRACT_ID`, `VITE_CLAVIS_CONTRACT_ID`,
   `COMMITTER_ACCOUNT_ID` and `COMMITTER_PRIVATE_KEY` (and `SEED_ACCOUNT_VERSION` if you used one).
   The hosted server does not need `SEED_PARENT_PRIVATE_KEY`.

## Until 2026-11-11

The demo history reveals one trade at a time until 2026-11-11T00:00Z. Each time a new trade
appears, the running server commits the longer log, so "Trades committed" keeps up as long as the
server runs with the committer key.

## Starting over with fresh accounts

The contract only accepts a higher `trade_count`, and the server refuses to commit a log that does
not extend the hash already on-chain. If the seeded data ever changes, the old accounts cannot be
fixed. Create a new set instead:

```bash
pnpm seed:chain --dry-run --version v2
pnpm seed:chain --version v2
```

That creates `quiet-whale-v2.clavis-app.testnet` and the other four. Then set
`SEED_ACCOUNT_VERSION=v2` in `.env` and on the hosted server, so the app uses the new accounts.
The display names stay the same (`quiet-whale`, …).
