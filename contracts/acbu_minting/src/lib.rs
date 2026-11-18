#![no_std]
use core::fmt::{self, Display};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, vec, Address,
    Bytes, BytesN, Env, IntoVal, String as SorobanString, Symbol,
};

use shared::{
    calculate_amount_after_fee, calculate_fee, check_oracle_freshness, is_account_address,
    ContractPhase, CurrencyCode, DataKey as SharedDataKey, MintEvent, reentrancy_guard, BASIS_POINTS, CONTRACT_VERSION, DECIMALS,
    MAX_MINT_AMOUNT, MAX_TOTAL_SUPPLY, MIN_MINT_AMOUNT, ORACLE_GET_ACBU_RATE_WITH_TS,
    ORACLE_GET_BASKET_WEIGHT, ORACLE_GET_CURRENCIES, ORACLE_GET_RATE, ORACLE_GET_RATE_WITH_TS,
    ORACLE_GET_S_TOKEN_ADDR, RESERVE_IS_SUFFICIENT, UPDATE_INTERVAL_SECONDS,
};

#[allow(dead_code)]
pub mod token_contract {
    soroban_sdk::contractimport!(
        file = "../soroban_token_contract.wasm",
        sha256 = "6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    );
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementProof {
    pub proof_id: SorobanString,
    pub settled: bool,
    pub timestamp: u64,
}

/// Centralised storage key registry — all instance/persistent keys for this contract are
/// declared here so accidental key reuse or silent string-literal collisions can be caught
/// by reviewing a single place.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataKey {
    pub admin: Symbol,
    pub oracle: Symbol,
    pub reserve_tracker: Symbol,
    pub acbu_token: Symbol,
    pub usdc_token: Symbol,
    pub vault: Symbol,
    pub treasury: Symbol,
    pub fee_rate: Symbol,
    pub fee_single: Symbol,
    pub phase: Symbol,
    pub min_mint_amount: Symbol,
    pub max_mint_amount: Symbol,
    pub total_supply: Symbol,
    pub operator: Symbol,
    pub used_proofs: Symbol,
    pub processed_fintech_tx_ids: Symbol,
    pub max_supply: Symbol,
    pub max_drip: Symbol,
    pub pending_admin: Symbol,
    pub pending_admin_eligible_at: Symbol,
    /// Prefix for persistent per-proof replay-prevention keys: `(proof_prefix, proof_id)`.
    pub proof_prefix: Symbol,
    /// Monotonically increasing nonce used to generate unique transaction IDs.
    pub tx_nonce: Symbol,
}

const DATA_KEY: DataKey = DataKey {
    admin: symbol_short!("ADMIN"),
    oracle: symbol_short!("ORACLE"),
    reserve_tracker: symbol_short!("RES_TRK"),
    acbu_token: symbol_short!("ACBU_TKN"),
    usdc_token: symbol_short!("USDC_TKN"),
    vault: symbol_short!("VAULT"),
    treasury: symbol_short!("TRSY"),
    fee_rate: symbol_short!("FEE_RATE"),
    fee_single: symbol_short!("FEE_SGL"),
    phase: symbol_short!("PHASE"),
    min_mint_amount: symbol_short!("MIN_MINT"),
    max_mint_amount: symbol_short!("MAX_MINT"),
    total_supply: symbol_short!("SUPPLY"),
    operator: symbol_short!("OPERATOR"),
    used_proofs: symbol_short!("PROOFS"),
    processed_fintech_tx_ids: symbol_short!("FTX_IDS"),
    max_supply: symbol_short!("MAX_SUP"),
    max_drip: symbol_short!("MAX_DRIP"),
    pending_admin: symbol_short!("PEND_ADM"),
    pending_admin_eligible_at: symbol_short!("PA_ETA"),
    proof_prefix: symbol_short!("PRF_SET"),
    tx_nonce: symbol_short!("TX_NONCE"),
};

/// Admin rotation timelock: the pending admin must wait this long before
/// claiming ownership, giving the current admin a window to cancel a mistaken
/// or malicious transfer.
const ADMIN_TIMELOCK_SECONDS: u64 = 86_400;

// CONTRACT_VERSION is imported from shared

contractmeta!(key = "version", val = "1");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MintingError {
    AlreadyInitialized = 5001,
    InvalidFeeRate = 5002,
    InvalidMintAmount = 5003,
    InsufficientReserves = 5004,
    ProofAlreadyUsed = 5005,
    InvalidOracleRate = 5006,
    UnauthorizedOperator = 5007,
    DuplicateFintechTxId = 5008,
    InvalidDripAmount = 5009,
    DripExceedsCap = 5010,
    InsufficientDemoCustody = 5011,
    Paused = 5012,
    OracleStale = 5013,
    FintechTxIdEmpty = 5014,
    FintechTxIdTooShort = 5015,
    FintechTxIdTooLong = 5016,
    FintechTxIdInvalidChar = 5017,
    InvalidVersion = 5018,
    MaxSupplyExceeded = 5019,
    NoPendingAdmin = 5020,
    AdminTimelockNotElapsed = 5021,
    NoPendingAdminToCancel = 5022,
    InvalidRecipient = 5023,
    InvalidRoleSeparation = 5024,
    SupplyMismatch = 5025,
    NegativeSupply = 5027,
    /// The computed ACBU output is below the caller-supplied `min_acbu_out`
    /// floor, indicating that same-block oracle movement would cause unacceptable
    /// slippage. The transaction should be retried with updated parameters.
    SlippageExceeded = 5026,
    Unknown = 5999,
}

impl Display for MintingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::AlreadyInitialized => "minting contract already initialized",
            Self::InvalidFeeRate => "invalid fee rate",
            Self::InvalidMintAmount => "invalid mint amount",
            Self::InsufficientReserves => "insufficient reserves",
            Self::ProofAlreadyUsed => "proof already used",
            Self::InvalidOracleRate => "invalid oracle rate",
            Self::UnauthorizedOperator => "unauthorized operator",
            Self::DuplicateFintechTxId => "duplicate fintech transaction id",
            Self::InvalidDripAmount => "invalid drip amount",
            Self::DripExceedsCap => "drip exceeds cap",
            Self::InsufficientDemoCustody => "insufficient demo custody",
            Self::Paused => "minting contract is paused",
            Self::OracleStale => "oracle rate is stale",
            Self::FintechTxIdEmpty => "fintech transaction id is empty",
            Self::FintechTxIdTooShort => "fintech transaction id is too short",
            Self::FintechTxIdTooLong => "fintech transaction id is too long",
            Self::FintechTxIdInvalidChar => "fintech transaction id contains invalid characters",
            Self::InvalidVersion => "invalid contract version",
            Self::MaxSupplyExceeded => "maximum supply exceeded",
            Self::NoPendingAdmin => "no pending admin",
            Self::AdminTimelockNotElapsed => "admin timelock has not elapsed",
            Self::NoPendingAdminToCancel => "no pending admin to cancel",
            Self::InvalidRecipient => "invalid recipient",
            Self::InvalidRoleSeparation => "admin and operator must be different addresses",
            Self::SupplyMismatch => "supplied value does not match on-chain supply",
            Self::SlippageExceeded => "output below minimum: slippage exceeded",
            Self::NegativeSupply => "negative supply",
            Self::Unknown => "unknown minting error",
        };
        f.write_str(message)
    }
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MintingConfig {
    pub admin: Address,
    pub oracle: Address,
    pub reserve_tracker: Address,
    pub acbu_token: Address,
    pub usdc_token: Address,
    pub vault: Address,
    pub treasury: Address,
    pub fee_rate_bps: i128,
    pub fee_single_bps: i128,
    pub operator: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeRateUpdatedEvent {
    pub old_fee_rate_bps: i128,
    pub new_fee_rate_bps: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseEvent {
    pub admin: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OperatorUpdatedEvent {
    pub old_operator: Address,
    pub new_operator: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SupplySyncedEvent {
    pub old_supply: i128,
    pub new_supply: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MaxSupplyUpdatedEvent {
    pub old_max_supply: i128,
    pub new_max_supply: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AddressUpdatedEvent {
    pub old_address: Address,
    pub new_address: Address,
    pub timestamp: u64,
}

#[contract]
pub struct MintingContract;

#[contractimpl]
impl MintingContract {
    /// Initialize the minting contract.
    /// `fee_rate_bps` applies to basket and USDC paths; `fee_single_bps` to single S-token deposits (typically higher).
    pub fn initialize(env: Env, config: MintingConfig) {
        if env.storage().instance().has(&DATA_KEY.admin) {
            env.panic_with_error(MintingError::AlreadyInitialized);
        }

        if config.admin == config.operator {
            env.panic_with_error(MintingError::InvalidRoleSeparation);
        }

        if !(0..=BASIS_POINTS).contains(&config.fee_rate_bps)
            || !(0..=BASIS_POINTS).contains(&config.fee_single_bps)
        {
            env.panic_with_error(MintingError::InvalidFeeRate);
        }

        env.storage().instance().set(&DATA_KEY.admin, &config.admin);
        env.storage().instance().set(&DATA_KEY.oracle, &config.oracle);
        env.storage()
            .instance()
            .set(&DATA_KEY.reserve_tracker, &config.reserve_tracker);
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &config.acbu_token);
        env.storage()
            .instance()
            .set(&DATA_KEY.usdc_token, &config.usdc_token);
        env.storage().instance().set(&DATA_KEY.vault, &config.vault);
        env.storage().instance().set(&DATA_KEY.treasury, &config.treasury);
        env.storage()
            .instance()
            .set(&DATA_KEY.fee_rate, &config.fee_rate_bps);
        env.storage()
            .instance()
            .set(&DATA_KEY.fee_single, &config.fee_single_bps);
        env.storage().instance().set(&DATA_KEY.operator, &config.operator);
        env.storage().instance().set(&DATA_KEY.phase, &ContractPhase::Active);
        env.storage()
            .instance()
            .set(&DATA_KEY.min_mint_amount, &MIN_MINT_AMOUNT);
        env.storage()
            .instance()
            .set(&DATA_KEY.max_mint_amount, &MAX_MINT_AMOUNT);
        env.storage().instance().set(&DATA_KEY.total_supply, &0i128);
        env.storage()
            .instance()
            .set(&DATA_KEY.max_supply, &MAX_TOTAL_SUPPLY);
        env.storage()
            .instance()
            .set(&DATA_KEY.max_drip, &100_000_000_000_000i128);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &CONTRACT_VERSION);
    }

    /// Mint ACBU from USDC deposit (unchanged reserve/oracle flow).
    ///
    /// `min_acbu_out` is an optional slippage guard: if the computed ACBU amount
    /// is below this value the transaction reverts with `SlippageExceeded`.
    /// Pass `None` to disable the check (backwards-compatible default).
    pub fn mint_from_usdc(
        env: Env,
        user: Address,
        usdc_amount: i128,
        recipient: Address,
        min_acbu_out: Option<i128>,
    ) -> i128 {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);
        user.require_auth();
        // C-058: reject contract-type recipients — minting to a contract address
        // that has no token-receipt logic would permanently strand the funds.
        Self::assert_recipient_is_account(&recipient);
        env.storage().instance().extend_ttl(5184000, 5184000);

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_mint_amount)
            .unwrap();
        let max_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_mint_amount)
            .unwrap();

        if usdc_amount < min_amount || usdc_amount > max_amount {
            env.panic_with_error(MintingError::InvalidMintAmount);
        }

        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let usdc_token: Address = env.storage().instance().get(&DATA_KEY.usdc_token).unwrap();
        let fee_rate: i128 = env.storage().instance().get(&DATA_KEY.fee_rate).unwrap();
        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();
        let mut total_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0);

        // Get ACBU rate with timestamp and validate oracle freshness
        let (acbu_rate, oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        let usdc_after_fee = calculate_amount_after_fee(usdc_amount, fee_rate);
        let acbu_amount = usdc_after_fee
            .checked_mul(DECIMALS)
            .and_then(|v| v.checked_div(acbu_rate))
            .unwrap_or_else(|| env.panic_with_error(MintingError::InvalidMintAmount));

        // Slippage guard: reject if computed output is below caller's minimum.
        if let Some(floor) = min_acbu_out {
            if acbu_amount < floor {
                env.panic_with_error(MintingError::SlippageExceeded);
            }
        }

        let projected_supply = total_supply
            .checked_add(acbu_amount)
            .expect("Overflow in projected supply calculation");
        Self::check_supply_cap(&env, projected_supply);
        let reserve_ok: bool = env.invoke_contract(
            &reserve_tracker_addr,
            &Symbol::new(&env, RESERVE_IS_SUFFICIENT),
            vec![&env, projected_supply.into_val(&env)],
        );
        if !reserve_ok {
            env.panic_with_error(MintingError::InsufficientReserves);
        }

        total_supply += acbu_amount;
        env.storage()
            .instance()
            .set(&DATA_KEY.total_supply, &total_supply);

        let usdc_client = soroban_sdk::token::Client::new(&env, &usdc_token);
        usdc_client.transfer(&user, &env.current_contract_address(), &usdc_amount);

        // C-038: `StellarAssetClient::mint` requires this contract to be the
        // issuer or an authorized minter on the ACBU Stellar Asset Contract.
        // The Soroban auth tree for this call is: admin/issuer → minting_contract.
        // If this contract is not the SAC minter the call will revert.
        let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
        acbu_sac.mint(&recipient, &acbu_amount);

        let fee = calculate_fee(usdc_amount, fee_rate);

        let tx_id = generate_unique_tx_id(&env, &recipient, acbu_amount, "mint_usdc");
        let mint_event = MintEvent {
            transaction_id: tx_id,
            user: recipient.clone(),
            usdc_amount,
            acbu_amount,
            fee,
            rate: acbu_rate,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("mint"), recipient), mint_event);

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);

        acbu_amount
    }

    /// Mint ACBU by depositing Afreum-style S-tokens in full basket proportions (lower fee tier).
    /// Pulls each S-token from `user` into `vault` per oracle weights and rates.
    pub fn mint_from_basket(
        env: Env,
        user: Address,
        recipient: Address,
        acbu_amount: i128,
        proof_id: SorobanString,
    ) -> i128 {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);
        user.require_auth();
        // C-058: reject contract-type recipients — minting to a contract address
        // that has no token-receipt logic would permanently strand the funds.
        Self::assert_recipient_is_account(&recipient);

        if !check_proof_unused(&env, &proof_id) {
            env.panic_with_error(MintingError::ProofAlreadyUsed);
        }
        env.storage().instance().extend_ttl(5184000, 5184000);

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_mint_amount)
            .unwrap();
        let max_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_mint_amount)
            .unwrap();
        if acbu_amount < min_amount || acbu_amount > max_amount {
            env.panic_with_error(MintingError::InvalidMintAmount);
        }

        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let fee_rate: i128 = env.storage().instance().get(&DATA_KEY.fee_rate).unwrap();
        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();
        let vault: Address = env.storage().instance().get(&DATA_KEY.vault).unwrap();
        let treasury: Address = env.storage().instance().get(&DATA_KEY.treasury).unwrap();
        let mut total_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0);

        // Get ACBU rate with timestamp and validate oracle freshness
        let (acbu_rate, oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        let fee_acbu = calculate_fee(acbu_amount, fee_rate);
        let net_mint = acbu_amount
            .checked_sub(fee_acbu)
            .expect("Underflow in net mint calculation");
        let projected_supply = total_supply
            .checked_add(acbu_amount)
            .expect("Overflow in projected supply calculation");
        Self::check_supply_cap(&env, projected_supply);

        let reserve_ok: bool = env.invoke_contract(
            &reserve_tracker_addr,
            &Symbol::new(&env, RESERVE_IS_SUFFICIENT),
            vec![&env, projected_supply.into_val(&env)],
        );
        if !reserve_ok {
            env.panic_with_error(MintingError::InsufficientReserves);
        }

        let currencies: soroban_sdk::Vec<CurrencyCode> = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_CURRENCIES),
            vec![&env],
        );
        if currencies.len() > 10 {
            env.panic_with_error(MintingError::InvalidRecipient);
        }

        let usd_total: i128 = acbu_amount
            .checked_mul(acbu_rate)
            .and_then(|v| v.checked_div(DECIMALS))
            .expect("Overflow in usd total calculation");

        // CEI: Update state before external calls
        total_supply += acbu_amount;
        env.storage()
            .instance()
            .set(&DATA_KEY.total_supply, &total_supply);

        for currency in currencies.iter() {
            let weight: i128 = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, ORACLE_GET_BASKET_WEIGHT),
                vec![&env, currency.clone().into_val(&env)],
            );
            if weight == 0 {
                continue;
            }

            let rate: i128 = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, ORACLE_GET_RATE),
                vec![&env, currency.clone().into_val(&env)],
            );
            if rate == 0 {
                env.panic_with_error(MintingError::InvalidOracleRate);
            }

            let stoken: Address = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, ORACLE_GET_S_TOKEN_ADDR),
                vec![&env, currency.clone().into_val(&env)],
            );

            let usd_i = weight
                .checked_mul(usd_total)
                .and_then(|v| v.checked_div(BASIS_POINTS))
                .expect("Overflow in usd_i calculation");
            let native_i = usd_i
                .checked_mul(DECIMALS)
                .and_then(|v| v.checked_div(rate))
                .expect("Overflow in native_i calculation");
            if native_i > 0 {
                // C-038: `transfer` pulls S-tokens from `user` into `vault`.
                // This requires `user` to have pre-approved this contract as a
                // spender (via `approve`) OR for the token to accept the
                // invoking contract in the auth tree.  `user.require_auth()`
                // above satisfies the Soroban auth propagation requirement.
                let token = soroban_sdk::token::Client::new(&env, &stoken);
                token.transfer(&user, &vault, &native_i);
            }
        }

        // C-038: `StellarAssetClient::mint` requires this contract to be the
        // issuer or an authorized minter on the ACBU Stellar Asset Contract.
        // The Soroban auth tree for this call is: admin/issuer → minting_contract.
        // If this contract is not the SAC minter the call will revert.
        let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
        acbu_sac.mint(&recipient, &net_mint);
        if fee_acbu > 0 {
            acbu_sac.mint(&treasury, &fee_acbu);
        }

        let tx_id = generate_unique_tx_id(&env, &recipient, net_mint, "mint_basket");
        let mint_event = MintEvent {
            transaction_id: tx_id,
            user: recipient.clone(),
            usdc_amount: usd_total,
            acbu_amount: net_mint,
            fee: fee_acbu,
            rate: acbu_rate,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("mint"), recipient), mint_event);

        // Seal the proof so it cannot be replayed (fixes the check_proof_unused guard above).
        mark_proof_used(&env, &proof_id);

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);

        acbu_amount
    }

    /// Single S-token deposit: Afreum ramp delivers one S-token; fee tier is `fee_single_bps`.
    /// On-chain DEX rebalancing into the full basket is orchestrated off-chain or in a future release;
    /// this entrypoint only prices the deposit and credits ACBU from oracle rates.
    pub fn mint_from_single(
        env: Env,
        user: Address,
        recipient: Address,
        currency: CurrencyCode,
        s_token_amount: i128,
    ) -> i128 {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);
        user.require_auth();
        // C-058: reject contract-type recipients — minting to a contract address
        // that has no token-receipt logic would permanently strand the funds.
        Self::assert_recipient_is_account(&recipient);
        env.storage().instance().extend_ttl(5184000, 5184000);

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_mint_amount)
            .unwrap();
        let max_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_mint_amount)
            .unwrap();

        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();
        let vault: Address = env.storage().instance().get(&DATA_KEY.vault).unwrap();
        let fee_single: i128 = env.storage().instance().get(&DATA_KEY.fee_single).unwrap();
        let mut total_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0);

        let expected_stoken: Address = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_S_TOKEN_ADDR),
            vec![&env, currency.clone().into_val(&env)],
        );

        // Get ACBU rate with timestamp and validate oracle freshness
        let (acbu_rate, oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        let (rate, rate_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
            vec![&env, currency.clone().into_val(&env)],
        );
        if !check_oracle_freshness(&env, rate_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        if rate == 0 {
            env.panic_with_error(MintingError::InvalidOracleRate);
        }

        let usd_gross = s_token_amount
            .checked_mul(rate)
            .and_then(|v| v.checked_div(DECIMALS))
            .expect("Overflow in usd_gross calculation");
        if usd_gross < min_amount || usd_gross > max_amount {
            env.panic_with_error(MintingError::InvalidMintAmount);
        }

        let usd_after_fee = calculate_amount_after_fee(usd_gross, fee_single);
        let acbu_amount = usd_after_fee
            .checked_mul(DECIMALS)
            .and_then(|v| v.checked_div(acbu_rate))
            .expect("Overflow in acbu amount calculation");

        let projected_supply = total_supply
            .checked_add(acbu_amount)
            .expect("Overflow in projected supply calculation");
        Self::check_supply_cap(&env, projected_supply);
        let reserve_ok: bool = env.invoke_contract(
            &reserve_tracker_addr,
            &Symbol::new(&env, RESERVE_IS_SUFFICIENT),
            vec![&env, projected_supply.into_val(&env)],
        );
        if !reserve_ok {
            env.panic_with_error(MintingError::InsufficientReserves);
        }

        // CEI: Update state before external calls
        total_supply += acbu_amount;
        env.storage()
            .instance()
            .set(&DATA_KEY.total_supply, &total_supply);

        let token = soroban_sdk::token::Client::new(&env, &expected_stoken);
        token.transfer(&user, &vault, &s_token_amount);

        let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
        acbu_sac.mint(&recipient, &acbu_amount);

        let fee = calculate_fee(usd_gross, fee_single);
        let tx_id = generate_unique_tx_id(&env, &recipient, acbu_amount, "mint_single");
        let mint_event = MintEvent {
            transaction_id: tx_id,
            user: recipient.clone(),
            usdc_amount: usd_gross,
            acbu_amount,
            fee,
            rate: acbu_rate,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("mint"), recipient), mint_event);

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);

        acbu_amount
    }

    /// Custodial demo-fiat mint: `operator` (backend key) authorizes; pulls S-token from **this
    /// contract's balance** (pre-funded demo SAC supply) into `vault`, then mints ACBU to
    /// `recipient` using the same pricing as [`Self::mint_from_single`].
    pub fn mint_from_demo_fiat(
        env: Env,
        operator: Address,
        recipient: Address,
        currency: CurrencyCode,
        fiat_amount: i128,
        proof_id: SorobanString,
    ) -> i128 {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);
        let expected_operator: Address = Self::get_operator(env.clone());
        if operator != expected_operator {
            env.panic_with_error(MintingError::UnauthorizedOperator);
        }
        operator.require_auth();
        // C-058: reject contract-type recipients — minting to a contract address
        // that has no token-receipt logic would permanently strand the funds.
        Self::assert_recipient_is_account(&recipient);
        env.storage().instance().extend_ttl(5184000, 5184000);

        if !check_proof_unused(&env, &proof_id) {
            env.panic_with_error(MintingError::ProofAlreadyUsed);
        }

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_mint_amount)
            .unwrap();
        let max_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_mint_amount)
            .unwrap();

        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();
        let vault: Address = env.storage().instance().get(&DATA_KEY.vault).unwrap();
        let fee_single: i128 = env.storage().instance().get(&DATA_KEY.fee_single).unwrap();
        let mut total_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0);

        let expected_stoken: Address = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_S_TOKEN_ADDR),
            vec![&env, currency.clone().into_val(&env)],
        );

        // Get ACBU rate with timestamp and validate oracle freshness
        let (acbu_rate, oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        let (rate, rate_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
            vec![&env, currency.clone().into_val(&env)],
        );
        if !check_oracle_freshness(&env, rate_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        let usd_gross = fiat_amount
            .checked_mul(rate)
            .and_then(|v| v.checked_div(DECIMALS))
            .expect("Overflow in usd_gross calculation");
        if usd_gross < min_amount || usd_gross > max_amount {
            env.panic_with_error(MintingError::InvalidMintAmount);
        }

        let usd_after_fee = calculate_amount_after_fee(usd_gross, fee_single);
        let acbu_amount = usd_after_fee
            .checked_mul(DECIMALS)
            .and_then(|v| v.checked_div(acbu_rate))
            .expect("Overflow in acbu amount calculation");

        let projected_supply = total_supply
            .checked_add(acbu_amount)
            .expect("Overflow in projected supply calculation");
        Self::check_supply_cap(&env, projected_supply);
        let reserve_ok: bool = env.invoke_contract(
            &reserve_tracker_addr,
            &Symbol::new(&env, RESERVE_IS_SUFFICIENT),
            vec![&env, projected_supply.into_val(&env)],
        );
        if !reserve_ok {
            env.panic_with_error(MintingError::InsufficientReserves);
        }

        // CEI: Update state before external calls
        total_supply += acbu_amount;
        env.storage()
            .instance()
            .set(&DATA_KEY.total_supply, &total_supply);

        let custody = env.current_contract_address();
        let token = soroban_sdk::token::Client::new(&env, &expected_stoken);
        token.transfer(&custody, &vault, &fiat_amount);

        let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
        acbu_sac.mint(&recipient, &acbu_amount);

        let fee = calculate_fee(usd_gross, fee_single);
        let tx_id = generate_unique_tx_id(&env, &recipient, acbu_amount, "mint_demo");
        let mint_event = MintEvent {
            transaction_id: tx_id,
            user: recipient.clone(),
            usdc_amount: usd_gross,
            acbu_amount,
            fee,
            rate: acbu_rate,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("mint"), recipient), mint_event);

        // Seal the proof so it cannot be replayed (fixes the check_proof_unused guard above).
        mark_proof_used(&env, &proof_id);

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);

        acbu_amount
    }

    /// Fintech-partner fiat mint: operator (fintech backend) authorizes; validates fintech_tx_id
    /// to prevent duplicate minting. Requires both operator authorization and valid fintech transaction.
    /// This function enforces strict access control: only the operator (fintech partner) can call it.
    pub fn mint_from_fiat(
        env: Env,
        operator: Address,
        recipient: Address,
        currency: CurrencyCode,
        fiat_amount: i128,
        fintech_tx_id: SorobanString,
    ) -> i128 {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);
        let expected_operator: Address = Self::get_operator(env.clone());

        // Strict access control: only operator (fintech backend) can call
        if operator != expected_operator {
            env.panic_with_error(MintingError::UnauthorizedOperator);
        }
        operator.require_auth();

        // C-058: reject contract-type recipients — minting to a contract address
        // that has no token-receipt logic would permanently strand the funds.
        Self::assert_recipient_is_account(&recipient);

        // C-039: Strict input validation — enforce length bounds and charset
        // before touching any storage, so garbage IDs are rejected cheaply.
        validate_fintech_tx_id(&env, &fintech_tx_id);
        let normalized_tx_id = normalize_fintech_tx_id(&env, &fintech_tx_id);
        env.storage().instance().extend_ttl(5184000, 5184000);

        // Check if fintech_tx_id has already been processed
        let mut processed_ids: soroban_sdk::Map<SorobanString, bool> = env
            .storage()
            .instance()
            .get(&DATA_KEY.processed_fintech_tx_ids)
            .unwrap_or_else(|| soroban_sdk::map![&env]);

        if processed_ids.contains_key(normalized_tx_id.clone()) {
            env.panic_with_error(MintingError::DuplicateFintechTxId);
        }

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_mint_amount)
            .unwrap();
        let max_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_mint_amount)
            .unwrap();

        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();
        // C-038: `mint_from_fiat` never moves on-chain custody funds — the fiat
        // deposit is validated and settled off-chain by the fintech partner —
        // so unlike the other mint paths there is no vault transfer to route,
        // and the vault address does not need to be loaded here.
        let fee_rate: i128 = env.storage().instance().get(&DATA_KEY.fee_rate).unwrap();
        let treasury: Address = env.storage().instance().get(&DATA_KEY.treasury).unwrap();
        let mut total_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0);

        // C-038: Use timestamped oracle reads and enforce freshness on every
        // cross-contract rate call so a stale feed cannot be exploited to mint
        // ACBU at an incorrect price.
        let (acbu_rate, acbu_oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, acbu_oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        let (rate, rate_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
            vec![&env, currency.clone().into_val(&env)],
        );
        if !check_oracle_freshness(&env, rate_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(MintingError::OracleStale);
        }

        if rate == 0 {
            env.panic_with_error(MintingError::InvalidOracleRate);
        }

        let usd_gross = fiat_amount
            .checked_mul(rate)
            .and_then(|v| v.checked_div(DECIMALS))
            .expect("Overflow in usd_gross calculation");
        if usd_gross < min_amount || usd_gross > max_amount {
            env.panic_with_error(MintingError::InvalidMintAmount);
        }

        let usd_after_fee = calculate_amount_after_fee(usd_gross, fee_rate);
        let acbu_amount = usd_after_fee
            .checked_mul(DECIMALS)
            .and_then(|v| v.checked_div(acbu_rate))
            .expect("Overflow in acbu amount calculation");

        let projected_supply = total_supply
            .checked_add(acbu_amount)
            .expect("Overflow in projected supply calculation");
        Self::check_supply_cap(&env, projected_supply);
        let reserve_ok: bool = env.invoke_contract(
            &reserve_tracker_addr,
            &Symbol::new(&env, RESERVE_IS_SUFFICIENT),
            vec![&env, projected_supply.into_val(&env)],
        );
        if !reserve_ok {
            env.panic_with_error(MintingError::InsufficientReserves);
        }

        // For mint_from_fiat, fiat deposit is handled off-chain by the fintech partner.
        // No on-chain token transfer needed; fintech validates and deposits fiat in their system.

        total_supply += acbu_amount;
        env.storage()
            .instance()
            .set(&DATA_KEY.total_supply, &total_supply);

        let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
        acbu_sac.mint(&recipient, &acbu_amount);

        let fee = calculate_fee(usd_gross, fee_rate);
        if fee > 0 {
            acbu_sac.mint(&treasury, &fee);
        }

        // Mark fintech_tx_id as processed to prevent duplicate minting
        processed_ids.set(normalized_tx_id.clone(), true);
        env.storage()
            .instance()
            .set(&DATA_KEY.processed_fintech_tx_ids, &processed_ids);

        let mint_event = MintEvent {
            transaction_id: normalized_tx_id,
            user: recipient.clone(),
            usdc_amount: usd_gross,
            acbu_amount,
            fee,
            rate: acbu_rate,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("mint"), recipient), mint_event);

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);

        acbu_amount
    }

    /// Transfer a basket S-token from this contract's custodial balance to
    /// `recipient` (e.g. user faucet). Admin only; caps per call to limit abuse.
    ///
    /// FIX(#330): Accepts an explicit `recipient` address so the admin can seed
    /// test user accounts in one transaction, instead of dripping to themselves
    /// and relaying in a second call.
    ///
    /// FIX(#327): This is an admin-only entry point, fully isolated from
    /// `mint_from_fiat`. It requires admin auth (not operator auth), enforces
    /// the reentrancy guard and paused check, and does NOT mint ACBU — it only
    /// moves pre-funded S-tokens from custody to a recipient.
    pub fn admin_drip_fiat(
        env: Env,
        recipient: Address,
        currency: CurrencyCode,
        amount: i128,
    ) {
        reentrancy_guard::acquire_guard(&env);
        Self::check_paused(&env);

        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();

        // C-058: reject contract-type recipients to prevent stranded token transfers.
        Self::assert_recipient_is_account(&recipient);
        if amount <= 0 {
            env.panic_with_error(MintingError::InvalidDripAmount);
        }
        env.storage().instance().extend_ttl(5184000, 5184000);
        let max_drip: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_drip)
            .unwrap_or(100_000_000_000_000i128);
        if amount > max_drip {
            env.panic_with_error(MintingError::DripExceedsCap);
        }

        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let stoken: Address = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_S_TOKEN_ADDR),
            vec![&env, currency.clone().into_val(&env)],
        );
        let custody = env.current_contract_address();
        let token = soroban_sdk::token::Client::new(&env, &stoken);
        let custody_balance = token.balance(&custody);
        if custody_balance < amount {
            env.panic_with_error(MintingError::InsufficientDemoCustody);
        }
        token.transfer(&custody, &recipient, &amount);

        reentrancy_guard::release_guard(&env);
    }

    /// Return the operator address (the key authorized to sign day-to-day mint
    /// requests). Falls back to the admin address if no separate operator is set.
    pub fn get_operator(env: Env) -> Address {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        env.storage()
            .instance()
            .get(&DATA_KEY.operator)
            .unwrap_or(admin)
    }

    /// Set the operator address (admin only). The operator must differ from the
    /// admin to preserve role separation, otherwise it reverts with
    /// `InvalidRoleSeparation`.
    pub fn set_operator(env: Env, new_operator: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        if admin == new_operator {
            env.panic_with_error(MintingError::InvalidRoleSeparation);
        }
        let old_operator: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.operator)
            .unwrap_or_else(|| admin.clone());
        env.storage()
            .instance()
            .set(&DATA_KEY.operator, &new_operator);
        let event = OperatorUpdatedEvent {
            old_operator,
            new_operator,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("op_upd"),), event);
    }

    /// Overwrite the tracked total ACBU supply with `new_supply` (admin only).
    ///
    /// Used to reconcile the contract's supply counter with the actual on-chain
    /// token supply. Reverts if paused, if `new_supply` exceeds the max supply,
    /// or if `new_supply` does not match the ACBU token's actual on-chain
    /// `total_supply()`.
    pub fn sync_supply(env: Env, new_supply: i128) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::check_paused(&env);

        // SC-035 (1): reject negative values — supply can never be below zero.
        if new_supply < 0 {
            env.panic_with_error(MintingError::NegativeSupply);
        }

        // SC-035 (2): cross-check against the token contract's on-chain
        // total_supply so the minting contract's internal counter stays in sync
        // with the actual circulating supply.
        //
        // C-036: `soroban_sdk::token::Client` (the SEP-41 interface) does not
        // expose `total_supply()`, so the on-chain value is read via
        // `invoke_contract` against the token's `TOKEN_GET_TOTAL_SUPPLY` entry
        // point instead.
        Self::check_supply_cap(&env, new_supply);

        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let on_chain_supply: i128 = env.invoke_contract(
            &acbu_token,
            &Symbol::new(&env, shared::TOKEN_GET_TOTAL_SUPPLY),
            vec![&env],
        );
        if new_supply != on_chain_supply {
            env.panic_with_error(MintingError::SupplyMismatch);
        }

        let old_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DATA_KEY.total_supply, &new_supply);
        let event = SupplySyncedEvent {
            old_supply,
            new_supply,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("sup_sync"),), event);
    }

    /// Return the current tracked total ACBU supply (7 decimals).
    pub fn get_total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DATA_KEY.total_supply)
            .unwrap_or(0)
    }

    /// Return the maximum ACBU supply cap (defaults to [`MAX_TOTAL_SUPPLY`]).
    pub fn get_max_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DATA_KEY.max_supply)
            .unwrap_or(MAX_TOTAL_SUPPLY)
    }

    /// Set the maximum ACBU supply cap (admin only). Reverts if paused.
    pub fn set_max_supply(env: Env, new_max_supply: i128) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::check_paused(&env);
        let old_max_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_supply)
            .unwrap_or(MAX_TOTAL_SUPPLY);
        env.storage()
            .instance()
            .set(&DATA_KEY.max_supply, &new_max_supply);
        let event = MaxSupplyUpdatedEvent {
            old_max_supply,
            new_max_supply,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("max_sup"),), event);
    }

    pub fn get_max_drip(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DATA_KEY.max_drip)
            .unwrap_or(100_000_000_000_000i128)
    }

    pub fn set_max_drip(env: Env, new_max_drip: i128) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::check_paused(&env);
        if new_max_drip < 0 {
            env.panic_with_error(MintingError::InvalidDripAmount);
        }
        env.storage()
            .instance()
            .set(&DATA_KEY.max_drip, &new_max_drip);
    }

    fn check_supply_cap(env: &Env, projected_supply: i128) {
        let max_supply: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.max_supply)
            .unwrap_or(MAX_TOTAL_SUPPLY);
        if projected_supply > max_supply {
            env.panic_with_error(MintingError::MaxSupplyExceeded);
        }
    }

    /// Pause the contract, disabling all minting operations (admin only).
    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DATA_KEY.phase, &ContractPhase::Paused);
        let event = PauseEvent {
            admin,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("paused"),), event);
    }

    /// Unpause the contract, re-enabling minting operations (admin only).
    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DATA_KEY.phase, &ContractPhase::Active);
        let event = PauseEvent {
            admin,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("unpaused"),), event);
    }

    /// Set the basket/USDC mint fee in basis points (admin only).
    ///
    /// Reverts if paused or `fee_rate_bps` is outside `0..=BASIS_POINTS`. Emits a
    /// `FeeRateUpdatedEvent`.
    pub fn set_fee_rate(env: Env, fee_rate_bps: i128) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::check_paused(&env);
        if !(0..=BASIS_POINTS).contains(&fee_rate_bps) {
            env.panic_with_error(MintingError::InvalidFeeRate);
        }
        let old_fee_rate: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.fee_rate)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DATA_KEY.fee_rate, &fee_rate_bps);
        let event = FeeRateUpdatedEvent {
            old_fee_rate_bps: old_fee_rate,
            new_fee_rate_bps: fee_rate_bps,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("fee_upd"),), event);
    }

    /// Set the single-currency mint fee in basis points (admin only).
    ///
    /// Reverts if paused or `fee_single_bps` is outside `0..=BASIS_POINTS`. Emits a
    /// `FeeRateUpdatedEvent`.
    pub fn set_fee_single(env: Env, fee_single_bps: i128) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::check_paused(&env);
        if !(0..=BASIS_POINTS).contains(&fee_single_bps) {
            env.panic_with_error(MintingError::InvalidFeeRate);
        }
        let old_fee_single: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.fee_single)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DATA_KEY.fee_single, &fee_single_bps);
        let event = FeeRateUpdatedEvent {
            old_fee_rate_bps: old_fee_single,
            new_fee_rate_bps: fee_single_bps,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("fee_sgl"),), event);
    }

    /// Return the basket/USDC mint fee in basis points.
    pub fn get_fee_rate(env: Env) -> i128 {
        env.storage().instance().get(&DATA_KEY.fee_rate).unwrap()
    }

    /// Return the single-currency mint fee in basis points.
    pub fn get_fee_single(env: Env) -> i128 {
        env.storage().instance().get(&DATA_KEY.fee_single).unwrap()
    }

    /// Return `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        let phase: ContractPhase = env
            .storage()
            .instance()
            .get(&DATA_KEY.phase)
            .unwrap_or(ContractPhase::Uninitialized);
        phase == ContractPhase::Paused
    }

    // ── Dependency address updaters (admin only) ──────────────────────────

    /// Update the oracle contract address (admin only).
    pub fn update_oracle(env: Env, new_oracle: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let old_oracle: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        env.storage().instance().set(&DATA_KEY.oracle, &new_oracle);
        let event = AddressUpdatedEvent {
            old_address: old_oracle,
            new_address: new_oracle,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("upd_orcl"),), event);
    }

    /// Update the reserve tracker contract address (admin only).
    pub fn update_reserve_tracker(env: Env, new_reserve_tracker: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let old_reserve_tracker: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();
        env.storage()
            .instance()
            .set(&DATA_KEY.reserve_tracker, &new_reserve_tracker);
        let event = AddressUpdatedEvent {
            old_address: old_reserve_tracker,
            new_address: new_reserve_tracker,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("upd_res"),), event);
    }

    /// Update the ACBU token contract address (admin only).
    pub fn update_acbu_token(env: Env, new_acbu_token: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let old_acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &new_acbu_token);
        let event = AddressUpdatedEvent {
            old_address: old_acbu_token,
            new_address: new_acbu_token,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("upd_acbu"),), event);
    }

    /// Update the vault contract address (admin only).
    pub fn update_vault(env: Env, new_vault: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let old_vault: Address = env.storage().instance().get(&DATA_KEY.vault).unwrap();
        env.storage().instance().set(&DATA_KEY.vault, &new_vault);
        let event = AddressUpdatedEvent {
            old_address: old_vault,
            new_address: new_vault,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("upd_vlt"),), event);
    }

    /// Update the treasury address that receives collected fees (admin only).
    pub fn update_treasury(env: Env, new_treasury: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let old_treasury: Address = env.storage().instance().get(&DATA_KEY.treasury).unwrap();
        env.storage()
            .instance()
            .set(&DATA_KEY.treasury, &new_treasury);
        let event = AddressUpdatedEvent {
            old_address: old_treasury,
            new_address: new_treasury,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("upd_trsy"),), event);
    }

    /// Update the USDC token contract address (admin only).
    pub fn update_usdc_token(env: Env, new_usdc_token: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let old_usdc_token: Address = env.storage().instance().get(&DATA_KEY.usdc_token).unwrap();
        env.storage()
            .instance()
            .set(&DATA_KEY.usdc_token, &new_usdc_token);
        let event = AddressUpdatedEvent {
            old_address: old_usdc_token,
            new_address: new_usdc_token,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("upd_usdc"),), event);
    }

    // -----------------------------------------------------------------------
    // Two-step admin rotation
    //
    // Current admin nominates a successor and starts a timelock; the successor
    // must explicitly accept after the timelock elapses; the current admin may
    // cancel a pending transfer at any time. Prevents a single lost or
    // compromised key from leaving the contract permanently unmanageable.
    // -----------------------------------------------------------------------

    /// Step 1 — current admin nominates `new_admin` and starts the timelock.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let eligible_at = env.ledger().timestamp() + ADMIN_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_admin, &new_admin);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_admin_eligible_at, &eligible_at);
        env.events().publish(
            (symbol_short!("adm_init"),),
            (admin, new_admin, eligible_at),
        );
    }

    /// Step 2 — the nominated address claims ownership after the timelock.
    pub fn accept_admin(env: Env) {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(MintingError::NoPendingAdmin));
        pending_admin.require_auth();

        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(MintingError::AdminTimelockNotElapsed);
        }

        let old_admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        env.storage().instance().set(&DATA_KEY.admin, &pending_admin);
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
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(MintingError::NoPendingAdminToCancel));
        env.storage().instance().remove(&DATA_KEY.pending_admin);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_admin_eligible_at);
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

    fn check_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
    }

    fn assert_recipient_is_account(address: &Address) {
        if !is_account_address(address) {
            address.env().panic_with_error(MintingError::InvalidRecipient);
        }
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

    fn check_paused(env: &Env) {
        let phase: ContractPhase = env
            .storage()
            .instance()
            .get(&DATA_KEY.phase)
            .unwrap_or(ContractPhase::Uninitialized);
        if phase == ContractPhase::Paused {
            env.panic_with_error(MintingError::Paused);
        }
    }

    /// Return the stored contract version (0 if never set).
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0)
    }

    /// Upgrade the contract WASM to `new_wasm_hash` and bump the stored version to
    /// `new_version` (admin only).
    ///
    /// `new_version` must be greater than the current version. Reverts if paused.
    /// Runs any required migrations between the old and new versions.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::check_paused(&env);

        let current_version = Self::get_version(env.clone());

        // SC-034: enforce single-step increments only.
        // Allowing new_version > current_version + 1 would silently skip any
        // migrations registered for the intermediate versions (the `_ => {}`
        // arms). Each deployment must advance exactly one version so every
        // migration function is guaranteed to run.
        if new_version != current_version + 1 {
            env.panic_with_error(MintingError::InvalidVersion);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        // Run migrations — the match will gain new arms as versions are added.
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
}

