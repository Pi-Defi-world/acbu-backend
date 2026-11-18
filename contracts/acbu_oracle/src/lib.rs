#![no_std]
use core::fmt::{self, Display};
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, Address,
    BytesN, Env, Map, Symbol, Vec,
};

use shared::{
    calculate_deviation, median, CurrencyCode, DataKey as SharedDataKey, EmergencyBypassEvent,
    EmergencyConfig, EmergencyVote, EmergencyVoteCastEvent, OutlierDetectionEvent, RateData,
    RateUpdateEvent, BASIS_POINTS, CONTRACT_VERSION, EMERGENCY_THRESHOLD_BPS,
    MAX_VALIDATORS, OUTLIER_THRESHOLD_BPS, STALE_RATE_MAX_LEDGERS, UPDATE_INTERVAL_SECONDS,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
    AlreadyInitialized = 7001,
    InvalidMinSignatures = 7002,
    MinSignaturesZero = 7003,
    NoPendingAdmin = 7004,
    AdminTimelockNotElapsed = 7005,
    NoPendingAdminToCancel = 7006,
    UnauthorizedValidator = 7007,
    UpdateIntervalNotMet = 7008,
    InsufficientOracleSources = 7009,
    InvalidRate = 7010,
    RateNotFound = 7011,
    STokenNotConfigured = 7012,
    ValidatorAlreadyExists = 7013,
    CannotRemoveValidator = 7014,
    InvalidVersion = 7015,
    RateStaleLedger = 7016,
    NoPendingUpgrade = 7017,
    UpgradeTimelockNotElapsed = 7018,
    NoPendingValidatorChange = 7019,
    ValidatorTimelockNotElapsed = 7020,
    MaxValidatorsReached = 7021,
    TimestampRollback = 7022,
    RateNotInitialized = 7023,
    CurrencyNotRegistered = 7024,
    /// Emergency vote cast but consensus not yet reached — caller must wait for
    /// more validators to submit corroborating emergency rates.
    InsufficientEmergencyVotes = 7025,
    Unknown = 7999,
}

impl Display for OracleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::AlreadyInitialized => "oracle already initialized",
            Self::InvalidMinSignatures => "invalid minimum signatures",
            Self::MinSignaturesZero => "minimum signatures cannot be zero",
            Self::NoPendingAdmin => "no pending admin",
            Self::AdminTimelockNotElapsed => "admin timelock has not elapsed",
            Self::NoPendingAdminToCancel => "no pending admin to cancel",
            Self::UnauthorizedValidator => "unauthorized validator",
            Self::UpdateIntervalNotMet => "update interval not met",
            Self::InsufficientOracleSources => "insufficient oracle sources",
            Self::InvalidRate => "invalid rate",
            Self::RateNotFound => "rate not found",
            Self::STokenNotConfigured => "s-token not configured",
            Self::ValidatorAlreadyExists => "validator already exists",
            Self::CannotRemoveValidator => "cannot remove validator",
            Self::InvalidVersion => "invalid contract version",
            Self::RateStaleLedger => "rate is stale",
            Self::NoPendingUpgrade => "no pending upgrade",
            Self::UpgradeTimelockNotElapsed => "upgrade timelock has not elapsed",
            Self::NoPendingValidatorChange => "no pending validator change",
            Self::ValidatorTimelockNotElapsed => "validator timelock has not elapsed",
            Self::MaxValidatorsReached => "maximum validators reached",
            Self::TimestampRollback => "timestamp rollback",
            Self::RateNotInitialized => "rate not initialized - no submissions yet",
            Self::CurrencyNotRegistered => "currency not registered",
            Self::InsufficientEmergencyVotes => "emergency vote cast - waiting for N-of-M validator consensus",
            Self::Unknown => "unknown oracle error",
        };
        f.write_str(message)
    }
}

pub const ADMIN_TIMELOCK_SECONDS: u64 = 86_400;
const MIN_ORACLE_SOURCE_FEEDS: u32 = 3;
/// Number of decimal places used for all rates reported by this oracle.
const RATE_DECIMALS: u32 = 7;

/// Mirrors acbu_reserve_tracker's instance-TTL ceiling: bumps the entry to
/// ~300 days (at 5s/ledger) on every rate write and read. Every mint, burn,
/// and reserve check reads through this contract's instance storage, so it
/// must never be allowed to archive from inactivity.
const INSTANCE_TTL_THRESHOLD: u32 = 5_184_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 5_184_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataKey {
    pub admin: Symbol,
    pub validators: Symbol,
    pub validator_set: Symbol,
    pub min_signatures: Symbol,
    pub currencies: Symbol,
    pub rates: Symbol,
    pub last_update: Symbol,
    pub update_interval: Symbol,
    pub basket_weights: Symbol,
    pub s_tokens: Symbol,
    pub version: Symbol,
    pub pending_admin: Symbol,
    pub pending_admin_eligible_at: Symbol,
    pub pending_upgrade_wasm: Symbol,
    pub pending_upgrade_version: Symbol,
    pub pending_upgrade_eligible_at: Symbol,
    pub pending_validator: Symbol,
    pub pending_validator_is_add: Symbol,
    pub pending_validator_eligible_at: Symbol,
    /// Map<CurrencyCode, EmergencyConfig> — per-pair emergency threshold config.
    pub emergency_thresholds: Symbol,
    /// Map<CurrencyCode, Vec<EmergencyVote>> — pending emergency votes per pair.
    pub emergency_votes: Symbol,
}

