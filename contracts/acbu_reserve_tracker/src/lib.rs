#![no_std]
use core::fmt::{self, Display};
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, vec, Address,
    Bytes, BytesN, Env, IntoVal, Map, Symbol, Vec,
};

use shared::{
    CurrencyCode, DataKey as SharedDataKey, ReserveData, BASIS_POINTS, CONTRACT_VERSION, DECIMALS,
    ORACLE_GET_ACBU_RATE, ORACLE_GET_RATE_WITH_TS, TOKEN_GET_TOTAL_SUPPLY,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReserveTrackerError {
    AlreadyInitialized = 8001,
    InvalidVersion = 8002,
    ZeroSupply = 8003,
    NoPendingAdmin = 8004,
    AdminTimelockNotElapsed = 8005,
    NoPendingAdminToCancel = 8006,
    Unauthorized = 8007,
    AttestationNotFound = 8008,
    InvalidMerkleProof = 8009,
    InvalidCustodian = 8010,
    AttestationExpired = 8011,
    NonPositiveAmount = 8014,
    InconsistentReserve = 8015,
    DuplicateCurrency = 8016,
    NoPendingUpgrade = 8012,
    TimelockNotElapsed = 8013,
    Unknown = 8999,
}

impl Display for ReserveTrackerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::AlreadyInitialized => "reserve tracker already initialized",
            Self::InvalidVersion => "invalid contract version",
            Self::ZeroSupply => "zero supply",
            Self::NoPendingAdmin => "no pending admin",
            Self::AdminTimelockNotElapsed => "admin timelock has not elapsed",
            Self::NoPendingAdminToCancel => "no pending admin to cancel",
            Self::Unauthorized => "unauthorized",
            Self::AttestationNotFound => "no attestation submitted yet",
            Self::InvalidMerkleProof => "merkle proof does not match stored root",
            Self::InvalidCustodian => "caller is not the custodian",
            Self::AttestationExpired => "attestation has expired",
            Self::NonPositiveAmount => "amount and value_usd must be positive",
            Self::InconsistentReserve => "value_usd inconsistent with oracle rate",
            Self::DuplicateCurrency => "currency already tracked",
            Self::NoPendingUpgrade => "no pending upgrade",
            Self::TimelockNotElapsed => "timelock has not elapsed",
            Self::Unknown => "unknown reserve tracker error",
        };
        f.write_str(message)
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataKey {
    pub admin: Symbol,
    pub oracle: Symbol,
    pub reserves: Symbol,
    pub min_reserve_ratio: Symbol,
    pub acbu_token: Symbol,
    pub version: Symbol,
    pub pending_admin: Symbol,
    pub pending_admin_eligible_at: Symbol,
    pub currencies: Symbol,
    pub last_verify_call: Symbol,
    pub last_verify_result: Symbol,
    pub pending_upgrade_wasm: Symbol,
    pub pending_upgrade_version: Symbol,
    pub pending_upgrade_eligible_at: Symbol,
    pub custodian: Symbol,
    pub attested_root: Symbol,
    pub attestation_ts: Symbol,
}

/// A single reserve entry committed in the Merkle attestation tree.
///
/// Each leaf encodes the currency code, the reserve amount, its USD value,
/// and the timestamp at which the custodian attested to the balance.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationLeaf {
    pub currency: CurrencyCode,
    pub amount: i128,
    pub value_usd: i128,
    pub timestamp: u64,
}

const DATA_KEY: DataKey = DataKey {
    admin: symbol_short!("ADMIN"),
    oracle: symbol_short!("ORACLE"),
    reserves: symbol_short!("RESERVES"),
    min_reserve_ratio: symbol_short!("MIN_RES"),
    acbu_token: symbol_short!("ACBU_TKN"),
    version: symbol_short!("VERSION"),
    pending_admin: symbol_short!("PEND_ADM"),
    pending_admin_eligible_at: symbol_short!("PEND_ETA"),
    currencies: symbol_short!("CURRNCYS"),
    last_verify_call: symbol_short!("LAST_VFY"),
    last_verify_result: symbol_short!("LAST_RES"),
    pending_upgrade_wasm: symbol_short!("PU_WASM"),
    pending_upgrade_version: symbol_short!("PU_VER"),
    pending_upgrade_eligible_at: symbol_short!("PU_ETA"),
    custodian: symbol_short!("CUSTODIN"),
    attested_root: symbol_short!("ATT_ROOT"),
    attestation_ts: symbol_short!("ATT_TS"),
};

