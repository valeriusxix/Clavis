//! Clavis contract: key sales, access records, trader earnings, and on-chain commitments of each
//! trader's trade-log hash chain. Spec: AGENT.md section 7, plus `withdraw_platform()` and the
//! restore-on-failure withdraw callbacks recorded in docs/DECISIONS.md.
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, near, require,
};

mod events;
#[cfg(test)]
mod tests;

/// Nanoseconds per day (block timestamps are in ns).
pub const NS_PER_DAY: u64 = 86_400 * 1_000_000_000;
pub const MAX_DISPLAY_NAME_LEN: usize = 64;
pub const MAX_PERIOD_DAYS: u32 = 365;
pub const MAX_LIST_LIMIT: u32 = 100;
pub const BPS_DENOMINATOR: u16 = 10_000;
/// Gas reserved for the withdraw callbacks.
pub const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);
/// Domain separator of the hash chain (AGENT.md 11.2): h0 = sha256("clavis:v1:" + traderId).
pub const HASH_CHAIN_PREFIX: &str = "clavis:v1:";

const ZERO: NearToken = NearToken::from_yoctonear(0);

/// On-chain trader record (AGENT.md 7.1).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Trader {
    pub display_name: String,
    /// Key price per period.
    pub price: NearToken,
    pub period_days: u32,
    pub created_at: u64,
    /// Number of trades covered by `head_hash`.
    pub commit_count: u64,
    /// Lowercase hex sha256. Starts at the chain genesis h0, so an empty log already matches.
    pub head_hash: String,
    pub last_commit_at: u64,
    pub keys_sold: u64,
}

/// JSON view of a trader. u64 values are strings (`U64`) so JavaScript keeps full precision.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TraderView {
    pub account_id: AccountId,
    pub display_name: String,
    pub price: NearToken,
    pub period_days: u32,
    pub created_at: U64,
    pub commit_count: U64,
    pub head_hash: String,
    pub last_commit_at: U64,
    pub keys_sold: U64,
}

/// Returned by `get_commitment`; read by the Verify panel.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Commitment {
    pub trade_count: U64,
    pub head_hash: String,
    pub last_commit_at: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub committer_id: AccountId,
    pub platform_fee_bps: u16,
    pub platform_balance: NearToken,
    pub trader_count: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Clavis {
    owner_id: AccountId,
    /// Server account that may call `commit_log`.
    committer_id: AccountId,
    /// e.g. 500 = 5%.
    platform_fee_bps: u16,
    traders: IterableMap<AccountId, Trader>,
    /// (trader, holder) -> access expiry in ns.
    access: LookupMap<(AccountId, AccountId), u64>,
    /// Withdrawable earnings.
    balances: LookupMap<AccountId, NearToken>,
    platform_balance: NearToken,
}

#[near]
impl Clavis {
    /// Only the contract account itself can initialize (do it in the deploy transaction).
    #[init]
    #[private]
    pub fn new(owner_id: AccountId, committer_id: AccountId, platform_fee_bps: u16) -> Self {
        require!(
            platform_fee_bps <= BPS_DENOMINATOR,
            "platform_fee_bps must be <= 10000"
        );
        Self {
            owner_id,
            committer_id,
            platform_fee_bps,
            traders: IterableMap::new(b"t"),
            access: LookupMap::new(b"a"),
            balances: LookupMap::new(b"b"),
            platform_balance: ZERO,
        }
    }

    // ------------------------------------------------------------------ traders

