#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, Env, String as SorobanString, Vec};

pub mod reentrancy_guard;

/// Shared no-op migration step for the v0 -> v1 storage schema transition.
///
/// Each contract's `upgrade` version-walk dispatches to this for the `v == 0`
/// arm. Centralised here so the (previously identical) per-contract migration
/// body isn't duplicated across contracts; a contract whose v0->v1 transition
/// needs real schema changes should replace its dispatch arm with a local
/// function instead of calling this one.
pub fn migrate_v0_to_v1(_env: &Env) {
    // No storage schema changes between v0 and v1.
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Version,
}

// ---------------------------------------------------------------------------
// C-043 — Emergency multisig for admin operations
//
// These shared types are used by the `acbu_multisig` contract and referenced
// by every contract that delegates admin authority to a multisig address.
//
// Design:
//   • A separate `MultisigContract` holds the signer list and threshold.
//   • Each protected contract stores the multisig contract address as its
//     "admin".  Admin-only functions call `admin.require_auth()` as before —
//     Soroban's auth tree propagates the M-of-N approval automatically when
//     the multisig contract is the invoker.
//   • The multisig contract exposes `propose` / `approve` / `execute` so that
//     M signers must independently authorise before any admin action fires.
// ---------------------------------------------------------------------------

/// On-chain proposal stored inside the multisig contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminProposal {
    /// Arbitrary tag identifying the intended action (e.g. "pause", "upgrade").
    pub action_tag: SorobanString,
    /// Addresses that have already approved this proposal.
    pub approvals: Vec<Address>,
    /// Whether the proposal has been executed.
    pub executed: bool,
    /// Ledger timestamp after which the proposal expires and can no longer be executed.
    pub expires_at: u64,
}

/// Multisig configuration stored inside the multisig contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigConfig {
    /// Ordered list of authorised signers.
    pub signers: Vec<Address>,
    /// Minimum number of approvals required to execute a proposal.
    pub threshold: u32,
}

/// Event emitted when a new proposal is created.
#[contracttype]
pub struct ProposalCreatedEvent {
    pub proposal_id: u64,
    pub proposer: Address,
    pub action_tag: SorobanString,
    pub expires_at: u64,
}

/// Event emitted when a signer approves a proposal.
#[contracttype]
pub struct ProposalApprovedEvent {
    pub proposal_id: u64,
    pub approver: Address,
    pub approval_count: u32,
}

/// Event emitted when a proposal reaches threshold and is executed.
#[contracttype]
pub struct ProposalExecutedEvent {
    pub proposal_id: u64,
    pub action_tag: SorobanString,
    pub executed_by: Address,
}

/// Increment this constant with every bug fix, feature addition, or breaking change
/// so that patched deployments can be distinguished from unpatched ones.
pub const CONTRACT_VERSION: u32 = 1;

/// Currency code type (e.g., "NGN", "KES", "RWF").
///
/// A currency code is logically a single short string. It is stored as one
/// [`SorobanString`] rather than a `Vec<SorobanString>` so that constructing,
/// cloning, comparing, and using it as a `Map` key does not allocate a
/// temporary host `Vec` object per call — which previously inflated both gas
/// usage and compiled WASM size.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrencyCode(pub SorobanString);

impl CurrencyCode {
    pub fn new(env: &soroban_sdk::Env, code: &str) -> Self {
        CurrencyCode(SorobanString::from_str(env, code))
    }

    /// Borrow the underlying currency code string (e.g. `"NGN"`).
    pub fn code(&self) -> &SorobanString {
        &self.0
    }
}

/// Rate data structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateData {
    pub currency: CurrencyCode,
    pub rate_usd: i128, // Rate in 7 decimals (e.g., 0.0012345 = 12345)
    pub timestamp: u64,
    pub sources: soroban_sdk::Vec<i128>, // Source rates for median calculation
    /// Ledger sequence number at which this rate was written.
    /// Used for ledger-based staleness checks (unforgeable — set by the network).
    pub ledger: u32,
}

