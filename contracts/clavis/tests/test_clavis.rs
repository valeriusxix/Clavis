//! Sandbox integration test: deploy the real wasm, then register -> buy_key -> commit_log ->
//! withdraw -> withdraw_platform against a local NEAR sandbox node.
use near_api::{AccountId, NearToken};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::json;

#[derive(Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
struct Commitment {
    trade_count: String,
    head_hash: String,
}

const HEAD: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async fn clavis_flow(contract_wasm: Vec<u8>) -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;

    let owner = create_subaccount(&sandbox, "owner.sandbox").await?;
    let committer = create_subaccount(&sandbox, "committer.sandbox").await?;
    let trader = create_subaccount(&sandbox, "trader.sandbox").await?;
    let holder = create_subaccount(&sandbox, "holder.sandbox").await?;
    let contract = create_subaccount(&sandbox, "clavis.sandbox")
        .await?
        .as_contract();

    // Deploy + init in one transaction signed by the contract account (`new` is #[private]).
    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(contract_wasm)
        .with_init_call(
            "new",
            json!({ "owner_id": owner.account_id(), "committer_id": committer.account_id(), "platform_fee_bps": 500 }),
        )?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    // Trader registers: 1 NEAR per 30 days. 0.1 NEAR covers storage; the rest is refunded.
    contract
        .call_function("register_trader", json!({ "display_name": "Trader", "price": NearToken::from_near(1), "period_days": 30 }))
        .transaction()
        .deposit(NearToken::from_millinear(100))
        .with_signer(trader.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    // Holder buys a key (price + storage, excess refunded).
    contract
        .call_function("buy_key", json!({ "trader_id": trader.account_id() }))
        .transaction()
        .deposit(NearToken::from_near(2))
        .with_signer(holder.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    let has_access: bool = contract
        .call_function(
            "has_access",
            json!({ "trader_id": trader.account_id(), "account_id": holder.account_id() }),
        )
        .read_only()
        .fetch_from(&net)
        .await?
        .data;
    assert!(has_access);

    let balance: NearToken = contract
        .call_function("get_balance", json!({ "account_id": trader.account_id() }))
        .read_only()
        .fetch_from(&net)
        .await?
        .data;
    assert_eq!(balance, NearToken::from_millinear(950));

    // Only the committer may commit.
    contract
        .call_function(
            "commit_log",
            json!({ "trader_id": trader.account_id(), "trade_count": "3", "head_hash": HEAD }),
        )
        .transaction()
        .with_signer(trader.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_failure();
    contract
        .call_function(
            "commit_log",
            json!({ "trader_id": trader.account_id(), "trade_count": "3", "head_hash": HEAD }),
        )
        .transaction()
        .with_signer(committer.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    let commitment: Commitment = contract
        .call_function(
            "get_commitment",
            json!({ "trader_id": trader.account_id() }),
        )
        .read_only()
        .fetch_from(&net)
        .await?
        .data;
    assert_eq!(commitment.trade_count, "3");
    assert_eq!(commitment.head_hash, HEAD);

    // Trader withdraws 0.95 NEAR; balance goes to zero and stays there (transfer succeeded).
    let trader_before = trader.tokens().near_balance().fetch_from(&net).await?.total;
    contract
        .call_function("withdraw", ())
        .transaction()
        .with_signer(trader.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let balance: NearToken = contract
        .call_function("get_balance", json!({ "account_id": trader.account_id() }))
        .read_only()
        .fetch_from(&net)
        .await?
        .data;
    assert_eq!(balance, NearToken::from_near(0));
    let trader_after = trader.tokens().near_balance().fetch_from(&net).await?.total;
    assert!(trader_after > trader_before.saturating_add(NearToken::from_millinear(900)));

    // Callbacks are #[private]: an outside account cannot call them to mint balance.
    contract
        .call_function(
            "on_withdraw",
            json!({ "account_id": holder.account_id(), "amount": NearToken::from_near(5) }),
        )
        .transaction()
        .with_signer(holder.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_failure();
    // `new` is #[private] (and the contract is already initialized).
    contract
        .call_function("new", json!({ "owner_id": holder.account_id(), "committer_id": holder.account_id(), "platform_fee_bps": 0 }))
        .transaction()
        .with_signer(holder.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_failure();

    // Owner withdraws the 0.05 NEAR platform fee; a non-owner cannot.
    contract
        .call_function("withdraw_platform", ())
        .transaction()
        .with_signer(holder.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_failure();
    contract
        .call_function("withdraw_platform", ())
        .transaction()
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    Ok(())
}

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse().unwrap();
    sandbox
        .create_account(account_id.clone())
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}

/// Opt-in: needs a local NEAR sandbox node (`neard` raises the open-file limit to 65535, which some
/// containers forbid). Run with: `cargo test -- --ignored`.
#[tokio::test]
#[ignore = "needs a local NEAR sandbox node; run with `cargo test -- --ignored`"]
async fn test_clavis_flow_on_sandbox() -> testresult::TestResult<()> {
    let contract_wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let contract_wasm = std::fs::read(contract_wasm_path)?;
    clavis_flow(contract_wasm).await
}
