//! Unit tests for every rule in AGENT.md 7.2, plus withdraw_platform and the withdraw callbacks.
use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, testing_env};

const ONE_NEAR: NearToken = NearToken::from_near(1);
const T0: u64 = 1_800_000_000_000_000_000; // some block timestamp (ns)

fn contract_id() -> AccountId {
    "clavis.testnet".parse().unwrap()
}
fn owner() -> AccountId {
    accounts(0) // alice
}
fn committer() -> AccountId {
    accounts(1) // bob
}
fn trader() -> AccountId {
    accounts(2) // charlie
}
fn holder() -> AccountId {
    accounts(3) // danny
}
fn holder2() -> AccountId {
    accounts(4) // eugene
}

fn ctx(predecessor: AccountId, deposit: NearToken, now: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(1_000))
        .block_timestamp(now);
    b
}

fn set(predecessor: AccountId, deposit: NearToken, now: u64) {
    testing_env!(ctx(predecessor, deposit, now).build());
}

/// Context for a callback invocation (predecessor = the contract) with one promise result.
fn set_callback(result: PromiseResult) {
    testing_env!(
        ctx(contract_id(), ZERO, T0).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn init(fee_bps: u16) -> Clavis {
    set(contract_id(), ZERO, T0);
    Clavis::new(owner(), committer(), fee_bps)
}

/// Contract with one registered trader (price 1 NEAR / 30 days).
fn with_trader(fee_bps: u16) -> Clavis {
    let mut c = init(fee_bps);
    set(trader(), ONE_NEAR, T0);
    c.register_trader("Charlie".into(), ONE_NEAR, 30);
    c
}

/// All NEAR transfers created by the current call: (receiver, amount).
fn transfers() -> Vec<(AccountId, NearToken)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit)),
                _ => None,
            })
        })
        .collect()
}

fn events(name: &str) -> Vec<near_sdk::serde_json::Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(j).unwrap())
        .filter(|v| v["event"] == name)
        .collect()
}

fn days(n: u64) -> u64 {
    n * NS_PER_DAY
}

/// Measure the storage cost of a first key purchase (access entry + trader balance entry).
/// Runs on its own thread: the mocked blockchain (and its storage) is thread-local, so this does
/// not disturb the calling test's contract.
fn first_key_storage_cost(fee_bps: u16) -> NearToken {
    std::thread::spawn(move || {
        let mut c = with_trader(fee_bps);
        set(holder(), NearToken::from_near(10), T0);
        let before = env::storage_usage(); // after set(): testing_env! resets the storage counter
        c.buy_key(trader());
        let bytes = env::storage_usage() - before;
        env::storage_byte_cost().saturating_mul(u128::from(bytes))
    })
    .join()
    .unwrap()
}

// ----------------------------------------------------------------------------- init

#[test]
fn new_sets_config() {
    let c = init(500);
    let cfg = c.get_config();
    assert_eq!(cfg.owner_id, owner());
    assert_eq!(cfg.committer_id, committer());
    assert_eq!(cfg.platform_fee_bps, 500);
    assert_eq!(cfg.platform_balance, ZERO);
    assert_eq!(cfg.trader_count, 0);
}

#[test]
#[should_panic(expected = "platform_fee_bps must be <= 10000")]
fn new_rejects_fee_above_100_percent() {
    set(contract_id(), ZERO, T0);
    Clavis::new(owner(), committer(), 10_001);
}

// `#[private]` and `#[payable]` are enforced by the generated wasm export wrapper, not in the Rust
// method body, so they cannot be unit-tested. tests/test_clavis.rs covers them on a sandbox node.

// ----------------------------------------------------------------------------- register_trader

#[test]
fn register_trader_stores_profile_charges_storage_and_refunds_excess() {
    let mut c = init(500);
    set(trader(), ONE_NEAR, T0);
    let before = env::storage_usage();
    c.register_trader("Charlie".into(), NearToken::from_millinear(500), 30);

    let used = env::storage_usage() - before;
    assert!(used > 0);
    let storage_cost = env::storage_byte_cost().saturating_mul(u128::from(used));
    assert_eq!(
        transfers(),
        vec![(trader(), ONE_NEAR.saturating_sub(storage_cost))]
    );

    let t = c.get_trader(trader()).unwrap();
    assert_eq!(t.display_name, "Charlie");
    assert_eq!(t.price, NearToken::from_millinear(500));
    assert_eq!(t.period_days, 30);
    assert_eq!(t.created_at, U64(T0));
    assert_eq!(t.commit_count, U64(0));
    assert_eq!(t.keys_sold, U64(0));
    assert_eq!(events("trader_registered").len(), 1);
}