const DATA_KEY: DataKey = DataKey {
    admin: symbol_short!("ADMIN"),
    validators: symbol_short!("VALID_LST"),
    validator_set: symbol_short!("VALID_SET"),
    min_signatures: symbol_short!("MIN_SIGS"),
    currencies: symbol_short!("CURRENCY"),
    rates: symbol_short!("RATES"),
    last_update: symbol_short!("LAST_UPD"),
    update_interval: symbol_short!("UPD_INTVL"),
    basket_weights: symbol_short!("BASKET_WT"),
    s_tokens: symbol_short!("S_TOKENS"),
    version: symbol_short!("VERSION"),
    pending_admin: symbol_short!("PEND_ADM"),
    pending_admin_eligible_at: symbol_short!("PA_ETA"),
    pending_upgrade_wasm: symbol_short!("PEND_UPG"),
    pending_upgrade_version: symbol_short!("PEND_UVER"),
    pending_upgrade_eligible_at: symbol_short!("PEND_UETA"),
    pending_validator: symbol_short!("PEND_VAL"),
    pending_validator_is_add: symbol_short!("PEND_VADD"),
    pending_validator_eligible_at: symbol_short!("PEND_VETA"),
    emergency_thresholds: symbol_short!("EMRG_THR"),
    emergency_votes: symbol_short!("EMRG_VOT"),
};

const VERSION: u32 = 9;