/// A single currency attestation entry in a Merkle tree, submitted by the custodian.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationLeaf {
    pub currency: CurrencyCode,
    pub amount: i128,
    pub value_usd: i128,
    pub timestamp: u64,
}

/// Admin rotation timelock: the pending admin must wait this long before
/// claiming ownership, giving the current admin a window to cancel a mistaken
/// or malicious transfer.
const ADMIN_TIMELOCK_SECONDS: u64 = 86_400;

/// Upgrade timelock: the staged WASM must wait this long before being applied,
/// giving the admin a window to cancel a mistaken or malicious upgrade.
const UPGRADE_TIMELOCK_SECONDS: u64 = 86_400;

/// Rate limit for verify_reserves calls to prevent spam and ledger load.
/// Only one verify_reserves call is allowed per this cooldown period.
const VERIFY_RESERVES_COOLDOWN_SECONDS: u64 = 60;

/// Maximum age of an attestation before external systems should consider
/// it stale. The custodian is expected to submit fresh attestations within
/// this window. 24 hours.
const ATTESTATION_MAX_AGE_SECONDS: u64 = 86_400;

contractmeta!(key = "version", val = "1");

#[contract]
pub struct ReserveTrackerContract;

#[contractimpl]
impl ReserveTrackerContract {
    /// Initialize the reserve tracker contract
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        acbu_token: Address,
        min_reserve_ratio_bps: i128,
    ) {
        if env.storage().instance().has(&DATA_KEY.admin) {
            env.panic_with_error(ReserveTrackerError::AlreadyInitialized);
        }

        env.storage().instance().set(&DATA_KEY.admin, &admin);
        env.storage().instance().set(&DATA_KEY.oracle, &oracle);
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &acbu_token);
        env.storage()
            .instance()
            .set(&DATA_KEY.min_reserve_ratio, &min_reserve_ratio_bps);

        let reserves: Map<CurrencyCode, ReserveData> = Map::new(&env);
        env.storage().instance().set(&DATA_KEY.reserves, &reserves);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &CONTRACT_VERSION);
    }

    /// Return the circulating ACBU total supply by cross-contract-calling
    /// `get_total_supply` on the registered ACBU token contract.
    pub fn get_total_supply_from_token(env: &Env) -> i128 {
        let acbu_token_addr: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        // Use invoke_contract to avoid dependency on a specific token client implementation
        env.invoke_contract(
            &acbu_token_addr,
            &Symbol::new(env, TOKEN_GET_TOTAL_SUPPLY),
            Vec::new(env),
        )
    }

    /// Verify that on-chain reserves are sufficient to back the circulating ACBU supply.
    ///
    /// Total supply is obtained by cross-contract-calling `get_total_supply` on the
    /// registered ACBU token contract.  Previously this used
    /// `acbu_client.balance(&env.current_contract_address())`, which always returned 0
    /// because the reserve tracker holds no ACBU — causing reserve checks to be skipped
    /// entirely (fix for issue #193).
    ///
    /// Rate limited to prevent spam: only one call per VERIFY_RESERVES_COOLDOWN_SECONDS.
    pub fn verify_reserves(env: Env) -> bool {
        let now = env.ledger().timestamp();

        let last_call: Option<u64> = env.storage().instance().get(&DATA_KEY.last_verify_call);
        if let Some(last) = last_call {
            if now.saturating_sub(last) < VERIFY_RESERVES_COOLDOWN_SECONDS {
                return true;
            }
        }

        env.storage().instance().set(&DATA_KEY.last_verify_call, &now);

        let total_acbu_supply = Self::get_total_supply_from_token(&env);
        if total_acbu_supply == 0 {
            env.panic_with_error(ReserveTrackerError::ZeroSupply);
        }
        let result = Self::is_reserve_sufficient(env.clone(), total_acbu_supply);
        env.storage()
            .instance()
            .set(&DATA_KEY.last_verify_result, &result);
        result
    }

    /// Like [`Self::verify_reserves`] but uses the caller-supplied
    /// `total_acbu_supply` instead of querying the token contract. Returns `true`
    /// if reserves meet the minimum ratio.
    fn verify_reserves_manual(env: Env, total_acbu_supply: i128) -> bool {
        Self::is_reserve_sufficient(env, total_acbu_supply)
    }

    /// Update reserve amount for a currency (admin only).
    ///
    /// Cross-validates the caller-supplied `amount` and `value_usd` against the
    /// oracle's live exchange rate for `currency`.  This prevents a compromised
    /// admin key from inflating reserves to unlock arbitrary minting.
    pub fn update_reserve(
        env: Env,
        updater: Address,
        currency: CurrencyCode,
        amount: i128,
        value_usd: i128,
    ) {
        updater.require_auth();
        let admin = Self::get_admin(env.clone());
        if updater != admin {
            env.panic_with_error(ReserveTrackerError::Unauthorized);
        }

        if amount <= 0 || value_usd <= 0 {
            env.panic_with_error(ReserveTrackerError::NonPositiveAmount);
        }

        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let (rate, _rate_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
            vec![&env, currency.clone().into_val(&env)],
        );

        let expected_value_usd = amount
            .checked_mul(rate)
            .and_then(|v| v.checked_div(DECIMALS))
            .expect("Overflow in reserve value calculation");

        let diff = value_usd.abs_diff(expected_value_usd);
        if diff > 1 {
            env.panic_with_error(ReserveTrackerError::InconsistentReserve);
        }

        let current_time = env.ledger().timestamp();

        let mut reserves: Map<CurrencyCode, ReserveData> = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserves)
            .unwrap_or(Map::new(&env));
        let reserve_data = ReserveData {
            currency: currency.clone(),
            amount,
            value_usd,
            timestamp: current_time,
        };

        reserves.set(currency.clone(), reserve_data.clone());
        env.storage().instance().set(&DATA_KEY.reserves, &reserves);

        env.events()
            .publish((symbol_short!("reserve"), currency.clone()), reserve_data);
    }

    /// Get current reserves for all currencies
    pub fn get_all_reserves(env: Env) -> Map<CurrencyCode, ReserveData> {
        env.storage().instance().extend_ttl(5184000, 5184000);
        env.storage()
            .instance()
            .get(&DATA_KEY.reserves)
            .unwrap_or(Map::new(&env))
    }

    /// Check if the total reserves are sufficient to back the ACBU supply
    pub fn total_reserves(env: Env) -> i128 {
        let reserves = Self::get_all_reserves(env.clone());
        let mut total_usd = 0i128;
        for (_curr, data) in reserves.iter() {
            total_usd = total_usd.checked_add(data.value_usd).expect("Overflow");
        }
        total_usd
    }

    /// Return `true` if total reserve USD value backs `total_acbu_supply` at or
    /// above the configured minimum reserve ratio (default 100%).
    ///
    /// Sums the USD value of all stored reserves and compares it against the ACBU
    /// supply valued at the oracle's ACBU/USD rate. Trivially returns `true` when
    /// supply is non-positive or values to zero.
    pub fn is_reserve_sufficient(env: Env, total_acbu_supply: i128) -> bool {
        if total_acbu_supply <= 0 {
            return true;
        }

        let reserves = Self::get_all_reserves(env.clone());
        let mut total_reserve_usd = 0i128;

        for (_curr, data) in reserves.iter() {
            total_reserve_usd = total_reserve_usd
                .checked_add(data.value_usd)
                .expect("Overflow in reserve calculation");
        }

        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let acbu_usd_rate: i128 = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE),
            Vec::new(&env),
        );

        let total_acbu_usd = total_acbu_supply
            .checked_mul(acbu_usd_rate)
            .expect("Overflow in ACBU USD calculation")
            .checked_div(100_000_000)
            .expect("Division by zero in ACBU USD calculation");
        if total_acbu_usd == 0 {
            return true;
        }

        let min_reserve_ratio = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_reserve_ratio)
            .unwrap_or(10000i128); // Default to 100%

        let current_ratio = total_reserve_usd
            .checked_mul(BASIS_POINTS)
            .expect("Overflow in reserve ratio calculation")
            .checked_div(total_acbu_usd)
            .expect("Division by zero in reserve ratio calculation");
        current_ratio >= min_reserve_ratio
    }

    // -----------------------------------------------------------------------
    // Merkle-root attestation (SC-015)
    //
    // A fintech custodian periodically submits a Merkle root that commits to
    // the full set of reserve balances.  Anyone can verify a specific reserve
    // entry against the stored root by providing a Merkle proof.  This is
    // independent of the admin-reported reserves (`update_reserve`) and
    // provides an external, verifiable source of truth.
    //
    // The tree is a standard binary Merkle tree.  Each leaf is:
    //
    //     keccak256(currency_code || amount(16BE) || value_usd(16BE) || timestamp(8BE))
    //
    // At each level, the concatenation order is determined by the leaf index:
    //
    //     if (index >> level) & 1 == 0 → node = keccak256(node || sibling)
    //     else                         → node = keccak256(sibling || node)
    // -----------------------------------------------------------------------

    /// Set the custodian address (admin only). The custodian is the off-chain
    /// entity authorised to submit Merkle-root attestations of reserve balances.
    pub fn set_custodian(env: Env, custodian: Address) {
        Self::check_admin(&env);
        env.storage().instance().set(&DATA_KEY.custodian, &custodian);
        env.events().publish((symbol_short!("cust_set"),), (custodian,));
    }

    /// Return the current custodian address, or panic if none has been set.
    pub fn get_custodian(env: Env) -> Address {
        env.storage().instance().get(&DATA_KEY.custodian).unwrap()
    }

    /// Submit a new Merkle root attestation. Only the registered custodian
    /// may call this. The contract stores the root together with the current
    /// ledger timestamp.
    pub fn submit_attestation(env: Env, root: BytesN<32>) {
        let custodian: Address = Self::get_custodian(env.clone());
        custodian.require_auth();
        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DATA_KEY.attested_root, &root);
        env.storage()
            .instance()
            .set(&DATA_KEY.attestation_ts, &now);
        env.events()
            .publish((symbol_short!("attest"),), (root, now));
    }

    /// Verify that `leaf` exists in the currently stored Merkle tree by
    /// walking the `proof` upward and comparing the computed root against
    /// the stored `attested_root`.
    ///
    /// Panics with:
    /// - `AttestationNotFound`  when no attestation has been submitted yet
    /// - `InvalidMerkleProof`   when the computed root does not match storage
    ///
    /// The caller is responsible for checking attestation freshness via
    /// [`Self::get_latest_attestation`] and `ATTESTATION_MAX_AGE_SECONDS`.
    pub fn verify_merkle_proof(
        env: Env,
        leaf: AttestationLeaf,
        proof: Vec<BytesN<32>>,
        index: u32,
    ) -> bool {
        let root: BytesN<32> = env
            .storage()
            .instance()
            .get(&DATA_KEY.attested_root)
            .unwrap_or_else(|| env.panic_with_error(ReserveTrackerError::AttestationNotFound));

        let leaf_hash = Self::hash_leaf(&env, &leaf);
        let computed = Self::compute_merkle_root(&env, &leaf_hash, &proof, index);

        if &computed != &root {
            env.panic_with_error(ReserveTrackerError::InvalidMerkleProof);
        }
        true
    }

    /// Return the latest attested Merkle root and its submission timestamp,
    /// or panic if no attestation has been submitted yet.
    pub fn get_latest_attestation(env: Env) -> (BytesN<32>, u64) {
        let root: BytesN<32> = env
            .storage()
            .instance()
            .get(&DATA_KEY.attested_root)
            .unwrap_or_else(|| env.panic_with_error(ReserveTrackerError::AttestationNotFound));
        let ts: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.attestation_ts)
            .unwrap();
        (root, ts)
    }

    // -----------------------------------------------------------------------
    // Private helpers — attestation (SC-015)
    // -----------------------------------------------------------------------

    /// Hash a leaf into a 32-byte digest for the Merkle tree.
    ///
    /// Serialisation format (big-endian, variable-length currency code):
    ///
    ///     currency_code_bytes || amount(16BE) || value_usd(16BE) || timestamp(8BE)
    fn hash_leaf(env: &Env, leaf: &AttestationLeaf) -> BytesN<32> {
        let mut buf = Bytes::new(env);
        let code = leaf.currency.code();
        let mut code_buf = [0u8; 32];
        code.copy_into_slice(&mut code_buf);
        let code_len = code.len() as usize;
        let code_bytes = Bytes::from_slice(env, &code_buf[..code_len]);
        buf.append(&code_bytes);
        let amt_bytes = Bytes::from_slice(env, &leaf.amount.to_be_bytes()[..]);
        buf.append(&amt_bytes);
        let val_bytes = Bytes::from_slice(env, &leaf.value_usd.to_be_bytes()[..]);
        buf.append(&val_bytes);
        let ts_bytes = Bytes::from_slice(env, &leaf.timestamp.to_be_bytes()[..]);
        buf.append(&ts_bytes);
        env.crypto().keccak256(&buf).into()
    }

    /// Walk up the Merkle tree from `leaf_hash` using `proof` and `index`.
    fn compute_merkle_root(
        env: &Env,
        leaf_hash: &BytesN<32>,
        proof: &Vec<BytesN<32>>,
        index: u32,
    ) -> BytesN<32> {
        let mut current = leaf_hash.clone();
        for i in 0..proof.len() {
            let sibling = proof.get(i).unwrap();
            let cur_bytes: Bytes = current.clone().into();
            let sib_bytes: Bytes = sibling.clone().into();
            let mut combined = Bytes::new(env);
            if (index >> i) & 1 == 0 {
                combined.append(&cur_bytes);
                combined.append(&sib_bytes);
            } else {
                combined.append(&sib_bytes);
                combined.append(&cur_bytes);
            }
            current = env.crypto().keccak256(&combined).into();
        }
        current
    }

    /// Stage a WASM upgrade to `new_wasm_hash`/`new_version` and start the
    /// upgrade timelock (admin only). `new_version` must exceed the current
    /// version. Apply later with [`Self::execute_upgrade`] or abort with
    /// [`Self::cancel_upgrade`].
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32) {
        Self::check_admin(&env);

        let current_version = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);
        if new_version <= current_version {
            env.panic_with_error(ReserveTrackerError::InvalidVersion);
        }

        let eligible_at = env
            .ledger()
            .timestamp()
            .checked_add(UPGRADE_TIMELOCK_SECONDS)
            .expect("Overflow in upgrade timelock calculation");

        env.storage()
            .instance()
            .set(&DATA_KEY.pending_upgrade_wasm, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_upgrade_version, &new_version);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_upgrade_eligible_at, &eligible_at);
    }

    /// Execute a previously proposed upgrade once its timelock has elapsed,
    /// swapping in the staged WASM, running migrations and bumping the version
    /// (admin only). Panics if none is pending or the timelock is still active.
    pub fn execute_upgrade(env: Env) {
        Self::check_admin(&env);

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade_wasm)
            .unwrap_or_else(|| env.panic_with_error(ReserveTrackerError::NoPendingUpgrade));
        let new_version: u32 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade_version)
            .unwrap_or_else(|| env.panic_with_error(ReserveTrackerError::NoPendingUpgrade));
        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(ReserveTrackerError::TimelockNotElapsed);
        }

        let current_version = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);

        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_wasm);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_version);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_eligible_at);

        env.deployer().update_current_contract_wasm(wasm_hash);

        for v in current_version..new_version {
            match v {
                0 => shared::migrate_v0_to_v1(&env),
                _ => {}
            }
        }

        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &new_version);
    }

    /// Cancel a pending upgrade, clearing the staged WASM hash, version and
    /// timelock (admin only).
    pub fn cancel_upgrade(env: Env) {
        Self::check_admin(&env);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_wasm);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_version);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_eligible_at);
    }

    // -----------------------------------------------------------------------
    // Reserve management (admin only)
    // -----------------------------------------------------------------------

    /// Replace all stored reserves with an empty map (admin only).
    ///
    /// Requires admin authorisation.  Without the auth gate any caller could
    /// wipe the reserves map, making verify_reserves trivially pass (empty
    /// reserves → zero total_reserve_usd → ratio check skipped when supply is
    /// also zero).  This function is intentionally destructive and should only
    /// be used for emergency recovery or contract reset by the admin.
    pub fn reset_reserves(env: Env) {
        Self::check_admin(&env);
        let empty: Map<CurrencyCode, ReserveData> = Map::new(&env);
        env.storage().instance().set(&DATA_KEY.reserves, &empty);
    }

    // -----------------------------------------------------------------------
    // Currency list management (admin only)
    // -----------------------------------------------------------------------

    /// Add a currency to the tracked list. Panics with `DuplicateCurrency` if
    /// the currency is already present, preventing double-counting of reserves.
    pub fn add_currency(env: Env, currency: CurrencyCode) {
        Self::check_admin(&env);
        let mut currencies: Vec<CurrencyCode> = env
            .storage()
            .instance()
            .get(&DATA_KEY.currencies)
            .unwrap_or(Vec::new(&env));
        for c in currencies.iter() {
            if c == currency {
                env.panic_with_error(ReserveTrackerError::DuplicateCurrency);
            }
        }
        currencies.push_back(currency);
        env.storage()
            .instance()
            .set(&DATA_KEY.currencies, &currencies);
    }

    /// Return the list of tracked currencies.
    pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
        env.storage()
            .instance()
            .get(&DATA_KEY.currencies)
            .unwrap_or(Vec::new(&env))
    }

    // -----------------------------------------------------------------------
    // Dependency address updaters (admin only)
    // -----------------------------------------------------------------------

    /// Update the oracle contract address (admin only).
    pub fn update_oracle(env: Env, new_oracle: Address) {
        Self::check_admin(&env);
        env.storage().instance().set(&DATA_KEY.oracle, &new_oracle);
    }

    /// Update the ACBU token contract address (admin only).
    pub fn update_acbu_token(env: Env, new_acbu_token: Address) {
        Self::check_admin(&env);
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &new_acbu_token);
    }

    // -----------------------------------------------------------------------
    // Two-step admin rotation
    //
    // Mirrors the oracle's pattern: the current admin nominates a successor and
    // starts a timelock; the successor must explicitly accept after the timelock
    // elapses; the current admin can cancel a pending transfer at any time. This
    // prevents a single fat-fingered or compromised key from being unrecoverable.
    // -----------------------------------------------------------------------

    /// Step 1 — current admin nominates `new_admin` and starts the timelock.
    /// The current admin keeps full authority until `accept_admin` completes.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        Self::check_admin(&env);
        let eligible_at = env.ledger().timestamp() + ADMIN_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_admin, &new_admin);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_admin_eligible_at, &eligible_at);
        let current_admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        env.events().publish(
            (symbol_short!("adm_init"),),
            (current_admin, new_admin, eligible_at),
        );
    }

    /// Step 2 — the nominated address claims ownership after the timelock.
    pub fn accept_admin(env: Env) {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(ReserveTrackerError::NoPendingAdmin));
        pending_admin.require_auth();

        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(ReserveTrackerError::AdminTimelockNotElapsed);
        }

        let old_admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        env.storage()
            .instance()
            .set(&DATA_KEY.admin, &pending_admin);
        env.storage().instance().remove(&DATA_KEY.pending_admin);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_admin_eligible_at);

        env.events().publish(
            (symbol_short!("adm_done"),),
            (old_admin, pending_admin, env.ledger().timestamp()),
        );
    }

    /// Cancel a pending transfer (current admin only).
    pub fn cancel_admin_transfer(env: Env) {
        Self::check_admin(&env);
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(ReserveTrackerError::NoPendingAdminToCancel));
        env.storage().instance().remove(&DATA_KEY.pending_admin);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_admin_eligible_at);
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        env.events().publish(
            (symbol_short!("adm_cncl"),),
            (admin, pending_admin, env.ledger().timestamp()),
        );
    }

    /// Current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DATA_KEY.admin).unwrap()
    }

    /// Check if the contract has been initialized.
    ///
    /// Backend services can call this before invoking other functions to avoid
    /// cryptic storage-not-found errors from uninitialized contracts.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&SharedDataKey::Version)
    }

    /// Pending successor, if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DATA_KEY.pending_admin)
    }

    /// Timestamp after which `accept_admin` becomes callable.
    pub fn get_pending_admin_eligible_at(env: Env) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    fn check_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
    }
}
