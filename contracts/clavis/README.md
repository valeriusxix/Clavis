# Clavis contract (`contracts/clavis`)

Rust `near-sdk` contract for Clavis: key sales, access expiry, trader earnings, and on-chain
commitments of each trader's trade-log hash chain. Full spec: `AGENT.md` section 7 and
`docs/DECISIONS.md` ("Phase 1 contract decisions").

## Methods

| Method | Type | Notes |
|---|---|---|
| `new(owner_id, committer_id, platform_fee_bps)` | init, private | `platform_fee_bps <= 10000` |
| `register_trader(display_name, price, period_days)` | change, payable | deposit covers storage, rest refunded |
| `update_trader(display_name?, price?, period_days?)` | change, payable | trader only; pays only for extra storage |
| `buy_key(trader_id) -> U64` | change, payable | `attached >= price + storage`; returns new expiry (ns) |
| `withdraw() -> Promise` | change | zeroes balance first; callback restores it if the transfer fails |
| `withdraw_platform() -> Promise` | change | owner only; same restore-on-failure callback |
| `commit_log(trader_id, trade_count, head_hash)` | change | committer only; count must increase; 64 hex chars |
| `set_committer(account_id)` | change | owner only |
| `get_trader`, `list_traders(from_index?, limit?)`, `has_access`, `get_access`, `get_commitment`, `get_balance`, `get_config` | view | |

JSON notes: `NearToken` values are yoctoNEAR strings. `u64` values (timestamps, counts, expiry) are
strings (`U64`) so JavaScript keeps full precision. A new trader's `head_hash` is the hash-chain
genesis `sha256("clavis:v1:" + trader_id)`, so `get_commitment` of a trader with no trades already
matches an empty log.

Events (NEP-297, `standard: "clavis"`): `trader_registered`, `key_purchased`, `log_committed`,
`withdrawn`, `withdraw_failed`.

## Build and test

```bash
cargo test                              # unit tests + sandbox integration test
cargo near build non-reproducible-wasm  # -> target/near/clavis.wasm
```
