#![no_std]
use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, vec, Address, BytesN, Env,
    IntoVal, String as SorobanString, Symbol, Vec,
};

use shared::{
    calculate_fee, check_oracle_freshness, is_account_address, reentrancy_guard, BurnEvent,
    ContractError, ContractPhase, CurrencyCode, DataKey as SharedDataKey, BASIS_POINTS,
    CONTRACT_VERSION, DECIMALS, MIN_BURN_AMOUNT, ORACLE_GET_ACBU_RATE_WITH_TS,
    ORACLE_GET_BASKET_WEIGHT, ORACLE_GET_CURRENCIES, ORACLE_GET_RATE_WITH_TS,
    ORACLE_GET_S_TOKEN_ADDR, RESERVE_IS_SUFFICIENT, TOKEN_GET_TOTAL_SUPPLY,
    UPDATE_INTERVAL_SECONDS,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataKey {
    pub admin: Symbol,
    pub oracle: Symbol,
    pub reserve_tracker: Symbol,
    pub acbu_token: Symbol,
    pub withdrawal_processor: Symbol,
    pub vault: Symbol,
    pub fee_rate: Symbol,
    pub fee_single_redeem: Symbol,
    pub phase: Symbol,
    pub min_burn_amount: Symbol,
    pub pending_admin: Symbol,
    pub pending_admin_eligible_at: Symbol,
}

const DATA_KEY: DataKey = DataKey {
    admin: symbol_short!("ADMIN"),
    oracle: symbol_short!("ORACLE"),
    reserve_tracker: symbol_short!("RES_TRK"),
    acbu_token: symbol_short!("ACBU_TKN"),
    withdrawal_processor: symbol_short!("WD_PROC"),
    vault: symbol_short!("VAULT"),
    fee_rate: symbol_short!("FEE_RATE"),
    fee_single_redeem: symbol_short!("FEE_S_R"),
    phase: symbol_short!("PHASE"),
    min_burn_amount: symbol_short!("MIN_BURN"),
    pending_admin: symbol_short!("PEND_ADM"),
    pending_admin_eligible_at: symbol_short!("PA_ETA"),
};


contractmeta!(key = "version", val = "1");

/// Admin rotation timelock: the pending admin must wait this long before
/// claiming ownership, giving the current admin a window to cancel a mistaken
/// or malicious transfer.
const ADMIN_TIMELOCK_SECONDS: u64 = 86_400;

/// Minimum remaining TTL before an instance TTL extension is triggered (~60 days at 5s/ledger).
const INSTANCE_TTL_THRESHOLD: u32 = 5_184_000;
/// Extension target TTL (~60 days at 5s/ledger).
const INSTANCE_TTL_EXTEND_TO: u32 = 5_184_000;

#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseEvent {
    pub admin: Address,
    pub timestamp: u64,
}

#[contract]
pub struct BurningContract;