/// Reserve data structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReserveData {
    pub currency: CurrencyCode,
    pub amount: i128,    // Reserve amount in native currency
    pub value_usd: i128, // Value in USD (7 decimals)
    pub timestamp: u64,
}

/// Account details for withdrawals
#[contracttype]
#[derive(Clone, Debug)]
pub struct AccountDetails {
    pub account_number: SorobanString,
    pub bank_code: SorobanString,
    pub account_name: SorobanString,
    pub currency: CurrencyCode,
}

/// Mint event payload emitted by the minting contract.
///
/// **Contract topics (Soroban):** `(Symbol \"mint\", Address recipient)` — the `user` field below
/// is always the mint recipient (same as the topic address).
///
/// **Backend / indexer alignment:** Map XDR or RPC event fields to these names in order. All
/// `i128` amounts use **7 decimal places** (`DECIMALS` = 10_000_000 per whole unit). `rate` is
/// the ACBU/USD rate in the same fixed-point form. `usdc_amount` is USDC in 7 decimals for
/// `mint_from_usdc`; for Afreum S-token mint paths it carries the USD-equivalent notional
/// (still 7-decimal fixed point).
#[contracttype]
pub struct MintEvent {
    pub transaction_id: SorobanString,
    pub user: Address,
    pub usdc_amount: i128,
    pub acbu_amount: i128,
    pub fee: i128,
    pub rate: i128,
    pub timestamp: u64,
}

/// Burn event payload emitted by the burning contract.
///
/// **Contract topics (Soroban):** `(Symbol \"burn\", Address user)` — matches the `user` field.
///
/// **Backend / indexer alignment:** Same field order as XDR struct encoding. Amounts (`acbu_amount`,
/// `local_amount`, `fee`, `rate`) are **7-decimal fixed point** (`DECIMALS`). `currency` is
/// [`CurrencyCode`] (string code such as `"NGN"`). For `burn_for_basket`, one event is emitted per
/// recipient slice; `acbu_amount` and `fee` are the portions for that slice, not necessarily the
/// full transaction totals.
#[contracttype]
pub struct BurnEvent {
    pub transaction_id: SorobanString,
    pub user: Address,
    /// Gross ACBU amount submitted for redemption (before fee deduction).
    pub acbu_amount: i128,
    /// Net ACBU after fee deduction (acbu_amount - fee). Emitted so indexers can
    /// verify acbu_amount - fee == net_acbu without re-deriving off-chain.
    pub net_acbu: i128,
    pub local_amount: i128,
    pub currency: CurrencyCode,
    pub fee: i128,
    pub rate: i128,
    pub timestamp: u64,
}

/// Rate update event data
#[contracttype]
pub struct RateUpdateEvent {
    pub currency: CurrencyCode,
    pub rate: i128,
    pub timestamp: u64,
    pub validator: Address,
}

/// Outlier detection event data
#[contracttype]
pub struct OutlierDetectionEvent {
    pub currency: CurrencyCode,
    pub median_rate: i128,
    pub outlier_rate: i128,
    pub deviation_bps: i128,
    pub timestamp: u64,
}

/// A single validator's emergency-bypass vote for a currency pair.
///
/// When a validator submits a rate that exceeds the per-currency emergency
/// threshold it is recorded here.  Once `min_signatures` validators have cast
/// votes, the time-lock bypass is granted and the pending votes are cleared.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyVote {
    /// The validator who submitted the candidate rate.
    pub validator: Address,
    /// The proposed rate (7 decimals).
    pub rate: i128,
    /// Ledger timestamp of the submission (used to expire stale votes).
    pub timestamp: u64,
}

/// Per-currency emergency bypass configuration stored in oracle instance storage.
///
/// Allows operators to tune the threshold per currency pair so that naturally
/// more-volatile currencies (e.g. ZWL, SSP) do not trigger false-positive
/// emergency bypasses while still catching genuine crises in stable pairs.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyConfig {
    /// Deviation in basis points that triggers an emergency vote.
    /// Defaults to [`EMERGENCY_THRESHOLD_BPS`] (500 bps = 5 %).
    pub threshold_bps: i128,
}

