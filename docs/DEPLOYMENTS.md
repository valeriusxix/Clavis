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
| Deploy + `new` tx | [`GCUCzHXorev9c9kPa91sVrB7jpdMFM49KSgrLEvwy9dJ`](https://explorer.testnet.near.org/transactions/GCUCzHXorev9c9kPa91sVrB7jpdMFM49KSgrLEvwy9dJ) |

All accounts were created with the testnet faucet (10 testnet NEAR each).

### Acceptance run (Phase 1)

| Step | Signer | Result | Tx |
|---|---|---|---|
| `register_trader("Test Trader", 0.1 NEAR, 30)` | `clavis-test-trader.testnet` | ✅ `trader_registered` | [`AswmxZMF…`](https://explorer.testnet.near.org/transactions/AswmxZMF7PRZTLgaq49BvKeKzm5HKSXYm2F2XaPyV7rG) |
| `get_commitment` before any commit | view | ✅ `trade_count "0"`, `head_hash` = h0 = `sha256("clavis:v1:clavis-test-trader.testnet")` = `5f2d015b…bcaa` (matches Python hashlib) | |
| `buy_key` with 0.2 NEAR attached | `clavis-test-buyer.testnet` | ✅ `key_purchased`; `has_access` true; trader credited 0.099, platform 0.001 (1%); excess refunded | [`35AjhmTu…`](https://explorer.testnet.near.org/transactions/35AjhmTu51kwCV76kporrCZ1tkp7HPafXpM9atuAeY2A) |
| `commit_log` by a non-committer | trader | ✅ rejected: "Only the committer can call commit_log" | |
| `commit_log(trade_count "1", head 721e9d68…)` | `clavis-committer.testnet` | ✅ `log_committed`. Test value: `sha256("clavis:testnet-acceptance:1")`, not a real trade log | [`59ojPeyE…`](https://explorer.testnet.near.org/transactions/59ojPeyERN7eCwD6E4b8gyPFKLCfNrNHMMQ82JT7GSmf) |
| `near view clavis-app.testnet get_commitment` | view | ✅ `{ trade_count "1", head_hash 721e9d68…, last_commit_at … }` | |
| `on_withdraw` called from outside | buyer | ✅ rejected: "Method on_withdraw is private" | |
| `withdraw` | trader | ✅ `withdrawn` 0.099 NEAR; balance now 0 | [`GTr3fSQs…`](https://explorer.testnet.near.org/transactions/GTr3fSQsSvUoHRELSz8bixnPgztooVA44MrH7HRUiCRB) |
| `withdraw_platform` by a non-owner | buyer | ✅ rejected: "Only the owner can call this method" | |
| `withdraw_platform` | `clavis-owner.testnet` | ✅ `withdrawn` 0.001 NEAR (source `platform`) | [`3p6P436y…`](https://explorer.testnet.near.org/transactions/3p6P436yf9hrtW3z1q9WUErjGn9cNFY9FTHKou3vpST1) |

`clavis-test-trader.testnet` and `clavis-test-buyer.testnet` are test accounts. The test trader is
not one of the seeded demo traders, and its committed head is a test value.