#[test]
fn register_trader_starts_head_at_hash_chain_genesis() {
    // h0 = sha256("clavis:v1:" + traderId), computed independently with Python hashlib.
    let mut c = init(500);
    set(owner(), ONE_NEAR, T0); // "alice"
    c.register_trader("Alice".into(), ONE_NEAR, 30);
    let commitment = c.get_commitment(owner()).unwrap();
    assert_eq!(
        commitment.head_hash,
        "cff8d52105aac3de5f264d33b64b6ef19e9d95b1a967dade34a6c4c1e3628deb"
    );
    assert_eq!(commitment.trade_count, U64(0));
}

#[test]
#[should_panic(expected = "Already registered as a trader")]
fn register_trader_rejects_duplicates() {
    let mut c = with_trader(500);
    set(trader(), ONE_NEAR, T0);
    c.register_trader("Again".into(), ONE_NEAR, 30);
}

#[test]
#[should_panic(expected = "is less than required")]
fn register_trader_requires_storage_deposit() {
    let mut c = init(500);
    set(trader(), NearToken::from_yoctonear(1), T0);
    c.register_trader("Charlie".into(), ONE_NEAR, 30);
}

#[test]
#[should_panic(expected = "display_name must be 1-64 characters")]
fn register_trader_rejects_empty_name() {
    let mut c = init(500);
    set(trader(), ONE_NEAR, T0);
    c.register_trader("".into(), ONE_NEAR, 30);
}

#[test]
#[should_panic(expected = "display_name must be 1-64 characters")]
fn register_trader_rejects_long_name() {
    let mut c = init(500);
    set(trader(), ONE_NEAR, T0);
    c.register_trader("x".repeat(65), ONE_NEAR, 30);
}

#[test]
#[should_panic(expected = "period_days must be between 1 and 365")]
fn register_trader_rejects_zero_period() {
    let mut c = init(500);
    set(trader(), ONE_NEAR, T0);
    c.register_trader("Charlie".into(), ONE_NEAR, 0);
}

// ----------------------------------------------------------------------------- update_trader

#[test]
fn update_trader_changes_only_given_fields() {
    let mut c = with_trader(500);
    set(trader(), ZERO, T0);
    c.update_trader(None, Some(NearToken::from_near(2)), Some(7));
    let t = c.get_trader(trader()).unwrap();
    assert_eq!(t.display_name, "Charlie");
    assert_eq!(t.price, NearToken::from_near(2));
    assert_eq!(t.period_days, 7);
}

#[test]
#[should_panic(expected = "Only a registered trader can update their profile")]
fn update_trader_is_trader_only() {
    let mut c = with_trader(500);
    set(holder(), ZERO, T0);
    c.update_trader(Some("Mallory".into()), None, None);
}

#[test]
#[should_panic(expected = "is less than required")]
fn update_trader_longer_name_needs_storage_deposit() {
    let mut c = with_trader(500);
    set(trader(), ZERO, T0);
    c.update_trader(Some("C".repeat(64)), None, None);
}

// ----------------------------------------------------------------------------- buy_key

#[test]
fn buy_key_grants_access_credits_trader_and_platform_and_refunds_excess() {
    let storage = first_key_storage_cost(500);
    let mut c = with_trader(500);
    let attached = NearToken::from_near(3);
    set(holder(), attached, T0);
    let expiry = c.buy_key(trader());

    assert_eq!(expiry, U64(T0 + days(30)));
    assert_eq!(c.get_access(trader(), holder()), Some(U64(T0 + days(30))));
    // 5% fee: trader gets 0.95 NEAR, platform 0.05 NEAR
    assert_eq!(c.get_balance(trader()), NearToken::from_millinear(950));
    assert_eq!(
        c.get_config().platform_balance,
        NearToken::from_millinear(50)
    );
    assert_eq!(c.get_trader(trader()).unwrap().keys_sold, U64(1));
    // excess refunded: 3 NEAR - 1 NEAR price - storage
    let refund = attached.saturating_sub(ONE_NEAR).saturating_sub(storage);
    assert_eq!(transfers(), vec![(holder(), refund)]);
    let ev = events("key_purchased");
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["data"][0]["holder_id"], "danny");
}