    /// Caller becomes a trader. The attached deposit must cover the storage used; the rest is
    /// refunded. Rejects duplicates.
    #[payable]
    pub fn register_trader(&mut self, display_name: String, price: NearToken, period_days: u32) {
        let trader_id = env::predecessor_account_id();
        require!(
            !self.traders.contains_key(&trader_id),
            "Already registered as a trader"
        );
        assert_display_name(&display_name);
        assert_period_days(period_days);

        let storage_before = env::storage_usage();
        let trader = Trader {
            display_name: display_name.clone(),
            price,
            period_days,
            created_at: env::block_timestamp(),
            commit_count: 0,
            head_hash: genesis_hash(&trader_id),
            last_commit_at: 0,
            keys_sold: 0,
        };
        self.traders.insert(trader_id.clone(), trader);
        self.traders.flush();
        self.settle_deposit(storage_before, ZERO);

        events::emit(
            "trader_registered",
            json!({
                "trader_id": trader_id,
                "display_name": display_name,
                "price": price,
                "period_days": period_days,
            }),
        );
    }

    /// Trader only. Payable so a longer display name can pay for its extra storage; any unused
    /// deposit is refunded.
    #[payable]
    pub fn update_trader(
        &mut self,
        display_name: Option<String>,
        price: Option<NearToken>,
        period_days: Option<u32>,
    ) {
        let trader_id = env::predecessor_account_id();
        let mut trader =
            self.traders.get(&trader_id).cloned().unwrap_or_else(|| {
                env::panic_str("Only a registered trader can update their profile")
            });

        if let Some(name) = display_name {
            assert_display_name(&name);
            trader.display_name = name;
        }
        if let Some(p) = price {
            trader.price = p;
        }
        if let Some(days) = period_days {
            assert_period_days(days);
            trader.period_days = days;
        }

        let storage_before = env::storage_usage();
        self.traders.insert(trader_id, trader);
        self.traders.flush();
        self.settle_deposit(storage_before, ZERO);
    }

    // ------------------------------------------------------------------ keys

    /// Buy (or extend) a key for `trader_id`. Requires `attached >= price + storage`.
    /// Expiry becomes `max(now, current_expiry) + period`. Credits `price * (1 - fee)` to the
    /// trader and the fee to the platform, refunds any excess, and increments `keys_sold`.
    /// Returns the new expiry (ns).
    #[payable]
    pub fn buy_key(&mut self, trader_id: AccountId) -> U64 {
        let holder_id = env::predecessor_account_id();
        require!(
            holder_id != trader_id,
            "Traders always have access to their own feed"
        );
        let mut trader = self
            .traders
            .get(&trader_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Trader not found"));

        let storage_before = env::storage_usage();
        let now = env::block_timestamp();

        let key = (trader_id.clone(), holder_id.clone());
        let current_expiry = self.access.get(&key).copied().unwrap_or(0);
        let period_ns = u64::from(trader.period_days)
            .checked_mul(NS_PER_DAY)
            .unwrap_or_else(|| env::panic_str("Period overflow"));
        let expires_at = current_expiry
            .max(now)
            .checked_add(period_ns)
            .unwrap_or_else(|| env::panic_str("Expiry overflow"));
        self.access.insert(key, expires_at);

        let price = trader.price;
        let fee = fee_of(price, self.platform_fee_bps);
        let earning = price.saturating_sub(fee);
        let balance = self.balances.get(&trader_id).copied().unwrap_or(ZERO);
        self.balances.insert(
            trader_id.clone(),
            balance
                .checked_add(earning)
                .unwrap_or_else(|| env::panic_str("Balance overflow")),
        );
        self.platform_balance = self
            .platform_balance
            .checked_add(fee)
            .unwrap_or_else(|| env::panic_str("Platform balance overflow"));

        trader.keys_sold += 1;
        self.traders.insert(trader_id.clone(), trader);

        self.access.flush();
        self.balances.flush();
        self.traders.flush();
        self.settle_deposit(storage_before, price);

        events::emit(
            "key_purchased",
            json!({
                "trader_id": trader_id,
                "holder_id": holder_id,
                "expires_at": U64(expires_at),
                "price": price,
                "platform_fee": fee,
            }),
        );
        U64(expires_at)
    }

    // ------------------------------------------------------------------ withdrawals

    /// Transfer the caller's earnings. The balance is zeroed BEFORE the transfer promise; the
    /// callback restores it if the transfer fails.
    pub fn withdraw(&mut self) -> Promise {
        let account_id = env::predecessor_account_id();
        let amount = self.balances.get(&account_id).copied().unwrap_or(ZERO);
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.balances.insert(account_id.clone(), ZERO);

        Promise::new(account_id.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_WITHDRAW_CALLBACK)
                .on_withdraw(account_id, amount),
        )
    }