#[contractimpl]
impl BurningContract {
    /// Initialize the burning contract.
    ///
    /// Sets up all required addresses and fee parameters. Panics if called a
    /// second time (`admin` key already exists) or if either fee rate is
    /// outside [0, BASIS_POINTS].
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        reserve_tracker: Address,
        acbu_token: Address,
        withdrawal_processor: Address,
        vault: Address,
        fee_rate_bps: i128,
        fee_single_redeem_bps: i128,
    ) {
        if env.storage().instance().has(&DATA_KEY.admin) {
            env.panic_with_error(ContractError::Unauthorized);
        }

        if !(0..=BASIS_POINTS).contains(&fee_rate_bps)
            || !(0..=BASIS_POINTS).contains(&fee_single_redeem_bps)
        {
            env.panic_with_error(ContractError::InvalidRate);
        }

        env.storage().instance().set(&DATA_KEY.admin, &admin);
        env.storage().instance().set(&DATA_KEY.oracle, &oracle);
        env.storage()
            .instance()
            .set(&DATA_KEY.reserve_tracker, &reserve_tracker);
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &acbu_token);
        env.storage()
            .instance()
            .set(&DATA_KEY.withdrawal_processor, &withdrawal_processor);
        env.storage().instance().set(&DATA_KEY.vault, &vault);
        env.storage()
            .instance()
            .set(&DATA_KEY.fee_rate, &fee_rate_bps);
        env.storage()
            .instance()
            .set(&DATA_KEY.fee_single_redeem, &fee_single_redeem_bps);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &CONTRACT_VERSION);
        env.storage().instance().set(&DATA_KEY.phase, &ContractPhase::Active);
        env.storage()
            .instance()
            .set(&DATA_KEY.min_burn_amount, &MIN_BURN_AMOUNT);
        Self::extend_instance_ttl(&env);
    }

    /// Redeem `acbu_amount` of ACBU for a single basket currency's S-token.
    ///
    /// Burns `acbu_amount` from `user`, deducts the single-redemption fee, then
    /// transfers the equivalent S-token amount to `recipient` from the vault.
    /// Requires that both the ACBU/USD and currency/USD oracle prices are fresh
    /// (within `UPDATE_INTERVAL_SECONDS`) and that reserves are sufficient.
    ///
    /// `min_stoken_out` is an optional slippage guard: if the computed S-token
    /// output is below this value the transaction reverts with `SlippageExceeded`
    /// before any ACBU is burned. Pass `None` to disable the check.
    pub fn redeem_single(
        env: Env,
        user: Address,
        recipient: Address,
        acbu_amount: i128,
        currency: CurrencyCode,
        min_stoken_out: Option<i128>,
    ) -> i128 {

        Self::check_paused(&env);
        user.require_auth();
        Self::validate_recipient(&env, &recipient);
        Self::extend_instance_ttl(&env);

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_burn_amount)
            .unwrap();
        if acbu_amount < min_amount {
            env.panic_with_error(ContractError::InvalidAmount);
        }

        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let vault: Address = env.storage().instance().get(&DATA_KEY.vault).unwrap();
        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let fee_single: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.fee_single_redeem)
            .unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();

        let (acbu_rate, oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(ContractError::OracleError);
        }

        let (rate, rate_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
            vec![&env, currency.clone().into_val(&env)],
        );
        if !check_oracle_freshness(&env, rate_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(ContractError::OracleError);
        }

        if rate <= 0 || acbu_rate <= 0 {
            env.panic_with_error(ContractError::InvalidRate);
        }

        let stoken: Address = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_S_TOKEN_ADDR),
            vec![&env, currency.clone().into_val(&env)],
        );

        let fee = calculate_fee(acbu_amount, fee_single);
        let net_acbu = acbu_amount
            .checked_sub(fee)
            .expect("Underflow in net acbu calculation");


        let stoken_out = net_acbu
            .checked_mul(acbu_rate)
            .and_then(|v| v.checked_div(rate))
            .expect("Overflow in stoken out calculation");

        // Slippage guard: reject before any state change if output is below caller's floor.
        if let Some(floor) = min_stoken_out {
            if stoken_out < floor {
                env.panic_with_error(ContractError::SlippageExceeded);
            }
        }

        Self::check_reserves(&env, &acbu_token, &reserve_tracker_addr);

        let acbu_client = soroban_sdk::token::Client::new(&env, &acbu_token);
        acbu_client.burn(&user, &acbu_amount);

        let token = soroban_sdk::token::Client::new(&env, &stoken);
        let spender = env.current_contract_address();
        token.transfer_from(&spender, &vault, &recipient, &stoken_out);


        let burn_event = BurnEvent {
            transaction_id: SorobanString::from_str(&env, "redeem_single"),
            user: user.clone(),
            acbu_amount,
            net_acbu,
            local_amount: stoken_out,
            currency: currency.clone(),
            fee,
            rate,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("burn"), user), burn_event);


        stoken_out
    }

    /// Redeem ACBU for proportional Afreum S-tokens across the basket (lower fee tier).
    ///
    /// `min_stokens_out` is an optional per-leg slippage guard: if provided, its
    /// length must equal the number of basket currencies and each element is the
    /// minimum acceptable S-token amount for that leg. The transaction reverts
    /// with `SlippageExceeded` before any ACBU is burned if any leg's computed
    /// output falls below the corresponding floor. Pass `None` to disable all
    /// per-leg checks (backwards-compatible default).
    pub fn redeem_basket(
        env: Env,
        user: Address,
        recipients: Vec<Address>,
        acbu_amount: i128,
        min_stokens_out: Option<Vec<i128>>,
    ) -> Vec<i128> {
        Self::check_paused(&env);
        user.require_auth();
        Self::extend_instance_ttl(&env);

        if recipients.is_empty() {
            env.panic_with_error(ContractError::InvalidRecipient);
        }

        // Validate min_stokens_out length before doing any heavy computation.
        if let Some(ref floors) = min_stokens_out {
            if floors.len() != recipients.len() {
                env.panic_with_error(ContractError::InvalidAmount);
            }
        }

        for i in 0..recipients.len() {
            Self::validate_recipient(&env, &recipients.get(i).unwrap());
            for j in (i + 1)..recipients.len() {
                if recipients.get(i).unwrap() == recipients.get(j).unwrap() {
                    env.panic_with_error(ContractError::InvalidRecipient);
                }
            }
        }

        let min_amount: i128 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_burn_amount)
            .unwrap();
        if acbu_amount < min_amount {
            env.panic_with_error(ContractError::InvalidAmount);
        }

        let oracle_addr: Address = env.storage().instance().get(&DATA_KEY.oracle).unwrap();
        let vault: Address = env.storage().instance().get(&DATA_KEY.vault).unwrap();
        let acbu_token: Address = env.storage().instance().get(&DATA_KEY.acbu_token).unwrap();
        let fee_rate: i128 = env.storage().instance().get(&DATA_KEY.fee_rate).unwrap();
        let reserve_tracker_addr: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap();

        let (acbu_rate, oracle_timestamp): (i128, u64) = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_ACBU_RATE_WITH_TS),
            vec![&env],
        );
        if !check_oracle_freshness(&env, oracle_timestamp, UPDATE_INTERVAL_SECONDS) {
            env.panic_with_error(ContractError::OracleError);
        }
        if acbu_rate <= 0 {
            env.panic_with_error(ContractError::InvalidRate);
        }

        let currencies: Vec<CurrencyCode> = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(&env, ORACLE_GET_CURRENCIES),
            vec![&env],
        );
        if currencies.is_empty() {
            env.panic_with_error(ContractError::InvalidCurrency);
        }
        if recipients.len() != currencies.len() {
            env.panic_with_error(ContractError::InvalidRecipient);
        }

        let mut weights = Vec::new(&env);
        let mut total_weight: i128 = 0;
        for i in 0..currencies.len() {
            let currency = currencies.get(i).unwrap();
            let weight: i128 = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, ORACLE_GET_BASKET_WEIGHT),
                vec![&env, currency.into_val(&env)],
            );
            total_weight = total_weight
                .checked_add(weight)
                .expect("Overflow in total weight");
            weights.push_back(weight);
        }

        if total_weight == 0 {
            env.panic_with_error(ContractError::InvalidRate);
        }

        let total_fee = calculate_fee(acbu_amount, fee_rate);
        let net_acbu = acbu_amount
            .checked_sub(total_fee)
            .expect("Underflow in net acbu");
        let usd_total = net_acbu
            .checked_mul(acbu_rate)
            .and_then(|v| v.checked_div(DECIMALS))
            .expect("Overflow in usd total");

        // Pre-flight slippage check — runs before any state change so the
        // transaction reverts cleanly without burning ACBU first.
        if let Some(ref floors) = min_stokens_out {
            let mut pf_last_positive: Option<u32> = None;
            for i in 0..weights.len() {
                if weights.get(i).unwrap() > 0 {
                    pf_last_positive = Some(i);
                }
            }
            let mut pf_allocated_usd = 0i128;
            let mut pf_allocated_gross = 0i128;
            let mut pf_allocated_fee = 0i128;
            for i in 0..currencies.len() {
                let currency = currencies.get(i).unwrap();
                let weight = weights.get(i).unwrap();
                if weight == 0 {
                    continue;
                }
                let (rate, _): (i128, u64) = env.invoke_contract(
                    &oracle_addr,
                    &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
                    vec![&env, currency.clone().into_val(&env)],
                );
                if rate <= 0 {
                    env.panic_with_error(ContractError::InvalidRate);
                }
                let (pf_usd_i, pf_gross_i, pf_fee_i) = if pf_last_positive == Some(i) {
                    (
                        usd_total.checked_sub(pf_allocated_usd).expect("pf usd"),
                        acbu_amount.checked_sub(pf_allocated_gross).expect("pf gross"),
                        total_fee.checked_sub(pf_allocated_fee).expect("pf fee"),
                    )
                } else {
                    (
                        Self::weighted_floor(usd_total, weight, total_weight),
                        Self::weighted_floor(acbu_amount, weight, total_weight),
                        Self::weighted_floor(total_fee, weight, total_weight),
                    )
                };
                pf_allocated_usd = pf_allocated_usd.checked_add(pf_usd_i).expect("pf alloc usd");
                pf_allocated_gross = pf_allocated_gross.checked_add(pf_gross_i).expect("pf alloc gross");
                pf_allocated_fee = pf_allocated_fee.checked_add(pf_fee_i).expect("pf alloc fee");
                let pf_net_i = pf_gross_i.checked_sub(pf_fee_i).expect("pf net");
                let pf_native_i = pf_net_i
                    .checked_mul(acbu_rate)
                    .and_then(|v| v.checked_div(rate))
                    .expect("pf native");
                if let Some(floor) = floors.get(i) {
                    if pf_native_i < floor {
                        env.panic_with_error(ContractError::SlippageExceeded);
                    }
                }
            }
        }

        reentrancy_guard::acquire_guard(&env);
        Self::check_reserves(&env, &acbu_token, &reserve_tracker_addr);

        let acbu_client = soroban_sdk::token::Client::new(&env, &acbu_token);
        acbu_client.burn(&user, &acbu_amount);

        let mut last_positive_weight_index: Option<u32> = None;
        for i in 0..weights.len() {
            if weights.get(i).unwrap() > 0 {
                last_positive_weight_index = Some(i);
            }
        }

        let mut amounts_out = Vec::new(&env);
        let mut allocated_usd = 0i128;
        let mut allocated_gross = 0i128;
        let mut allocated_fee = 0i128;

        for i in 0..currencies.len() {
            let currency = currencies.get(i).unwrap();
            let recipient = recipients.get(i).unwrap();
            let weight = weights.get(i).unwrap();

            if weight == 0 {
                amounts_out.push_back(0);
                continue;
            }

            let (rate, rate_timestamp): (i128, u64) = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, ORACLE_GET_RATE_WITH_TS),
                vec![&env, currency.clone().into_val(&env)],
            );
            if !check_oracle_freshness(&env, rate_timestamp, UPDATE_INTERVAL_SECONDS) {
                env.panic_with_error(ContractError::OracleError);
            }
            if rate <= 0 {
                env.panic_with_error(ContractError::InvalidRate);
            }

            let (usd_i, acbu_gross_i, fee_i) = if last_positive_weight_index == Some(i) {
                (
                    usd_total
                        .checked_sub(allocated_usd)
                        .expect("Underflow in remaining usd"),
                    acbu_amount
                        .checked_sub(allocated_gross)
                        .expect("Underflow in remaining gross"),
                    total_fee
                        .checked_sub(allocated_fee)
                        .expect("Underflow in remaining fee"),
                )
            } else {
                (
                    Self::weighted_floor(usd_total, weight, total_weight),
                    Self::weighted_floor(acbu_amount, weight, total_weight),
                    Self::weighted_floor(total_fee, weight, total_weight),
                )
            };

            allocated_usd = allocated_usd
                .checked_add(usd_i)
                .expect("Overflow in allocated usd");
            allocated_gross = allocated_gross
                .checked_add(acbu_gross_i)
                .expect("Overflow in allocated gross");
            allocated_fee = allocated_fee
                .checked_add(fee_i)
                .expect("Overflow in allocated fee");

            let stoken: Address = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, ORACLE_GET_S_TOKEN_ADDR),
                vec![&env, currency.clone().into_val(&env)],
            );

            let net_acbu_i = acbu_gross_i
                .checked_sub(fee_i)
                .expect("Underflow in net per-leg");

            let native_i = net_acbu_i
                .checked_mul(acbu_rate)
                .and_then(|v| v.checked_div(rate))
                .expect("Overflow in native amount");

            if native_i > 0 {
                let token = soroban_sdk::token::Client::new(&env, &stoken);
                let spender = env.current_contract_address();
                token.transfer_from(&spender, &vault, &recipient, &native_i);
            }
            amounts_out.push_back(native_i);

            let burn_event = BurnEvent {
                transaction_id: SorobanString::from_str(&env, "redeem_basket"),
                user: user.clone(),
                acbu_amount: acbu_gross_i,
                net_acbu: net_acbu_i,
                local_amount: native_i,
                currency: currency.clone(),
                fee: fee_i,
                rate,
                timestamp: env.ledger().timestamp(),
            };
            env.events()
                .publish((symbol_short!("burn"), user.clone()), burn_event);
        }

        reentrancy_guard::release_guard(&env);
        amounts_out
    }



    /// Step 1 of two-step admin rotation — nominates `new_admin` and starts the
    /// timelock. The current admin must call this; `new_admin` calls
    /// [`Self::accept_admin`] after the timelock elapses.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        Self::check_admin(&env);
        Self::extend_instance_ttl(&env);
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

    /// Step 2 of two-step admin rotation — the nominated address claims ownership
    /// after the timelock has elapsed. Panics if no transfer is pending or the
    /// timelock is still active.
    pub fn accept_admin(env: Env) {
        Self::extend_instance_ttl(&env);
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(ContractError::Unknown));
        pending_admin.require_auth();

        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(ContractError::Unauthorized);
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

    /// Cancel a pending admin transfer. Current admin only; clears the pending
    /// admin and its timelock.
    pub fn cancel_admin_transfer(env: Env) {
        Self::check_admin(&env);
        Self::extend_instance_ttl(&env);
        env.storage().instance().remove(&DATA_KEY.pending_admin);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_admin_eligible_at);
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        env.events().publish(
            (symbol_short!("adm_cncl"),),
            (admin, env.ledger().timestamp()),
        );
    }


    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DATA_KEY.admin).unwrap()
    }

    /// Pause the contract, disabling all redemption operations (admin only).
    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::extend_instance_ttl(&env);
        env.storage().instance().set(&DATA_KEY.phase, &ContractPhase::Paused);
        let event = PauseEvent {
            admin,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("paused"),), event);
    }

    /// Unpause the contract, re-enabling redemption operations (admin only).
    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
        Self::extend_instance_ttl(&env);
        env.storage().instance().set(&DATA_KEY.phase, &ContractPhase::Active);
        let event = PauseEvent {
            admin,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("unpaused"),), event);
    }

    /// Returns the pending admin address if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DATA_KEY.pending_admin)
    }


    /// Returns the timestamp after which [`Self::accept_admin`] becomes callable.
    pub fn get_pending_admin_eligible_at(env: Env) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        let phase: ContractPhase = env
            .storage()
            .instance()
            .get(&DATA_KEY.phase)
            .unwrap_or(ContractPhase::Active);
        matches!(phase, ContractPhase::Paused)
    }

    /// Returns the current contract phase (Active or Paused).
    pub fn get_phase(env: Env) -> ContractPhase {
        env.storage()
            .instance()
            .get(&DATA_KEY.phase)
            .unwrap_or(ContractPhase::Active)
    }

    /// Returns the basket redemption fee rate in basis points.
    pub fn get_fee_rate(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DATA_KEY.fee_rate)
            .unwrap_or(0)
    }

    /// Returns the single-currency redemption fee rate in basis points.
    pub fn get_fee_single_redeem(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DATA_KEY.fee_single_redeem)
            .unwrap_or(0)
    }

    /// Returns the ACBU token contract address.
    pub fn get_acbu_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DATA_KEY.acbu_token)
            .unwrap()
    }

    /// Returns the oracle contract address.
    pub fn get_oracle(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DATA_KEY.oracle)
            .unwrap()
    }

    /// Returns the reserve tracker contract address.
    pub fn get_reserve_tracker(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DATA_KEY.reserve_tracker)
            .unwrap()
    }

    /// Returns the withdrawal processor contract address.
    pub fn get_withdrawal_processor(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DATA_KEY.withdrawal_processor)
            .unwrap()
    }

    /// Returns the vault contract address.
    pub fn get_vault(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DATA_KEY.vault)
            .unwrap()
    }

    /// Returns the minimum ACBU amount required for a redemption.
    pub fn get_min_burn_amount(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DATA_KEY.min_burn_amount)
            .unwrap_or(MIN_BURN_AMOUNT)
    }

    /// Returns the current contract version stored in instance storage.
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0)
    }

    /// Returns `true` if the contract has been initialized.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DATA_KEY.admin)
    }

    /// Upgrade the contract WASM in one step. Admin only. `new_version` must
    /// exceed the current stored version; any registered migration hooks are run
    /// in order before updating the version.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32) {
        Self::check_admin(&env);
        Self::extend_instance_ttl(&env);
        let current_version = Self::get_version(env.clone());
        if new_version <= current_version {
            env.panic_with_error(ContractError::InvalidVersion);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);

        for v in current_version..new_version {
            if v == 0 {
                shared::migrate_v0_to_v1(&env);
            }
        }
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &new_version);
    }

    fn weighted_floor(total: i128, weight: i128, total_weight: i128) -> i128 {
        total
            .checked_mul(weight)
            .and_then(|v| v.checked_div(total_weight))
            .expect("Overflow in weighted allocation")
    }

    fn check_reserves(env: &Env, acbu_token: &Address, reserve_tracker_addr: &Address) {
        let current_supply: i128 = env.invoke_contract(
            acbu_token,
            &Symbol::new(env, TOKEN_GET_TOTAL_SUPPLY),
            vec![env],
        );
        let reserve_ok: bool = env.invoke_contract(
            reserve_tracker_addr,
            &Symbol::new(env, RESERVE_IS_SUFFICIENT),
            vec![env, current_supply.into_val(env)],
        );
        if !reserve_ok {
            env.panic_with_error(ContractError::InsufficientReserves);
        }
    }

    fn check_paused(env: &Env) {
        let phase: ContractPhase = env
            .storage()
            .instance()
            .get(&DATA_KEY.phase)
            .unwrap_or(ContractPhase::Active);
        if matches!(phase, ContractPhase::Paused) {
            env.panic_with_error(ContractError::Paused);
        }
    }

    fn check_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
    }

    /// Redeem recipients must be `G…` accounts, the same rule the minting
    /// contract applies (AC-031). This also rejects this contract's own
    /// address, since contract addresses are `C…`.
    fn validate_recipient(env: &Env, recipient: &Address) {
        if !is_account_address(recipient) {
            env.panic_with_error(ContractError::InvalidRecipient);
        }
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }
}