#[test]
#[should_panic(expected = "is less than required")]
fn buy_key_rejects_price_without_storage() {
    let mut c = with_trader(500);
    set(holder(), ONE_NEAR, T0); // exactly the price: storage for the first key is not covered
    c.buy_key(trader());
}

#[test]
fn buy_key_accepts_exactly_price_plus_storage() {
    let storage = first_key_storage_cost(500);
    let mut c = with_trader(500);
    set(holder(), ONE_NEAR.saturating_add(storage), T0);
    c.buy_key(trader());
    assert!(transfers().is_empty(), "nothing to refund");
}

#[test]
fn buy_key_extends_expiry_instead_of_resetting() {
    let mut c = with_trader(500);
    set(holder(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    // Renew 10 days later, while the key is still active: expiry stacks.
    set(holder(), NearToken::from_near(2), T0 + days(10));
    let expiry = c.buy_key(trader());
    assert_eq!(expiry, U64(T0 + days(60)));
    assert_eq!(c.get_trader(trader()).unwrap().keys_sold, U64(2));
}

#[test]
fn buy_key_after_expiry_starts_from_now() {
    let mut c = with_trader(500);
    set(holder(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    let later = T0 + days(45);
    set(holder(), NearToken::from_near(2), later);
    assert_eq!(c.buy_key(trader()), U64(later + days(30)));
}

#[test]
fn buy_key_renewal_needs_no_extra_storage() {
    let mut c = with_trader(500);
    set(holder(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    set(holder(), ONE_NEAR, T0 + days(1)); // exactly the price
    c.buy_key(trader());
    assert!(transfers().is_empty());
}

#[test]
#[should_panic(expected = "Trader not found")]
fn buy_key_unknown_trader() {
    let mut c = init(500);
    set(holder(), ONE_NEAR, T0);
    c.buy_key(trader());
}

#[test]
#[should_panic(expected = "Traders always have access to their own feed")]
fn buy_key_rejects_own_key() {
    let mut c = with_trader(500);
    set(trader(), NearToken::from_near(2), T0);
    c.buy_key(trader());
}

// ----------------------------------------------------------------------------- fee math

#[test]
fn fee_math() {
    assert_eq!(fee_of(ONE_NEAR, 500), NearToken::from_millinear(50));
    assert_eq!(fee_of(ONE_NEAR, 0), ZERO);
    assert_eq!(fee_of(ONE_NEAR, 10_000), ONE_NEAR);
    // rounds down: 5% of 19 yocto = 0.95 -> 0
    assert_eq!(fee_of(NearToken::from_yoctonear(19), 500), ZERO);
    assert_eq!(
        fee_of(NearToken::from_yoctonear(20), 500),
        NearToken::from_yoctonear(1)
    );
}

#[test]
fn trader_plus_platform_always_equals_price() {
    let cases = [
        (1u128, 500u16),
        (999, 333),
        (10u128.pow(24) + 7, 250),
        (12345, 10_000),
    ];
    for (i, (price_yocto, bps)) in cases.into_iter().enumerate() {
        // Mocked storage survives across contexts, so use a fresh trader account per case.
        let t: AccountId = format!("trader{i}.near").parse().unwrap();
        let mut c = init(bps);
        set(t.clone(), ONE_NEAR, T0);
        c.register_trader("Charlie".into(), NearToken::from_yoctonear(price_yocto), 30);
        set(holder(), NearToken::from_near(2), T0);
        c.buy_key(t.clone());
        let total = c
            .get_balance(t)
            .saturating_add(c.get_config().platform_balance);
        assert_eq!(total.as_yoctonear(), price_yocto);
    }
}

#[test]
fn zero_fee_platform_gets_nothing() {
    let mut c = with_trader(0);
    set(holder(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    assert_eq!(c.get_balance(trader()), ONE_NEAR);
    assert_eq!(c.get_config().platform_balance, ZERO);
}

// ----------------------------------------------------------------------------- access views

#[test]
fn has_access_rules() {
    let mut c = with_trader(500);
    assert!(
        c.has_access(trader(), trader()),
        "trader always has access to self"
    );
    assert!(!c.has_access(trader(), holder()));
    assert_eq!(c.get_access(trader(), holder()), None);

    set(holder(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    set(holder(), ZERO, T0 + days(29));
    assert!(c.has_access(trader(), holder()));
    set(holder(), ZERO, T0 + days(30));
    assert!(
        !c.has_access(trader(), holder()),
        "expired at exactly the expiry time"
    );
    assert!(!c.has_access(trader(), holder2()));
    assert!(!c.has_access(holder(), holder()), "unknown trader");
}

// ----------------------------------------------------------------------------- commit_log

const HEAD_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

#[test]
fn commit_log_updates_commitment_and_emits_event() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0 + 5);
    c.commit_log(trader(), U64(3), HEAD_A.into());
    assert_eq!(
        c.get_commitment(trader()),
        Some(Commitment {
            trade_count: U64(3),
            head_hash: HEAD_A.into(),
            last_commit_at: U64(T0 + 5)
        })
    );
    assert_eq!(events("log_committed").len(), 1);

    set(committer(), ZERO, T0 + 9);
    c.commit_log(trader(), U64(4), HEAD_B.into());
    assert_eq!(c.get_commitment(trader()).unwrap().trade_count, U64(4));
}

#[test]
fn commit_log_does_not_grow_storage() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    let before = env::storage_usage();
    c.commit_log(trader(), U64(1), HEAD_A.into());
    c.traders.flush();
    assert_eq!(env::storage_usage(), before);
}

#[test]
fn commit_log_stores_lowercase() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(1), HEAD_A.to_uppercase());
    assert_eq!(c.get_commitment(trader()).unwrap().head_hash, HEAD_A);
}

#[test]
#[should_panic(expected = "Only the committer can call commit_log")]
fn commit_log_rejects_non_committer() {
    let mut c = with_trader(500);
    set(trader(), ZERO, T0);
    c.commit_log(trader(), U64(1), HEAD_A.into());
}

#[test]
#[should_panic(expected = "trade_count must be greater than the committed count")]
fn commit_log_rejects_same_count() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(2), HEAD_A.into());
    c.commit_log(trader(), U64(2), HEAD_B.into());
}

#[test]
#[should_panic(expected = "trade_count must be greater than the committed count")]
fn commit_log_rejects_lower_count() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(5), HEAD_A.into());
    c.commit_log(trader(), U64(4), HEAD_B.into());
}

#[test]
#[should_panic(expected = "trade_count must be greater than the committed count")]
fn commit_log_rejects_zero_count() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(0), HEAD_A.into());
}