    /// Owner only. Transfer the accumulated platform fees to `owner_id`. Zeroed before the
    /// transfer promise; the callback restores it if the transfer fails.
    pub fn withdraw_platform(&mut self) -> Promise {
        self.assert_owner();
        let amount = self.platform_balance;
        require!(!amount.is_zero(), "Nothing to withdraw");
        self.platform_balance = ZERO;

        Promise::new(self.owner_id.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_WITHDRAW_CALLBACK)
                .on_withdraw_platform(self.owner_id.clone(), amount),
        )
    }

    /// Callback of `withdraw`. Returns true if the transfer succeeded.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: NearToken) -> bool {
        if transfer_succeeded() {
            events::emit(
                "withdrawn",
                json!({ "account_id": account_id, "amount": amount, "source": "earnings" }),
            );
            true
        } else {
            // Add back (not overwrite): new earnings may have arrived in the meantime.
            let balance = self.balances.get(&account_id).copied().unwrap_or(ZERO);
            self.balances
                .insert(account_id.clone(), balance.saturating_add(amount));
            events::emit(
                "withdraw_failed",
                json!({ "account_id": account_id, "amount": amount, "source": "earnings" }),
            );
            false
        }
    }

    /// Callback of `withdraw_platform`. Returns true if the transfer succeeded.
    #[private]
    pub fn on_withdraw_platform(&mut self, account_id: AccountId, amount: NearToken) -> bool {
        if transfer_succeeded() {
            events::emit(
                "withdrawn",
                json!({ "account_id": account_id, "amount": amount, "source": "platform" }),
            );
            true
        } else {
            self.platform_balance = self.platform_balance.saturating_add(amount);
            events::emit(
                "withdraw_failed",
                json!({ "account_id": account_id, "amount": amount, "source": "platform" }),
            );
            false
        }
    }

    // ------------------------------------------------------------------ commitments

    /// Committer only. Records the head of a trader's hash chain covering `trade_count` trades.
    /// Requires `trade_count > commit_count` and a 64-char hex `head_hash` (stored lowercase).
    pub fn commit_log(&mut self, trader_id: AccountId, trade_count: U64, head_hash: String) {
        require!(
            env::predecessor_account_id() == self.committer_id,
            "Only the committer can call commit_log"
        );
        require!(
            head_hash.len() == 64 && head_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "head_hash must be 64 hex characters"
        );
        let mut trader = self
            .traders
            .get(&trader_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Trader not found"));
        let trade_count = trade_count.0;
        require!(
            trade_count > trader.commit_count,
            "trade_count must be greater than the committed count"
        );

        let head_hash = head_hash.to_ascii_lowercase();
        trader.commit_count = trade_count;
        trader.head_hash = head_hash.clone();
        trader.last_commit_at = env::block_timestamp();
        self.traders.insert(trader_id.clone(), trader);

        events::emit(
            "log_committed",
            json!({
                "trader_id": trader_id,
                "trade_count": U64(trade_count),
                "head_hash": head_hash,
            }),
        );
    }

    /// Owner only.
    pub fn set_committer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.committer_id = account_id;
    }

    // ------------------------------------------------------------------ views

    pub fn get_trader(&self, trader_id: AccountId) -> Option<TraderView> {
        self.traders.get(&trader_id).map(|t| to_view(&trader_id, t))
    }

    /// Paginated, in registration order. `limit` is capped at 100.
    pub fn list_traders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<TraderView> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(MAX_LIST_LIMIT).min(MAX_LIST_LIMIT) as usize;
        self.traders
            .iter()
            .skip(from)
            .take(limit)
            .map(|(id, t)| to_view(id, t))
            .collect()
    }

    /// The trader always has access to their own feed.
    pub fn has_access(&self, trader_id: AccountId, account_id: AccountId) -> bool {
        if !self.traders.contains_key(&trader_id) {
            return false;
        }
        if trader_id == account_id {
            return true;
        }
        self.access
            .get(&(trader_id, account_id))
            .is_some_and(|expiry| *expiry > env::block_timestamp())
    }

    /// Expiry in ns (as a string), or null if the account never bought a key.
    pub fn get_access(&self, trader_id: AccountId, account_id: AccountId) -> Option<U64> {
        self.access.get(&(trader_id, account_id)).map(|e| U64(*e))
    }

    pub fn get_commitment(&self, trader_id: AccountId) -> Option<Commitment> {
        self.traders.get(&trader_id).map(|t| Commitment {
            trade_count: U64(t.commit_count),
            head_hash: t.head_hash.clone(),
            last_commit_at: U64(t.last_commit_at),
        })
    }

    pub fn get_balance(&self, account_id: AccountId) -> NearToken {
        self.balances.get(&account_id).copied().unwrap_or(ZERO)
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            committer_id: self.committer_id.clone(),
            platform_fee_bps: self.platform_fee_bps,
            platform_balance: self.platform_balance,
            trader_count: self.traders.len(),
        }
    }
}