/// Event emitted when an emergency vote is cast (validator requests bypass).
#[contracttype]
pub struct EmergencyVoteCastEvent {
    pub currency: CurrencyCode,
    pub validator: Address,
    pub rate: i128,
    pub vote_count: u32,
    pub required: u32,
    pub timestamp: u64,
}

/// Event emitted when enough emergency votes accumulate and the bypass fires.
#[contracttype]
pub struct EmergencyBypassEvent {
    pub currency: CurrencyCode,
    pub new_rate: i128,
    pub vote_count: u32,
    pub timestamp: u64,
}

/// Error types for the **burning** contract (and any crate that re-uses this enum).
///
/// Numeric codes are stable for client UX; see `docs/ERROR_CODES.md` in the workspace root.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// The caller is not authorized for this action (e.g. not the admin/operator,
    /// or `require_auth` was not satisfied).
    Unauthorized = 1,
    /// The contract is paused; state-changing operations are temporarily disabled.
    Paused = 2,
    /// The supplied amount is invalid (non-positive, or outside the allowed bounds
    /// such as min/max mint or burn limits).
    InvalidAmount = 3,
    /// The exchange/conversion rate is invalid (e.g. zero, negative, or rejected
    /// by outlier/deviation checks).
    InvalidRate = 4,
    /// Reserves are insufficient to back the requested mint/operation against the
    /// configured collateralization requirement.
    InsufficientReserves = 5,
    /// The per-window operation rate limit has been exceeded; retry later.
    RateLimitExceeded = 6,
    /// The currency code is not recognized or not registered in the oracle/basket.
    InvalidCurrency = 7,
    /// A cross-contract call to the oracle failed or returned an unusable result
    /// (e.g. missing or stale rate).
    OracleError = 8,
    /// A cross-contract call to the reserve tracker failed or returned an
    /// unusable result.
    ReserveError = 9,
    /// The account's token balance is too low to complete the transfer/operation.
    InsufficientBalance = 10,
    /// The recipient address is invalid for this operation (e.g. a contract
    /// address where a classic account is required).
    InvalidRecipient = 11,
    /// WASM upgrade rejected: `new_version` must be greater than the stored version.
    InvalidVersion = 12,

    /// The computed output amount is below the caller-supplied minimum acceptable
    /// output (`min_*_out`), indicating that same-block oracle movement would
    /// cause unacceptable slippage for this transaction.
    SlippageExceeded = 13,

    Unknown = 9999,
}

impl core::fmt::Display for ContractError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            ContractError::Unauthorized => write!(f, "unauthorized"),
            ContractError::Paused => write!(f, "contract is paused"),
            ContractError::InvalidAmount => write!(f, "invalid amount"),
            ContractError::InvalidRate => write!(f, "invalid rate"),
            ContractError::InsufficientReserves => write!(f, "insufficient reserves"),
            ContractError::RateLimitExceeded => write!(f, "rate limit exceeded"),
            ContractError::InvalidCurrency => write!(f, "invalid currency"),
            ContractError::OracleError => write!(f, "oracle error"),
            ContractError::ReserveError => write!(f, "reserve error"),
            ContractError::InsufficientBalance => write!(f, "insufficient balance"),
            ContractError::InvalidRecipient => write!(f, "invalid recipient"),
            ContractError::InvalidVersion => write!(f, "invalid version"),
            ContractError::SlippageExceeded => write!(f, "output below minimum: slippage exceeded"),
            ContractError::Unknown => write!(f, "unknown error"),
        }
    }
}