// Helper functions for proof tracking and validation

fn generate_unique_tx_id(env: &Env, user: &Address, amount: i128, prefix: &str) -> SorobanString {
    let nonce = next_tx_nonce(env);
    let mut preimage = Bytes::new(env);

    preimage.append(&SorobanString::from_str(env, prefix).to_xdr(env));
    preimage.append(&env.current_contract_address().to_xdr(env));
    preimage.append(&user.to_xdr(env));
    preimage.append(&amount.to_xdr(env));
    preimage.append(&env.ledger().timestamp().to_xdr(env));
    preimage.append(&env.ledger().sequence().to_xdr(env));
    preimage.append(&nonce.to_xdr(env));

    let digest = env.crypto().sha256(&preimage).to_array();
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let prefix_bytes = prefix.as_bytes();
    let mut buf = [0u8; 80];
    let mut offset = 0usize;

    for &b in prefix_bytes.iter() {
        buf[offset] = b;
        offset += 1;
    }
    buf[offset] = b'_';
    offset += 1;

    for byte in digest.iter() {
        buf[offset] = HEX[(byte >> 4) as usize];
        buf[offset + 1] = HEX[(byte & 0x0f) as usize];
        offset += 2;
    }

    SorobanString::from_str(
        env,
        core::str::from_utf8(&buf[..offset]).unwrap_or("mint_invalid_tx_id"),
    )
}