#[test]
#[should_panic(expected = "head_hash must be 64 hex characters")]
fn commit_log_rejects_short_hash() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(1), HEAD_A[..63].into());
}

#[test]
#[should_panic(expected = "head_hash must be 64 hex characters")]
fn commit_log_rejects_non_hex_hash() {
    let mut c = with_trader(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(1), "g".repeat(64));
}

#[test]
#[should_panic(expected = "Trader not found")]
fn commit_log_rejects_unknown_trader() {
    let mut c = init(500);
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(1), HEAD_A.into());
}

// ----------------------------------------------------------------------------- set_committer

#[test]
fn set_committer_switches_committer() {
    let mut c = with_trader(500);
    set(owner(), ZERO, T0);
    c.set_committer(holder());
    assert_eq!(c.get_config().committer_id, holder());
    set(holder(), ZERO, T0);
    c.commit_log(trader(), U64(1), HEAD_A.into());
}

#[test]
#[should_panic(expected = "Only the committer can call commit_log")]
fn set_committer_revokes_old_committer() {
    let mut c = with_trader(500);
    set(owner(), ZERO, T0);
    c.set_committer(holder());
    set(committer(), ZERO, T0);
    c.commit_log(trader(), U64(1), HEAD_A.into());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn set_committer_is_owner_only() {
    let mut c = init(500);
    set(committer(), ZERO, T0);
    c.set_committer(committer());
}

// ----------------------------------------------------------------------------- withdraw

fn with_earnings() -> Clavis {
    let mut c = with_trader(500);
    set(holder(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    c
}

#[test]
fn withdraw_zeroes_balance_before_transfer() {
    let mut c = with_earnings();
    set(trader(), ZERO, T0);
    let _ = c.withdraw();
    // Balance is already zero while the transfer promise is pending.
    assert_eq!(c.get_balance(trader()), ZERO);
    assert_eq!(
        transfers(),
        vec![(trader(), NearToken::from_millinear(950))]
    );
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_nothing() {
    let mut c = with_trader(500);
    set(trader(), ZERO, T0);
    let _ = c.withdraw();
}

#[test]
fn on_withdraw_success_keeps_zero_and_emits_withdrawn() {
    let mut c = with_earnings();
    set(trader(), ZERO, T0);
    let _ = c.withdraw();
    set_callback(PromiseResult::Successful(vec![]));
    assert!(c.on_withdraw(trader(), NearToken::from_millinear(950)));
    assert_eq!(c.get_balance(trader()), ZERO);
    assert_eq!(events("withdrawn").len(), 1);
}

#[test]
fn on_withdraw_failure_restores_balance() {
    let mut c = with_earnings();
    set(trader(), ZERO, T0);
    let _ = c.withdraw();
    set_callback(PromiseResult::Failed);
    assert!(!c.on_withdraw(trader(), NearToken::from_millinear(950)));
    assert_eq!(c.get_balance(trader()), NearToken::from_millinear(950));
    assert_eq!(events("withdraw_failed").len(), 1);
    assert!(events("withdrawn").is_empty());
}

#[test]
fn on_withdraw_failure_adds_back_on_top_of_new_earnings() {
    let mut c = with_earnings();
    set(trader(), ZERO, T0);
    let _ = c.withdraw();
    // A new key sale lands before the failed transfer's callback runs.
    set(holder2(), NearToken::from_near(2), T0);
    c.buy_key(trader());
    set_callback(PromiseResult::Failed);
    c.on_withdraw(trader(), NearToken::from_millinear(950));
    assert_eq!(c.get_balance(trader()), NearToken::from_millinear(1_900));
}

// ----------------------------------------------------------------------------- withdraw_platform

#[test]
fn withdraw_platform_pays_owner_and_zeroes_first() {
    let mut c = with_earnings();
    set(owner(), ZERO, T0);
    let _ = c.withdraw_platform();
    assert_eq!(c.get_config().platform_balance, ZERO);
    assert_eq!(transfers(), vec![(owner(), NearToken::from_millinear(50))]);
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn withdraw_platform_is_owner_only() {
    let mut c = with_earnings();
    set(trader(), ZERO, T0);
    let _ = c.withdraw_platform();
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn withdraw_platform_nothing() {
    let mut c = with_trader(500);
    set(owner(), ZERO, T0);
    let _ = c.withdraw_platform();
}

#[test]
fn on_withdraw_platform_failure_restores_balance() {
    let mut c = with_earnings();
    set(owner(), ZERO, T0);
    let _ = c.withdraw_platform();
    set_callback(PromiseResult::Failed);
    assert!(!c.on_withdraw_platform(owner(), NearToken::from_millinear(50)));
    assert_eq!(
        c.get_config().platform_balance,
        NearToken::from_millinear(50)
    );
}

#[test]
fn on_withdraw_platform_success() {
    let mut c = with_earnings();
    set(owner(), ZERO, T0);
    let _ = c.withdraw_platform();
    set_callback(PromiseResult::Successful(vec![]));
    assert!(c.on_withdraw_platform(owner(), NearToken::from_millinear(50)));
    assert_eq!(c.get_config().platform_balance, ZERO);
}

// ----------------------------------------------------------------------------- list / get

#[test]
fn list_traders_paginates_in_registration_order() {
    let mut c = init(500);
    for (i, name) in ["A", "B", "C"].iter().enumerate() {
        set(accounts(i + 2), ONE_NEAR, T0);
        c.register_trader((*name).into(), ONE_NEAR, 30);
    }
    let all = c.list_traders(None, None);
    assert_eq!(
        all.iter()
            .map(|t| t.display_name.as_str())
            .collect::<Vec<_>>(),
        ["A", "B", "C"]
    );
    let page = c.list_traders(Some(1), Some(1));
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].account_id, accounts(3));
    assert!(c.list_traders(Some(5), Some(10)).is_empty());
    assert_eq!(c.get_config().trader_count, 3);
}

#[test]
fn get_trader_and_commitment_unknown_is_none() {
    let c = init(500);
    assert!(c.get_trader(trader()).is_none());
    assert!(c.get_commitment(trader()).is_none());
    assert_eq!(c.get_balance(trader()), ZERO);
}
