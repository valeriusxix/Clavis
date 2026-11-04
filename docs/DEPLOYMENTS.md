# Deployments

Public facts only. Keys are never committed. Local backups live in the gitignored `.secrets/`
folder, and the committer key is in `.env` as `COMMITTER_PRIVATE_KEY`.

## NEAR testnet: Clavis contract (2026-11-02)

| Item | Value |
|---|---|
| Contract | `clavis-app.testnet` |
| Owner (`withdraw_platform`) | `clavis-owner.testnet` |
| Committer (`commit_log`, server) | `clavis-committer.testnet` |
| Platform fee | 100 bps (1%) |
| Code hash (on-chain = local build) | `7FVPjacGdbLUdpfCXovXhxUdW2h6w71YPGsLAVXfjoZQ` |
| Source | `contracts/clavis` at commit `d30a098` (near-sdk 5.29.1, built with `cargo near build non-reproducible-wasm`) |
| RPC used | `https://test.rpc.fastnear.com` |
| Deploy + `new` tx | [`GCUCzHXorev9c9kPa91sVrB7jpdMFM49KSgrLEvwy9dJ`](https://nearvalidate.org/txns/GCUCzHXorev9c9kPa91sVrB7jpdMFM49KSgrLEvwy9dJ?network=testnet) |

All accounts were created with the testnet faucet (10 testnet NEAR each).

### Acceptance run (Phase 1)

| Step | Signer | Result | Tx |
|---|---|---|---|
| `register_trader("Test Trader", 0.1 NEAR, 30)` | `clavis-test-trader.testnet` | ✅ `trader_registered` | [`AswmxZMF…`](https://nearvalidate.org/txns/AswmxZMF7PRZTLgaq49BvKeKzm5HKSXYm2F2XaPyV7rG?network=testnet) |
| `get_commitment` before any commit | view | ✅ `trade_count "0"`, `head_hash` = h0 = `sha256("clavis:v1:clavis-test-trader.testnet")` = `5f2d015b…bcaa` (matches Python hashlib) | |
| `buy_key` with 0.2 NEAR attached | `clavis-test-buyer.testnet` | ✅ `key_purchased`; `has_access` true; trader credited 0.099, platform 0.001 (1%); excess refunded | [`35AjhmTu…`](https://nearvalidate.org/txns/35AjhmTu51kwCV76kporrCZ1tkp7HPafXpM9atuAeY2A?network=testnet) |
| `commit_log` by a non-committer | trader | ✅ rejected: "Only the committer can call commit_log" | |
| `commit_log(trade_count "1", head 721e9d68…)` | `clavis-committer.testnet` | ✅ `log_committed`. Test value: `sha256("clavis:testnet-acceptance:1")`, not a real trade log | [`59ojPeyE…`](https://nearvalidate.org/txns/59ojPeyERN7eCwD6E4b8gyPFKLCfNrNHMMQ82JT7GSmf?network=testnet) |
| `near view clavis-app.testnet get_commitment` | view | ✅ `{ trade_count "1", head_hash 721e9d68…, last_commit_at … }` | |
| `on_withdraw` called from outside | buyer | ✅ rejected: "Method on_withdraw is private" | |
| `withdraw` | trader | ✅ `withdrawn` 0.099 NEAR; balance now 0 | [`GTr3fSQs…`](https://nearvalidate.org/txns/GTr3fSQsSvUoHRELSz8bixnPgztooVA44MrH7HRUiCRB?network=testnet) |
| `withdraw_platform` by a non-owner | buyer | ✅ rejected: "Only the owner can call this method" | |
| `withdraw_platform` | `clavis-owner.testnet` | ✅ `withdrawn` 0.001 NEAR (source `platform`) | [`3p6P436y…`](https://nearvalidate.org/txns/3p6P436yf9hrtW3z1q9WUErjGn9cNFY9FTHKou3vpST1?network=testnet) |

`clavis-test-trader.testnet` and `clavis-test-buyer.testnet` are test accounts. The test trader is
not one of the seeded demo traders, and its committed head is a test value.

## Real trader identity (Phase 4, 2026-11-02)

| Item | Value |
|---|---|
| Real trader (testnet identity on the leaderboard) | `real-trader.clavis-app.testnet` (subaccount of the contract account, 0.5 testnet NEAR) |
| Create account tx | [`FaiE3Jss…`](https://nearvalidate.org/txns/FaiE3JssVmJkcz1VAWKnwKvmpYEBdCBtfiepNiGHCgCB?network=testnet) |
| `register_trader("real-trader", 1 NEAR, 30 days)` tx | [`3bnmv9pH…`](https://nearvalidate.org/txns/3bnmv9pHwDoaTbqcxUqeP8dHShrDs455cnbgsqdKV6C8?network=testnet) |
| On-chain genesis head | `3dc26694…c4c4` = `sha256("clavis:v1:real-trader.clavis-app.testnet")` (matches Python hashlib) |

The real trades are made on NEAR Intents **mainnet** by a separate mainnet dev account owned by the
human. The server maps that mainnet account to this testnet identity (`REAL_TRADER_MAINNET_ACCOUNT`).


## Demo traders on testnet (2026-11-04, `pnpm seed:chain`)

Sub-accounts of `clavis-app.testnet`, registered with the contract. The server's committer then
committed each trader's hash chain head (`commit_log`, signed by `clavis-committer.testnet`).

| Trader | Registration tx | First commit |
|---|---|---|
| `quiet-whale.clavis-app.testnet` | [`7iQ1BkAN…`](https://nearvalidate.org/txns/7iQ1BkANq3gmnmtVxHiFXzLmWVLcC7E6AxXyYgkFuhvt?network=testnet) | [`9tvg62ZL…`](https://nearvalidate.org/txns/9tvg62ZLVJdn2RHyp6ZdBPuvukQRCNWHCHQ2dExs3Bk6?network=testnet) (23 trades) |
| `zec-maxi.clavis-app.testnet` | [`9LhQQuHE…`](https://nearvalidate.org/txns/9LhQQuHE7CQHrAuuQXfygmygACDYiNwJbt1iDrTQMCm9?network=testnet) | [`4sjWVUJ4…`](https://nearvalidate.org/txns/4sjWVUJ4wnL1FMkMWkNVRNWendNuXmhnoU8Hr2qWyFZp?network=testnet) (31 trades) |
| `scalp-sensei.clavis-app.testnet` | [`A3mybR7X…`](https://nearvalidate.org/txns/A3mybR7XWChWeDB1L87YRSS7oekXfjRhGmEkUgtpsPKB?network=testnet) | [`4GYMuttq…`](https://nearvalidate.org/txns/4GYMuttqnARZ93Ny7XpvLmy6ow7sftCG4ekgJPK7kAKg?network=testnet) (60 trades) |
| `degen-dora.clavis-app.testnet` | [`73r8J1G1…`](https://nearvalidate.org/txns/73r8J1G1AzCtu8Nrtnk7eTVrrTqVYFfDSBHU3yG1s47L?network=testnet) | [`6rGEVpEW…`](https://nearvalidate.org/txns/6rGEVpEW4p7nCRKqEHQiAEdbbGndN6BXakBgbzec4FQF?network=testnet) (31 trades) |
| `steady-eddie.clavis-app.testnet` | [`AxqLu87C…`](https://nearvalidate.org/txns/AxqLu87CYW38spEJQa8YQs9T9C84it6PVHGvMS6FVPqg?network=testnet) | [`EJPLPnQN…`](https://nearvalidate.org/txns/EJPLPnQN1AiQ7SLEXYdGT8Hpd6NTf3HaBsfdyMbMA4zF?network=testnet) (22 trades) |

The seeded history reveals trades until 2026-11-11, so later commits raise these counts.

## Hosted demo (Render)

`render.yaml` describes one free web service: the API server also serves the built website from
the same address. Create it in Render as a Blueprint from this repository, then enter the two
secret values Render asks for: `ONECLICK_API_KEY` and `COMMITTER_PRIVATE_KEY`. Everything else is
in `render.yaml`. The free plan sleeps after 15 minutes without visitors (the next visit takes
about a minute) and starts with a fresh database each time; demo mode re-creates its data on start.