fn next_tx_nonce(env: &Env) -> u64 {
    let nonce = env
        .storage()
        .instance()
        .get(&DATA_KEY.tx_nonce)
        .unwrap_or(0u64)
        .checked_add(1)
        .expect("transaction nonce overflow");
    env.storage().instance().set(&DATA_KEY.tx_nonce, &nonce);
    nonce
}

// ---------------------------------------------------------------------------
// Proof-replay helpers: used by mint_from_demo_fiat to prevent double-spend.
// ---------------------------------------------------------------------------
fn check_proof_unused(env: &Env, proof_id: &SorobanString) -> bool {
    !env.storage()
        .persistent()
        .has(&(DATA_KEY.proof_prefix, proof_id.clone()))
}

fn mark_proof_used(env: &Env, proof_id: &SorobanString) {
    env.storage()
        .persistent()
        .set(&(DATA_KEY.proof_prefix, proof_id.clone()), &true);
}

// ---------------------------------------------------------------------------
// C-039: fintech_tx_id validation
//
// Rules enforced at the contract boundary:
//   • Length: 8 – 64 characters (inclusive).
//     - Minimum 8 prevents trivially short IDs that carry no entropy.
//     - Maximum 64 caps storage cost and prevents DoS via huge strings.
//   • Charset: ASCII alphanumeric (A-Z, a-z, 0-9), hyphen (-), underscore (_).
//     Spaces, control characters, and non-ASCII bytes are all rejected.
//     This matches the character set used by common fintech transaction ID
//     schemes (UUIDs, Flutterwave, Paystack, etc.) and is safe for indexers.
//
// Panics with a descriptive message so the caller knows exactly which rule
// was violated.
// ---------------------------------------------------------------------------