impl Clavis {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    /// Charge `extra + storage used since storage_before` against the attached deposit and refund
    /// the rest to the caller. Panics (reverting all changes) if the deposit is too small.
    fn settle_deposit(&self, storage_before: u64, extra: NearToken) -> NearToken {
        let storage_after = env::storage_usage();
        let bytes = storage_after.saturating_sub(storage_before);
        let storage_cost = env::storage_byte_cost().saturating_mul(u128::from(bytes));
        let required = extra.saturating_add(storage_cost);
        let attached = env::attached_deposit();
        require!(
            attached >= required,
            format!(
                "Attached deposit {} yoctoNEAR is less than required {} yoctoNEAR ({} for storage)",
                attached.as_yoctonear(),
                required.as_yoctonear(),
                storage_cost.as_yoctonear()
            )
        );
        let refund = attached.saturating_sub(required);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
        storage_cost
    }
}

/// `price * fee_bps / 10_000`, rounded down.
pub fn fee_of(price: NearToken, fee_bps: u16) -> NearToken {
    let fee = price
        .as_yoctonear()
        .checked_mul(u128::from(fee_bps))
        .unwrap_or_else(|| env::panic_str("Fee overflow"))
        / u128::from(BPS_DENOMINATOR);
    NearToken::from_yoctonear(fee)
}

/// Hash-chain genesis h0 = hex(sha256("clavis:v1:" + trader_id)).
pub fn genesis_hash(trader_id: &AccountId) -> String {
    let digest = env::sha256(format!("{HASH_CHAIN_PREFIX}{trader_id}").as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// True if the single promise this callback depends on succeeded.
fn transfer_succeeded() -> bool {
    !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
}

fn assert_display_name(name: &str) {
    let len = name.chars().count();
    require!(
        (1..=MAX_DISPLAY_NAME_LEN).contains(&len),
        "display_name must be 1-64 characters"
    );
}

fn assert_period_days(days: u32) {
    require!(
        (1..=MAX_PERIOD_DAYS).contains(&days),
        "period_days must be between 1 and 365"
    );
}

fn to_view(account_id: &AccountId, t: &Trader) -> TraderView {
    TraderView {
        account_id: account_id.clone(),
        display_name: t.display_name.clone(),
        price: t.price,
        period_days: t.period_days,
        created_at: U64(t.created_at),
        commit_count: U64(t.commit_count),
        head_hash: t.head_hash.clone(),
        last_commit_at: U64(t.last_commit_at),
        keys_sold: U64(t.keys_sold),
    }
}