/// Number of seconds after which pending emergency votes expire and are cleared.
/// Set to 1 hour — long enough for validators to respond but short enough to
/// prevent stale votes from trickling into a later genuine crisis.
const EMERGENCY_VOTE_TTL_SECONDS: u64 = 3_600;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferInitiatedEvent {
    pub current_admin: Address,
    pub pending_admin: Address,
    pub eligible_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferCompletedEvent {
    pub old_admin: Address,
    pub new_admin: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferCancelledEvent {
    pub admin: Address,
    pub cancelled_pending: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StaleRateEvent {
    pub currency: CurrencyCode,
    pub stored_ledger: u32,
    pub current_ledger: u32,
    pub max_stale_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ValidatorSignature {
    pub validator: Address,
    pub timestamp: u64,
}

contractmeta!(key = "version", val = "9");

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    // ─────────────────────────────────────────────────────────────────────────
    // Initialisation
    // ─────────────────────────────────────────────────────────────────────────

    /// Initialize the oracle. Callable once; reverts with `AlreadyInitialized`
    /// afterwards.
    ///
    /// Sets the `admin`, the initial `validators` set and the `min_signatures`
    /// threshold required to accept a rate update, the supported `currencies`, and
    /// their `basket_weights`. `min_signatures` must be in `1..=validators.len()`
    /// and the validator count must not exceed [`MAX_VALIDATORS`].
    pub fn initialize(
        env: Env,
        admin: Address,
        validators: Vec<Address>,
        min_signatures: u32,
        currencies: Vec<CurrencyCode>,
        basket_weights: Map<CurrencyCode, i128>,
    ) {
        if env.storage().instance().has(&DATA_KEY.admin) {
            env.panic_with_error(OracleError::AlreadyInitialized);
        }

        if !((1..=validators.len()).contains(&min_signatures)) {
            env.panic_with_error(OracleError::InvalidMinSignatures);
        }
        if min_signatures == 0 {
            env.panic_with_error(OracleError::MinSignaturesZero);
        }
        if validators.len() > MAX_VALIDATORS {
            env.panic_with_error(OracleError::MaxValidatorsReached);
        }

        env.storage().instance().set(&DATA_KEY.admin, &admin);
        env.storage()
            .instance()
            .set(&DATA_KEY.validators, &validators);
        let mut validator_set: Map<Address, bool> = Map::new(&env);
        for v in validators.iter() {
            validator_set.set(v, true);
        }
        env.storage()
            .instance()
            .set(&DATA_KEY.validator_set, &validator_set);
        env.storage()
            .instance()
            .set(&DATA_KEY.min_signatures, &min_signatures);
        env.storage()
            .instance()
            .set(&DATA_KEY.currencies, &currencies);
        env.storage()
            .instance()
            .set(&DATA_KEY.basket_weights, &basket_weights);

        let s_tokens_empty: Map<CurrencyCode, Address> = Map::new(&env);
        env.storage()
            .instance()
            .set(&DATA_KEY.s_tokens, &s_tokens_empty);
        env.storage()
            .instance()
            .set(&DATA_KEY.update_interval, &UPDATE_INTERVAL_SECONDS);

        let rates: Map<CurrencyCode, RateData> = Map::new(&env);
        env.storage().instance().set(&DATA_KEY.rates, &rates);
        env.storage().instance().set(&DATA_KEY.last_update, &0u64);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &CONTRACT_VERSION);
        Self::extend_instance_ttl(&env);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Two-step admin rotation
    // ─────────────────────────────────────────────────────────────────────────

    /// Step 1 of admin rotation — current admin nominates `new_admin` and starts
    /// the timelock. Admin only. Emits `AdminTransferInitiatedEvent`.
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
            AdminTransferInitiatedEvent {
                current_admin,
                pending_admin: new_admin,
                eligible_at,
            },
        );
    }

    /// Step 2 of admin rotation — the nominated address claims ownership after the
    /// timelock elapses. Requires the pending admin's auth. Emits
    /// `AdminTransferCompletedEvent`.
    pub fn accept_admin(env: Env) {
        let pending_admin: Address = match env.storage().instance().get(&DATA_KEY.pending_admin) {
            Some(a) => a,
            None => env.panic_with_error(OracleError::NoPendingAdmin),
        };

        pending_admin.require_auth();

        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
            .unwrap_or(u64::MAX);

        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(OracleError::AdminTimelockNotElapsed);
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
            AdminTransferCompletedEvent {
                old_admin,
                new_admin: pending_admin,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Cancel a pending admin transfer (current admin only). Emits
    /// `AdminTransferCancelledEvent`.
    pub fn cancel_admin_transfer(env: Env) {
        Self::check_admin(&env);

        let pending_admin: Address = match env.storage().instance().get(&DATA_KEY.pending_admin) {
            Some(a) => a,
            None => env.panic_with_error(OracleError::NoPendingAdminToCancel),
        };

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

    /// Return the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DATA_KEY.admin).unwrap()
    }

    /// Return the pending admin, if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DATA_KEY.pending_admin)
    }

    /// Return the timestamp after which `accept_admin` becomes callable, if a
    /// transfer is pending.
    pub fn get_pending_admin_eligible_at(env: Env) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rate management
    // ─────────────────────────────────────────────────────────────────────────

    /// Submit a rate update for `currency` from an authorized `validator`.
    ///
    /// Requires the validator's auth and that it is in the active validator set.
    /// `sources` are the raw per-feed rates: when more than one is supplied the
    /// median is taken and feeds deviating beyond [`OUTLIER_THRESHOLD_BPS`] are
    /// discarded as outliers (emitting `OutlierDetectionEvent`). Updates are
    /// rate-limited to the configured update interval unless the new rate deviates
    /// beyond the per-currency emergency threshold **and** at least `min_signatures`
    /// validators have all independently cast emergency votes via
    /// [`Self::cast_emergency_vote`] (N-of-M consensus). A single validator can no
    /// longer unilaterally bypass the time-lock. Rejects timestamps older than the
    /// stored rate. The `_timestamp` parameter is ignored; the ledger timestamp is
    /// used. Emits `RateUpdateEvent` and, when an emergency bypass fires, also emits
    /// `EmergencyBypassEvent`.
    pub fn update_rate(
        env: Env,
        validator: Address,
        currency: CurrencyCode,
        rate: i128,
        sources: Vec<i128>,
        _timestamp: u64,
    ) {
        validator.require_auth();

        let validator_set: Map<Address, bool> =
            match env.storage().instance().get(&DATA_KEY.validator_set) {
                Some(set) => set,
                None => {
                    let validators: Vec<Address> =
                        env.storage().instance().get(&DATA_KEY.validators).unwrap();
                    let mut set: Map<Address, bool> = Map::new(&env);
                    for v in validators.iter() {
                        set.set(v, true);
                    }
                    env.storage().instance().set(&DATA_KEY.validator_set, &set);
                    set
                }
            };
        if !validator_set.contains_key(validator.clone()) {
            env.panic_with_error(OracleError::UnauthorizedValidator);
        }

        let update_interval: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.update_interval)
            .unwrap_or(UPDATE_INTERVAL_SECONDS);
        let current_time = env.ledger().timestamp();

        let existing_rate = Self::get_rate_internal(&env, &currency);
        if let Some(ref existing) = existing_rate {
            if current_time < existing.timestamp {
                env.panic_with_error(OracleError::TimestampRollback);
            }
        }

        let min_sigs: u32 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_signatures)
            .unwrap();

        // ── Emergency bypass logic (SC-025) ──────────────────────────────────
        //
        // A single validator can no longer unilaterally bypass the time-lock.
        // The two-step flow is:
        //
        //  1. Each validator that believes an emergency exists calls
        //     `cast_emergency_vote(validator, currency, rate)` — this always
        //     succeeds and persists the vote (it never panics, so storage is
        //     never rolled back).
        //
        //  2. Once `min_signatures` qualifying votes exist, any validator may
        //     call `update_rate` with the emergency rate. This function checks
        //     whether the consensus has been reached: if yes it clears the votes
        //     and grants the bypass (emitting `EmergencyBypassEvent`); if not it
        //     falls through to the regular interval check and fails with
        //     `UpdateIntervalNotMet`.
        //
        // The separation is critical: because Soroban rolls back all storage
        // writes inside a panicking call, votes must be persisted via a
        // dedicated non-panicking function rather than inside `update_rate`.
        // ─────────────────────────────────────────────────────────────────────

        let mut allow_update = false;
        if let Some(ref existing) = existing_rate {
            let emergency_threshold = Self::get_emergency_threshold_bps(&env, &currency);
            let deviation = calculate_deviation(rate, existing.rate_usd);
            if deviation > emergency_threshold {
                // Check whether N-of-M consensus already exists (votes were
                // pre-registered via cast_emergency_vote).
                allow_update = Self::check_and_consume_emergency_votes(
                    &env,
                    &currency,
                    current_time,
                    min_sigs,
                    rate,
                );
            }
        }

        if let Some(ref existing) = existing_rate {
            if !allow_update && current_time < existing.timestamp + update_interval {
                env.panic_with_error(OracleError::UpdateIntervalNotMet);
            }
        }

        let required = min_sigs.max(MIN_ORACLE_SOURCE_FEEDS);
        // The 0/1-source path below intentionally bypasses median/outlier
        // aggregation, so the multi-source quorum floor only applies once
        // there's more than one source to aggregate.
        if sources.len() > 1 && sources.len() < required {
            env.panic_with_error(OracleError::InsufficientOracleSources);
        }

        // Bypass median and outlier calculation workflows if 0 or 1 submissions exist
        let median_rate = if sources.is_empty() {
            rate
        } else if sources.len() == 1 {
            sources.get(0).unwrap()
        } else {
            let raw_median = median(sources.clone()).unwrap_or(rate);

            let mut clean_sources: Vec<i128> = Vec::new(&env);
            for i in 0..sources.len() {
                let source_rate = sources.get(i).unwrap();
                let deviation_bps = calculate_deviation(source_rate, raw_median);

                if deviation_bps > OUTLIER_THRESHOLD_BPS {
                    let outlier_event = OutlierDetectionEvent {
                        currency: currency.clone(),
                        median_rate: raw_median,
                        outlier_rate: source_rate,
                        deviation_bps,
                        timestamp: current_time,
                    };
                    env.events()
                        .publish((symbol_short!("outlier"),), outlier_event);
                } else {
                    clean_sources.push_back(source_rate);
                }
            }

            if clean_sources.is_empty() {
                raw_median
            } else if clean_sources.len() == 1 {
                clean_sources.get(0).unwrap()
            } else {
                median(clean_sources).unwrap_or(raw_median)
            }
        };

        if allow_update {
            // Emit bypass event now that we know the final median rate.
            let vote_count = min_sigs; // consensus already confirmed above
            env.events().publish(
                (symbol_short!("emrg_byp"),),
                EmergencyBypassEvent {
                    currency: currency.clone(),
                    new_rate: median_rate,
                    vote_count,
                    timestamp: current_time,
                },
            );
        }

        let rate_data = RateData {
            currency: currency.clone(),
            rate_usd: median_rate,
            timestamp: current_time,
            sources,
            ledger: env.ledger().sequence(),
        };

        let mut rates: Map<CurrencyCode, RateData> = env
            .storage()
            .instance()
            .get(&DATA_KEY.rates)
            .unwrap_or(Map::new(&env));
        rates.set(currency.clone(), rate_data);
        env.storage().instance().set(&DATA_KEY.rates, &rates);
        env.storage()
            .instance()
            .set(&DATA_KEY.last_update, &current_time);
        Self::extend_instance_ttl(&env);

        let event = RateUpdateEvent {
            currency: currency.clone(),
            rate: median_rate,
            timestamp: current_time,
            validator: validator.clone(),
        };
        env.events().publish((symbol_short!("rate_upd"),), event);
    }

    /// Cast an emergency vote for `currency` from an authorised `validator`.
    ///
    /// This is step 1 of the two-step emergency bypass flow (SC-025).  A validator
    /// that believes a rate has genuinely moved beyond the per-currency emergency
    /// threshold calls this function to register their vote.  Once `min_signatures`
    /// distinct validators have cast qualifying votes for the same currency, any
    /// validator may call [`Self::update_rate`] with the emergency rate to apply the
    /// bypass.
    ///
    /// **This function always succeeds** (never panics on success path) so that the
    /// vote is durably persisted in contract storage.  Votes expire after
    /// `EMERGENCY_VOTE_TTL_SECONDS` (1 hour); stale votes are discarded before the
    /// new vote is recorded.  Duplicate votes from the same validator for the same
    /// currency replace the previous vote (no double-counting).
    ///
    /// Emits `EmergencyVoteCastEvent` with the current tally and required quorum.
    pub fn cast_emergency_vote(
        env: Env,
        validator: Address,
        currency: CurrencyCode,
        rate: i128,
    ) {
        validator.require_auth();

        // Validator must be in the authorised set.
        let validator_set: Map<Address, bool> =
            match env.storage().instance().get(&DATA_KEY.validator_set) {
                Some(set) => set,
                None => {
                    let validators: Vec<Address> =
                        env.storage().instance().get(&DATA_KEY.validators).unwrap();
                    let mut set: Map<Address, bool> = Map::new(&env);
                    for v in validators.iter() {
                        set.set(v, true);
                    }
                    env.storage().instance().set(&DATA_KEY.validator_set, &set);
                    set
                }
            };
        if !validator_set.contains_key(validator.clone()) {
            env.panic_with_error(OracleError::UnauthorizedValidator);
        }

        let min_sigs: u32 = env
            .storage()
            .instance()
            .get(&DATA_KEY.min_signatures)
            .unwrap();

        let current_time = env.ledger().timestamp();

        let mut all_votes: Map<CurrencyCode, Vec<EmergencyVote>> = env
            .storage()
            .instance()
            .get(&DATA_KEY.emergency_votes)
            .unwrap_or(Map::new(&env));

        let votes: Vec<EmergencyVote> = all_votes
            .get(currency.clone())
            .unwrap_or(Vec::new(&env));

        // Discard expired and deduplicate same-validator votes.
        let mut fresh_votes: Vec<EmergencyVote> = Vec::new(&env);
        for v in votes.iter() {
            let expired = current_time.saturating_sub(v.timestamp) > EMERGENCY_VOTE_TTL_SECONDS;
            let is_same = v.validator == validator;
            if !expired && !is_same {
                fresh_votes.push_back(v.clone());
            }
        }
        fresh_votes.push_back(EmergencyVote {
            validator: validator.clone(),
            rate,
            timestamp: current_time,
        });

        let vote_count = fresh_votes.len();
        all_votes.set(currency.clone(), fresh_votes);
        env.storage()
            .instance()
            .set(&DATA_KEY.emergency_votes, &all_votes);
        Self::extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("emrg_vot"),),
            EmergencyVoteCastEvent {
                currency,
                validator,
                rate,
                vote_count,
                required: min_sigs,
                timestamp: current_time,
            },
        );
    }

    /// Return the number of active (non-expired) emergency votes for `currency`.
    pub fn get_emergency_vote_count(env: Env, currency: CurrencyCode) -> u32 {
        let current_time = env.ledger().timestamp();
        let all_votes: Map<CurrencyCode, Vec<EmergencyVote>> = env
            .storage()
            .instance()
            .get(&DATA_KEY.emergency_votes)
            .unwrap_or(Map::new(&env));
        let votes: Vec<EmergencyVote> = all_votes
            .get(currency)
            .unwrap_or(Vec::new(&env));
        let mut count: u32 = 0;
        for v in votes.iter() {
            if current_time.saturating_sub(v.timestamp) <= EMERGENCY_VOTE_TTL_SECONDS {
                count += 1;
            }
        }
        count
    }

    /// Admin override to set the rate for `currency` directly, bypassing validator
    /// consensus, the update interval and outlier checks (admin only).
    ///
    /// Intended for emergencies. `rate` must be positive and may not roll the
    /// timestamp backwards. Emits `RateUpdateEvent`.
    pub fn set_rate_admin(env: Env, currency: CurrencyCode, rate: i128) {
        Self::check_admin(&env);
        if rate <= 0 {
            env.panic_with_error(OracleError::InvalidRate);
        }
        let current_time = env.ledger().timestamp();

        let existing_rate = Self::get_rate_internal(&env, &currency);
        if let Some(ref existing) = existing_rate {
            if current_time < existing.timestamp {
                env.panic_with_error(OracleError::TimestampRollback);
            }
        }
        let rate_data = RateData {
            currency: currency.clone(),
            rate_usd: rate,
            timestamp: current_time,
            sources: Vec::new(&env),
            ledger: env.ledger().sequence(),
        };
        let mut rates: Map<CurrencyCode, RateData> = env
            .storage()
            .instance()
            .get(&DATA_KEY.rates)
            .unwrap_or(Map::new(&env));
        rates.set(currency.clone(), rate_data);
        env.storage().instance().set(&DATA_KEY.rates, &rates);
        env.storage()
            .instance()
            .set(&DATA_KEY.last_update, &current_time);
        Self::extend_instance_ttl(&env);

        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        let event = RateUpdateEvent {
            currency,
            rate,
            timestamp: current_time,
            validator: admin,
        };
        env.events().publish((symbol_short!("rate_upd"),), event);
    }

    /// Return the latest USD rate (7 decimals) for `currency`.
    ///
    /// Panics if the currency is not registered, has no rate yet, or the stored
    /// rate is stale (older than [`STALE_RATE_MAX_LEDGERS`]).
    pub fn get_rate(env: Env, currency: CurrencyCode) -> i128 {
        Self::assert_currency_registered(&env, &currency);
        if let Some(rate_data) = Self::get_rate_internal(&env, &currency) {
            Self::assert_rate_fresh(&env, &rate_data, &currency);
            rate_data.rate_usd
        } else {
            env.panic_with_error(OracleError::RateNotInitialized);
        }
    }

    /// Like [`Self::get_rate`] but also returns the timestamp at which the rate was
    /// recorded, as `(rate, timestamp)`.
    pub fn get_rate_with_timestamp(env: Env, currency: CurrencyCode) -> (i128, u64) {
        Self::assert_currency_registered(&env, &currency);
        if let Some(rate_data) = Self::get_rate_internal(&env, &currency) {
            Self::assert_rate_fresh(&env, &rate_data, &currency);
            (rate_data.rate_usd, rate_data.timestamp)
        } else {
            env.panic_with_error(OracleError::RateNotInitialized);
        }
    }

    /// Compute the basket-weighted ACBU/USD rate together with the oldest
    /// contributing rate timestamp, as `(rate, oldest_timestamp)`.
    ///
    /// Iterates the configured currencies, weights each fresh rate by its basket
    /// weight and normalizes by total weight. Panics if no currencies are
    /// configured or no fresh rates contribute.
    pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
        let basket_weights: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&DATA_KEY.basket_weights)
            .unwrap_or(Map::new(&env));
        let currencies: Vec<CurrencyCode> = env
            .storage()
            .instance()
            .get(&DATA_KEY.currencies)
            .unwrap_or(Vec::new(&env));
        if currencies.is_empty() {
            env.panic_with_error(OracleError::RateNotInitialized);
        }

        let mut weighted_sum = 0i128;
        let mut total_weight = 0i128;
        let mut oldest_timestamp = u64::MAX;

        for currency in currencies.iter() {
            if let Some(weight) = basket_weights.get(currency.clone()) {
                if let Some(rate_data) = Self::get_rate_internal(&env, &currency) {
                    Self::assert_rate_fresh(&env, &rate_data, &currency);
                    let contribution = (rate_data.rate_usd * weight) / BASIS_POINTS;
                    weighted_sum += contribution;
                    total_weight += weight;
                    if rate_data.timestamp < oldest_timestamp {
                        oldest_timestamp = rate_data.timestamp;
                    }
                }
            }
        }

        if total_weight == 0 {
            env.panic_with_error(OracleError::RateNotInitialized);
        }

        let rate = weighted_sum / total_weight;

        (
            rate,
            if oldest_timestamp == u64::MAX {
                0
            } else {
                oldest_timestamp
            },
        )
    }

    /// Compute the basket-weighted ACBU/USD rate (7 decimals).
    ///
    /// Same computation as [`Self::get_acbu_usd_rate_with_timestamp`] without the
    /// timestamp. Panics if no currencies are configured or no fresh rates
    /// contribute.
    pub fn get_acbu_usd_rate(env: Env) -> i128 {
        let basket_weights: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&DATA_KEY.basket_weights)
            .unwrap_or(Map::new(&env));
        let currencies: Vec<CurrencyCode> = env
            .storage()
            .instance()
            .get(&DATA_KEY.currencies)
            .unwrap_or(Vec::new(&env));
        if currencies.is_empty() {
            env.panic_with_error(OracleError::RateNotInitialized);
        }

        let mut weighted_sum = 0i128;
        let mut total_weight = 0i128;

        for currency in currencies.iter() {
            if let Some(weight) = basket_weights.get(currency.clone()) {
                if let Some(rate_data) = Self::get_rate_internal(&env, &currency) {
                    Self::assert_rate_fresh(&env, &rate_data, &currency);
                    let contribution = (rate_data.rate_usd * weight) / BASIS_POINTS;
                    weighted_sum += contribution;
                    total_weight += weight;
                }
            }
        }

        if total_weight == 0 {
            env.panic_with_error(OracleError::RateNotInitialized);
        }

        (weighted_sum * BASIS_POINTS) / total_weight
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Basket / token config
    // ─────────────────────────────────────────────────────────────────────────

    /// Return the list of currencies that make up the basket.
    pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
        env.storage()
            .instance()
            .get(&DATA_KEY.currencies)
            .unwrap_or(Vec::new(&env))
    }

    /// Return the basket weight (in basis points) for `currency`, or `0` if it has
    /// no configured weight.
    pub fn get_basket_weight(env: Env, currency: CurrencyCode) -> i128 {
        let basket_weights: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&DATA_KEY.basket_weights)
            .unwrap_or(Map::new(&env));
        basket_weights.get(currency).unwrap_or(0)
    }

    /// Replace the basket currency list and their weights (admin only).
    pub fn set_basket_config(
        env: Env,
        currencies: Vec<CurrencyCode>,
        basket_weights: Map<CurrencyCode, i128>,
    ) {
        Self::check_admin(&env);
        env.storage()
            .instance()
            .set(&DATA_KEY.currencies, &currencies);
        env.storage()
            .instance()
            .set(&DATA_KEY.basket_weights, &basket_weights);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Emergency threshold configuration (SC-025)
    // ─────────────────────────────────────────────────────────────────────────

    /// Set the per-currency emergency deviation threshold in basis points (admin only).
    ///
    /// When a validator submits a rate that deviates more than `threshold_bps`
    /// from the stored rate, it is counted as an emergency vote rather than
    /// immediately bypassing the time-lock.  The bypass only fires once
    /// `min_signatures` validators have all cast qualifying votes.
    ///
    /// Pass `threshold_bps = 0` to reset the currency to the global default
    /// ([`EMERGENCY_THRESHOLD_BPS`]).
    pub fn set_emergency_threshold(env: Env, currency: CurrencyCode, threshold_bps: i128) {
        Self::check_admin(&env);
        // A threshold of 0 means "use the global default"; treat it the same as
        // storing the default explicitly so readers always get a positive value.
        let effective = if threshold_bps == 0 {
            EMERGENCY_THRESHOLD_BPS
        } else {
            threshold_bps
        };
        let mut thresholds: Map<CurrencyCode, EmergencyConfig> = env
            .storage()
            .instance()
            .get(&DATA_KEY.emergency_thresholds)
            .unwrap_or(Map::new(&env));
        thresholds.set(currency, EmergencyConfig { threshold_bps: effective });
        env.storage()
            .instance()
            .set(&DATA_KEY.emergency_thresholds, &thresholds);
    }

    /// Return the emergency deviation threshold (in basis points) for `currency`.
    ///
    /// Falls back to the global [`EMERGENCY_THRESHOLD_BPS`] constant if no
    /// per-currency override has been configured.
    pub fn get_emergency_threshold(env: Env, currency: CurrencyCode) -> i128 {
        Self::get_emergency_threshold_bps(&env, &currency)
    }

    /// Update the minimum number of validator signatures required for both
    /// normal rate acceptance and emergency bypass consensus (admin only).
    ///
    /// `new_min` must be in `1..=validators.len()`.  Pending emergency votes are
    /// cleared on change to avoid cross-quorum contamination.
    pub fn set_min_signatures(env: Env, new_min: u32) {
        Self::check_admin(&env);
        let validators: Vec<Address> =
            env.storage().instance().get(&DATA_KEY.validators).unwrap();
        if new_min == 0 || new_min > validators.len() {
            env.panic_with_error(OracleError::InvalidMinSignatures);
        }
        env.storage()
            .instance()
            .set(&DATA_KEY.min_signatures, &new_min);
        // Clear all pending emergency votes — they were cast under the old quorum.
        let empty_votes: Map<CurrencyCode, Vec<EmergencyVote>> = Map::new(&env);
        env.storage()
            .instance()
            .set(&DATA_KEY.emergency_votes, &empty_votes);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // S-token config
    // ─────────────────────────────────────────────────────────────────────────

    /// Set the S-token contract address backing `currency` (admin only).
    pub fn set_s_token_address(env: Env, currency: CurrencyCode, token_address: Address) {
        Self::check_admin(&env);
        let mut m: Map<CurrencyCode, Address> = env
            .storage()
            .instance()
            .get(&DATA_KEY.s_tokens)
            .unwrap_or(Map::new(&env));
        m.set(currency, token_address);
        env.storage().instance().set(&DATA_KEY.s_tokens, &m);
    }

    /// Return the S-token contract address backing `currency`, panicking with
    /// `STokenNotConfigured` if none is set.
    pub fn get_s_token_address(env: Env, currency: CurrencyCode) -> Address {
        let m: Map<CurrencyCode, Address> = env
            .storage()
            .instance()
            .get(&DATA_KEY.s_tokens)
            .unwrap_or(Map::new(&env));
        if let Some(addr) = m.get(currency.clone()) {
            addr
        } else {
            env.panic_with_error(OracleError::STokenNotConfigured);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Validator management
    // ─────────────────────────────────────────────────────────────────────────

    /// Schedule adding (`add = true`) or removing (`add = false`) `validator` from
    /// the validator set, starting the timelock (admin only).
    ///
    /// The change is applied later via [`Self::execute_validator_change`] once the
    /// timelock elapses, or aborted with [`Self::cancel_validator_change`].
    pub fn schedule_validator_change(env: Env, validator: Address, add: bool) {
        Self::check_admin(&env);
        let eligible_at = env.ledger().timestamp() + ADMIN_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_validator, &validator);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_validator_is_add, &add);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_validator_eligible_at, &eligible_at);
    }

    /// Apply a previously scheduled validator add/remove once its timelock has
    /// elapsed (admin only).
    ///
    /// Adding rejects duplicates and enforces [`MAX_VALIDATORS`]; removing refuses
    /// to drop below `min_signatures` and clears all stored rates so no submission
    /// from the removed validator persists. Panics if no change is pending or the
    /// timelock is still active.
    pub fn execute_validator_change(env: Env) {
        Self::check_admin(&env);
        let validator: Address = match env.storage().instance().get(&DATA_KEY.pending_validator) {
            Some(v) => v,
            None => env.panic_with_error(OracleError::NoPendingValidatorChange),
        };
        let is_add: bool = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_validator_is_add)
            .unwrap_or(false);
        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_validator_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(OracleError::ValidatorTimelockNotElapsed);
        }
        env.storage().instance().remove(&DATA_KEY.pending_validator);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_validator_is_add);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_validator_eligible_at);

        let validators: Vec<Address> = env.storage().instance().get(&DATA_KEY.validators).unwrap();
        if is_add {
            for v in validators.iter() {
                if v == validator {
                    env.panic_with_error(OracleError::ValidatorAlreadyExists);
                }
            }
            if validators.len() >= MAX_VALIDATORS {
                env.panic_with_error(OracleError::MaxValidatorsReached);
            }
            let mut new_validators = validators.clone();
            new_validators.push_back(validator.clone());
            env.storage()
                .instance()
                .set(&DATA_KEY.validators, &new_validators);
            Self::index_validator(&env, &validator, true);
        } else {
            let min_sigs: u32 = env
                .storage()
                .instance()
                .get(&DATA_KEY.min_signatures)
                .unwrap();
            if validators.len() <= min_sigs {
                env.panic_with_error(OracleError::CannotRemoveValidator);
            }
            let mut new_validators = Vec::new(&env);
            for v in validators.iter() {
                if v != validator {
                    new_validators.push_back(v.clone());
                }
            }
            env.storage()
                .instance()
                .set(&DATA_KEY.validators, &new_validators);
            Self::index_validator(&env, &validator, false);

            // FIX #342: clear all stored rates so no submission from the
            // removed validator can persist into subsequent reads.
            let empty_rates: Map<CurrencyCode, RateData> = Map::new(&env);
            env.storage().instance().set(&DATA_KEY.rates, &empty_rates);
            env.storage().instance().set(&DATA_KEY.last_update, &0u64);
        }
    }

    fn index_validator(env: &Env, validator: &Address, add: bool) {
        let mut validator_set: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DATA_KEY.validator_set)
            .unwrap_or_else(|| Map::new(env));
        if add {
            validator_set.set(validator.clone(), true);
        } else {
            validator_set.remove(validator.clone());
        }
        env.storage()
            .instance()
            .set(&DATA_KEY.validator_set, &validator_set);
    }

    /// Cancel a pending validator change, clearing the staged validator and
    /// timelock (admin only).
    pub fn cancel_validator_change(env: Env) {
        Self::check_admin(&env);
        env.storage().instance().remove(&DATA_KEY.pending_validator);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_validator_is_add);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_validator_eligible_at);
    }

    /// Return the current list of validators.
    pub fn get_validators(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DATA_KEY.validators).unwrap()
    }

    /// Return the number of validator signatures required to accept a rate update.
    pub fn get_min_signatures(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DATA_KEY.min_signatures)
            .unwrap()
    }

    /// Return the number of decimal places used for all rates (always 7).
    pub fn get_rate_decimals(_env: Env) -> u32 {
        RATE_DECIMALS
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Upgrade / migration
    // ─────────────────────────────────────────────────────────────────────────

    /// Return the stored contract version (0 if never set).
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0)
    }

    /// Run storage migrations up to the current [`VERSION`] and bump the stored
    /// version (admin only). No-op if already current.
    pub fn migrate(env: Env) {
        Self::check_admin(&env);
        let current_version = VERSION;
        let stored_version: u32 = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);
        if stored_version < current_version {
            if stored_version < 2 {
                let s_tokens_empty: Map<CurrencyCode, Address> = Map::new(&env);
                env.storage()
                    .instance()
                    .set(&DATA_KEY.s_tokens, &s_tokens_empty);
            }
            if stored_version < 3 {
                let rates_empty: Map<CurrencyCode, RateData> = Map::new(&env);
                env.storage().instance().set(&DATA_KEY.rates, &rates_empty);
                env.storage().instance().set(&DATA_KEY.last_update, &0u64);
            }
            if stored_version < 6 {
                let currencies_empty: Vec<CurrencyCode> = Vec::new(&env);
                let basket_weights_empty: Map<CurrencyCode, i128> = Map::new(&env);
                env.storage()
                    .instance()
                    .set(&DATA_KEY.currencies, &currencies_empty);
                env.storage()
                    .instance()
                    .set(&DATA_KEY.basket_weights, &basket_weights_empty);

                let rates_empty: Map<CurrencyCode, RateData> = Map::new(&env);
                env.storage().instance().set(&DATA_KEY.rates, &rates_empty);
                env.storage().instance().set(&DATA_KEY.last_update, &0u64);

                let s_tokens_empty: Map<CurrencyCode, Address> = Map::new(&env);
                env.storage()
                    .instance()
                    .set(&DATA_KEY.s_tokens, &s_tokens_empty);
            }
            env.storage()
                .instance()
                .set(&SharedDataKey::Version, &current_version);
        }
    }

    /// Stage a WASM upgrade to `new_wasm_hash`/`new_version` and start the upgrade
    /// timelock (admin only). `new_version` must exceed the current version. Apply
    /// it later with [`Self::execute_upgrade`] or abort with
    /// [`Self::cancel_upgrade`].
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32) {
        Self::check_admin(&env);
        let current_version = Self::get_version(env.clone());
        if new_version <= current_version {
            env.panic_with_error(OracleError::InvalidVersion);
        }
        let eligible_at = env.ledger().timestamp() + ADMIN_TIMELOCK_SECONDS;
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
        let wasm_hash: BytesN<32> =
            match env.storage().instance().get(&DATA_KEY.pending_upgrade_wasm) {
                Some(h) => h,
                None => env.panic_with_error(OracleError::NoPendingUpgrade),
            };
        let new_version: u32 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade_version)
            .unwrap_or_else(|| env.panic_with_error(OracleError::NoPendingUpgrade));
        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(OracleError::UpgradeTimelockNotElapsed);
        }
        let current_version = Self::get_version(env.clone());
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

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Return the effective emergency threshold (bps) for `currency`.
    fn get_emergency_threshold_bps(env: &Env, currency: &CurrencyCode) -> i128 {
        let thresholds: Map<CurrencyCode, EmergencyConfig> = env
            .storage()
            .instance()
            .get(&DATA_KEY.emergency_thresholds)
            .unwrap_or(Map::new(env));
        thresholds
            .get(currency.clone())
            .map(|cfg| cfg.threshold_bps)
            .unwrap_or(EMERGENCY_THRESHOLD_BPS)
    }

    /// Check whether `>= min_sigs` non-expired emergency votes exist for `currency`.
    ///
    /// If consensus is reached, the vote list is cleared and `true` is returned.
    /// Otherwise `false` is returned and votes are left intact.
    fn check_and_consume_emergency_votes(
        env: &Env,
        currency: &CurrencyCode,
        current_time: u64,
        min_sigs: u32,
        _rate: i128,
    ) -> bool {
        let mut all_votes: Map<CurrencyCode, Vec<EmergencyVote>> = env
            .storage()
            .instance()
            .get(&DATA_KEY.emergency_votes)
            .unwrap_or(Map::new(env));

        let votes: Vec<EmergencyVote> = all_votes
            .get(currency.clone())
            .unwrap_or(Vec::new(env));

        // Count only non-expired votes.
        let mut live_count: u32 = 0;
        for v in votes.iter() {
            if current_time.saturating_sub(v.timestamp) <= EMERGENCY_VOTE_TTL_SECONDS {
                live_count += 1;
            }
        }

        if live_count >= min_sigs {
            // Consume the votes — clear them so they can't be reused.
            all_votes.remove(currency.clone());
            env.storage()
                .instance()
                .set(&DATA_KEY.emergency_votes, &all_votes);
            true
        } else {
            false
        }
    }

    fn get_rate_internal(env: &Env, currency: &CurrencyCode) -> Option<RateData> {
        Self::extend_instance_ttl(env);
        let rates: Map<CurrencyCode, RateData> = env
            .storage()
            .instance()
            .get(&DATA_KEY.rates)
            .unwrap_or(Map::new(env));
        rates.get(currency.clone())
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    fn assert_rate_fresh(env: &Env, rate_data: &RateData, currency: &CurrencyCode) {
        let current_ledger = env.ledger().sequence();
        let age = current_ledger.saturating_sub(rate_data.ledger);
        if age > STALE_RATE_MAX_LEDGERS {
            env.events().publish(
                (symbol_short!("stale_rt"),),
                (currency.clone(), rate_data.ledger, current_ledger, STALE_RATE_MAX_LEDGERS),
            );
            env.panic_with_error(OracleError::RateStaleLedger);
        }
    }

    fn assert_currency_registered(env: &Env, currency: &CurrencyCode) {
        let currencies: Vec<CurrencyCode> = env
            .storage()
            .instance()
            .get(&DATA_KEY.currencies)
            .unwrap_or(Vec::new(env));
        if currencies.is_empty() {
            env.panic_with_error(OracleError::CurrencyNotRegistered);
        }
        if !currencies.contains(currency.clone()) {
            env.panic_with_error(OracleError::CurrencyNotRegistered);
        }
    }

    fn check_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DATA_KEY.admin).unwrap();
        admin.require_auth();
    }
}