/// Minimum allowed length for a `fintech_tx_id`.
const FINTECH_TX_ID_MIN_LEN: u32 = 8;
/// Maximum allowed length for a `fintech_tx_id`.
const FINTECH_TX_ID_MAX_LEN: u32 = 64;

/// Validate a `fintech_tx_id` string against length and charset rules.
///
/// Panics if any rule is violated.
fn validate_fintech_tx_id(env: &Env, id: &SorobanString) {
    let len = id.len();

    if len == 0 {
        env.panic_with_error(MintingError::FintechTxIdEmpty);
    }
    if len < FINTECH_TX_ID_MIN_LEN {
        env.panic_with_error(MintingError::FintechTxIdTooShort);
    }
    if len > FINTECH_TX_ID_MAX_LEN {
        env.panic_with_error(MintingError::FintechTxIdTooLong);
    }

    // Validate charset: ASCII alphanumeric, hyphen, or underscore only.
    // Copy into a fixed-size stack buffer (max 64 bytes, enforced above).
    // FINTECH_TX_ID_MAX_LEN is 64, so this buffer is always large enough.
    let mut buf = [0u8; 64];
    let slice = &mut buf[..len as usize];
    id.copy_into_slice(slice);

    for &b in slice.iter() {
        let valid = matches!(b,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_'
        );
        if !valid {
            env.panic_with_error(MintingError::FintechTxIdInvalidChar);
        }
    }
}

fn normalize_fintech_tx_id(env: &Env, id: &SorobanString) -> SorobanString {
    let len = id.len();
    let mut buf = [0u8; 64];
    let slice = &mut buf[..len as usize];
    id.copy_into_slice(slice);

    for b in slice.iter_mut() {
        if *b >= b'A' && *b <= b'Z' {
            *b += 32; // Convert to lowercase
        }
    }

    // C-039: Convert to &str for Soroban string creation.
    // The input is already validated as ASCII alphanumeric / hyphen / underscore
    // (see validate_fintech_tx_id), so from_utf8 will not fail.
    let normalized = core::str::from_utf8(slice).unwrap_or("");
    SorobanString::from_str(env, normalized)
}