/// Returns `true` if `oracle_timestamp` is within `max_staleness_seconds` of the
/// current ledger time. Centralises the `current_time` binding so that no consumer
/// can omit it — structurally prevents the class of bug reported in SC-001 / #507.
pub fn check_oracle_freshness(
    env: &Env,
    oracle_timestamp: u64,
    max_staleness_seconds: u64,
) -> bool {
    let current_time = env.ledger().timestamp();
    current_time <= oracle_timestamp.saturating_add(max_staleness_seconds)
}

/// Cross-contract method name constants — prevents silent logic splits from typos
/// when the same string is used in multiple contracts to call shared interfaces.
pub const ORACLE_GET_ACBU_RATE: &str = "get_acbu_usd_rate";
pub const ORACLE_GET_ACBU_RATE_WITH_TS: &str = "get_acbu_usd_rate_with_timestamp";
pub const ORACLE_GET_RATE: &str = "get_rate";
pub const ORACLE_GET_RATE_WITH_TS: &str = "get_rate_with_timestamp";
pub const ORACLE_GET_CURRENCIES: &str = "get_currencies";
pub const ORACLE_GET_BASKET_WEIGHT: &str = "get_basket_weight";
pub const ORACLE_GET_S_TOKEN_ADDR: &str = "get_s_token_address";
pub const ORACLE_GET_RATE_DECIMALS: &str = "get_rate_decimals";
pub const RESERVE_IS_SUFFICIENT: &str = "is_reserve_sufficient";
pub const TOKEN_GET_TOTAL_SUPPLY: &str = "get_total_supply";

/// Constants
pub const BASIS_POINTS: i128 = 10_000;
pub const DECIMALS: i128 = 10_000_000; // 7 decimals
pub const MIN_MINT_AMOUNT: i128 = 10_000_000; // 10 USDC (7 decimals)
pub const MAX_MINT_AMOUNT: i128 = 1_000_000_000_000; // 1M USDC (7 decimals)
pub const MAX_TOTAL_SUPPLY: i128 = 1_000_000_000_0_000_000; // 1 billion ACBU (7 decimals)
pub const MIN_BURN_AMOUNT: i128 = 10_000_000; // 10 ACBU (7 decimals)
pub const UPDATE_INTERVAL_SECONDS: u64 = 21_600; // 6 hours
pub const EMERGENCY_THRESHOLD_BPS: i128 = 500; // 5% deviation threshold
pub const OUTLIER_THRESHOLD_BPS: i128 = 300; // 3% deviation for outlier detection
pub const MAX_VALIDATORS: u32 = 50; // Maximum number of validators to prevent gas griefing
/// Maximum ledger age of a stored rate before it is considered stale and rejected
/// at read time. Stellar closes ~1 ledger every 5 seconds; 720 ledgers ≈ 1 hour.
/// Rates must be refreshed within this window or consumers (minting) will be blocked.
/// Admin can bypass via `set_rate_admin` for emergency overrides.
pub const STALE_RATE_MAX_LEDGERS: u32 = 4_320; // ~6 hours at 5 s/ledger

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ContractPhase {
    Uninitialized,
    Active,
    Paused,
}

/// Utility functions
pub fn calculate_fee(amount: i128, fee_rate_bps: i128) -> i128 {
    amount
        .checked_mul(fee_rate_bps)
        .and_then(|v| v.checked_div(BASIS_POINTS))
        .expect("Overflow in fee calculation")
}

pub fn calculate_amount_after_fee(amount: i128, fee_rate_bps: i128) -> i128 {
    amount
        .checked_sub(calculate_fee(amount, fee_rate_bps))
        .expect("Underflow in amount after fee calculation")
}

/// Returns `true` if `address` is a classic Stellar account (a `G…` strkey).
///
/// Mint and redeem recipients must be accounts: tokens sent to a contract
/// address (`C…`), including the minting/burning contract itself, can be
/// stranded. Both halves of the flow use this one predicate so their
/// stranding protection cannot drift apart (AC-031). Callers panic with their
/// own `InvalidRecipient` error so contract error codes stay unchanged.
pub fn is_account_address(address: &Address) -> bool {
    let strkey = address.to_string();
    if strkey.len() != 56 {
        return false;
    }
    let mut buf = [0u8; 56];
    strkey.copy_into_slice(&mut buf);
    buf[0] == b'G'
}

/// Calculate median using in-place quickselect algorithm
/// This avoids unnecessary allocations (clone) and reduces gas consumption
pub fn median(mut values: soroban_sdk::Vec<i128>) -> Option<i128> {
    if values.is_empty() {
        return None;
    }

    let n = values.len();
    let mid = n / 2;

    if n % 2 == 0 {
        // For even count, find two middle elements and average them
        quickselect_inplace(&mut values, 0, i32::try_from(n - 1).unwrap_or(0), i32::try_from(mid - 1).unwrap_or(0));
        let val1 = values.get(mid - 1)?;
        quickselect_inplace(&mut values, 0, i32::try_from(n - 1).unwrap_or(0), i32::try_from(mid).unwrap_or(0));
        let val2 = values.get(mid)?;
        // SC-020: use checked arithmetic — (val1 + val2) can overflow i128 for extreme rates.
        val1.checked_add(val2).and_then(|sum| sum.checked_div(2))
    } else {
        // For odd count, find the middle element
        quickselect_inplace(&mut values, 0, i32::try_from(n - 1).unwrap_or(0), i32::try_from(mid).unwrap_or(0));
        Some(values.get(mid)?)
    }
}

/// In-place quickselect to find the k-th smallest element
/// Based on Hoare's selection algorithm for O(n) average performance without cloning
fn quickselect_inplace(values: &mut soroban_sdk::Vec<i128>, mut left: i32, mut right: i32, k: i32) {
    while left < right {
        let pivot_index = partition_inplace(values, left, right);
        if k == pivot_index {
            return;
        } else if k < pivot_index {
            right = pivot_index - 1;
        } else {
            left = pivot_index + 1;
        }
    }
}

/// Partition array in-place for quickselect using Lomuto partition scheme
fn partition_inplace(values: &mut soroban_sdk::Vec<i128>, left: i32, right: i32) -> i32 {
    let pivot_value = values.get(u32::try_from(right).unwrap_or(0)).unwrap_or(0);
    let mut i = left - 1;

    for j in left..right {
        let val_j = values.get(u32::try_from(j).unwrap_or(0)).unwrap_or(0);
        if val_j < pivot_value {
            i += 1;
            let idx_i = u32::try_from(i).unwrap_or(0);
            let idx_j = u32::try_from(j).unwrap_or(0);
            let val_i = values.get(idx_i).unwrap_or(0);
            values.set(idx_i, val_j);
            values.set(idx_j, val_i);
        }
    }

    let idx_i_plus_1 = u32::try_from(i + 1).unwrap_or(0);
    let idx_right = u32::try_from(right).unwrap_or(0);
    let val_i_plus_1 = values.get(idx_i_plus_1).unwrap_or(0);
    values.set(idx_i_plus_1, pivot_value);
    values.set(idx_right, val_i_plus_1);

    i + 1
}

/// Calculate percentage deviation
pub fn calculate_deviation(value1: i128, value2: i128) -> i128 {
    if value2 == 0 {
        return i128::MAX;
    }
    let diff = if value1 > value2 {
        value1
            .checked_sub(value2)
            .expect("Underflow in deviation diff")
    } else {
        value2
            .checked_sub(value1)
            .expect("Underflow in deviation diff")
    };
    (diff * BASIS_POINTS) / value2
}

/// Check if a contract is initialized by verifying the version key exists.
///
/// This helper function allows backend services and other contracts to check
/// if a contract has been initialized before calling its functions. This prevents
/// cryptic storage-not-found errors from uninitialized contracts.
///
/// # Arguments
/// * `env` - The Soroban environment
///
/// # Returns
/// * `true` if the contract is initialized (version key exists)
/// * `false` if the contract is not initialized
pub fn is_initialized(env: &soroban_sdk::Env) -> bool {
    env.storage().instance().has(&DataKey::Version)
}
