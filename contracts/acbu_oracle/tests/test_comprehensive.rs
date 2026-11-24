#![cfg(test)]

use acbu_oracle::{OracleContract, OracleContractClient, EMERGENCY_UPDATE_COOLDOWN_SECONDS};
use shared::{CurrencyCode, OutlierDetectionEvent, RateUpdateEvent, STALE_RATE_MAX_LEDGERS};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, Env, FromVal, IntoVal, Map, Symbol, Vec,
};

/// Helper to advance ledger and refresh TTL
fn advance_ledger_to(env: &Env, contract_id: &Address, target_seq: u32) {
    const TTL_TARGET: u32 = 1_000_000;
    while env.ledger().sequence() < target_seq {
        let cur = env.ledger().sequence();
        let next = (cur + 200).min(target_seq);
        env.ledger().with_mut(|l| l.sequence_number = next);
        env.deployer()
            .extend_ttl(contract_id.clone(), TTL_TARGET, TTL_TARGET);
    }
}

/// Test helper: setup oracle with basic configuration
fn setup() -> (
    Env,
    OracleContractClient<'static>,
    Address,
    Address,
    Vec<Address>,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);
    let validator1 = Address::generate(&env);
    let validator2 = Address::generate(&env);
    let validator3 = Address::generate(&env);

    let mut validators = Vec::new(&env);
    validators.push_back(validator1.clone());
    validators.push_back(validator2.clone());
    validators.push_back(validator3.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    currencies.push_back(kes.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn, 5000i128); // 50%
    basket_weights.set(kes, 5000i128); // 50%

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);

    client.initialize(&admin, &validators, &2u32, &currencies, &basket_weights);

    (env, client, contract_id, admin, validators)
}

/// Submit the same rate from `min_signatures` validators (2 in `setup`) so the
/// round commits (AC-003).
fn submit_quorum(
    env: &Env,
    client: &OracleContractClient,
    validators: &Vec<Address>,
    currency: &CurrencyCode,
    rate: &i128,
    sources: &Vec<i128>,
) {
    for i in 0..client.get_min_signatures() {
        let v = validators.get(i).unwrap();
        client.update_rate(&v, currency, rate, sources, &env.ledger().timestamp());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATOR MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_add_validator() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let new_validator = Address::generate(&env);
    client.schedule_validator_change(&new_validator, &true);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute_validator_change();

    let validators = client.get_validators();
    assert_eq!(validators.len(), 4, "validators.len() should equal 4");
    assert!(validators.iter().any(|v| v == new_validator));
}

#[test]
fn test_add_duplicate_validator_fails() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let existing_validator = validators.get(0).unwrap();
    client.schedule_validator_change(&existing_validator, &true);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    let result = client.try_execute_validator_change();

    assert!(result.is_err());
}

#[test]
fn test_remove_validator() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let validator_to_remove = validators.get(2).unwrap();
    client.schedule_validator_change(&validator_to_remove, &false);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute_validator_change();

    let remaining_validators = client.get_validators();
    assert_eq!(remaining_validators.len(), 2, "remaining_validators.len() should equal 2");
    assert!(!remaining_validators.iter().any(|v| v == validator_to_remove));
}

#[test]
fn test_remove_validator_below_min_signatures_fails() {
    let (env, client, _contract_id, _admin, validators) = setup();

    // min_signatures is 2, we have 3 validators
    // Remove one (now 2 validators)
    client.schedule_validator_change(&validators.get(2).unwrap(), &false);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute_validator_change();

    // Try to remove another (would leave 1 validator, below min_signatures of 2)
    client.schedule_validator_change(&validators.get(1).unwrap(), &false);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    let result = client.try_execute_validator_change();
    assert!(result.is_err());
}

#[test]
fn test_get_validators() {
    let (_env, client, _contract_id, _admin, validators) = setup();

    let stored_validators = client.get_validators();
    assert_eq!(stored_validators.len(), 3, "stored_validators.len() should equal 3");
    assert_eq!(stored_validators, validators, "stored_validators should equal validators");
}

#[test]
fn test_get_min_signatures() {
    let (_env, client, _contract_id, _admin, _validators) = setup();

    assert_eq!(client.get_min_signatures(), 2, "client.get_min_signatures() should equal 2");
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE UPDATE TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_update_rate_by_validator() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_234_567i128;
    let mut sources = Vec::new(&env);
    sources.push_back(1_230_000i128);
    sources.push_back(1_235_000i128);
    sources.push_back(1_239_000i128);

    submit_quorum(&env, &client, &validators, &ngn, &rate, &sources);

    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1_235_000, "stored_rate should equal 1_235_000"); // median of sources
}

#[test]
fn test_update_rate_by_non_validator_fails() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let non_validator = Address::generate(&env);
    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_234_567i128;
    let sources = Vec::new(&env);

    let result = client.try_update_rate(
        &non_validator,
        &ngn,
        &rate,
        &sources,
        &env.ledger().timestamp(),
    );
    assert!(result.is_err());
}

#[test]
fn test_update_rate_with_insufficient_sources_fails() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let validator = validators.get(0).unwrap();
    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_234_567i128;
    let mut sources = Vec::new(&env);
    sources.push_back(1_230_000i128);
    sources.push_back(1_235_000i128);
    // Only 2 sources, need at least 3

    let result =
        client.try_update_rate(&validator, &ngn, &rate, &sources, &env.ledger().timestamp());
    assert!(result.is_err());
}

#[test]
fn test_update_rate_emits_event() {
    let (env, client, contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_234_567i128;
    let mut sources = Vec::new(&env);
    sources.push_back(1_230_000i128);
    sources.push_back(1_235_000i128);
    sources.push_back(1_239_000i128);

    submit_quorum(&env, &client, &validators, &ngn, &rate, &sources);

    let events = env.events().all();
    let rate_update_event = events
        .iter()
        .find(|e| {
            e.0 == contract_id
                && !e.1.is_empty()
                && Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("rate_upd")
        })
        .expect("rate_upd event not found");

    // The event names the validator whose submission completed the quorum.
    let event_data: RateUpdateEvent = rate_update_event.2.into_val(&env);
    assert_eq!(event_data.currency, ngn, "event_data.currency should equal ngn");
    assert_eq!(event_data.rate, 1_235_000, "event_data.rate should equal 1_235_000");
    assert_eq!(
        event_data.validator,
        validators.get(1).unwrap(),
        "event_data.validator should be the quorum-completing validator"
    );
}

#[test]
fn test_update_rate_before_interval_fails() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let validator = validators.get(0).unwrap();
    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_234_567i128;
    let mut sources = Vec::new(&env);
    sources.push_back(1_230_000i128);
    sources.push_back(1_235_000i128);
    sources.push_back(1_239_000i128);

    // First update
    submit_quorum(&env, &client, &validators, &ngn, &rate, &sources);

    // Try to update again immediately (before 6 hours)
    env.ledger().with_mut(|l| l.timestamp += 1000); // Only 1000 seconds later

    let result =
        client.try_update_rate(&validator, &ngn, &rate, &sources, &env.ledger().timestamp());
    assert!(result.is_err());
}

#[test]
fn test_update_rate_with_emergency_deviation_bypasses_interval() {
    // SC-025: A single validator can no longer unilaterally bypass the update interval.
    // The bypass now requires N-of-M (min_signatures) validators to first call
    // cast_emergency_vote, and then min_signatures validators submit via
    // update_rate to commit (AC-003).
    // setup() initialises min_signatures = 2, so two validators must agree.
    let (env, client, _contract_id, _admin, validators) = setup();

    let validator = validators.get(0).unwrap();
    let validator2 = validators.get(1).unwrap();
    let ngn = CurrencyCode::new(&env, "NGN");
    let initial_rate = 1_000_000i128;
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_000i128);

    // Seed an initial rate.
    submit_quorum(&env, &client, &validators, &ngn, &initial_rate, &sources);

    // Advance past the emergency cooldown (AC-029) but well within the 6h
    // update interval.
    env.ledger().with_mut(|l| l.timestamp += EMERGENCY_UPDATE_COOLDOWN_SECONDS + 1);
    let emergency_rate = 1_060_000i128; // 6% above threshold (>5%)
    let mut emergency_sources = Vec::new(&env);
    emergency_sources.push_back(1_060_000i128);
    emergency_sources.push_back(1_060_000i128);
    emergency_sources.push_back(1_060_000i128);

    // Step 1: Both validators cast emergency votes.
    client.cast_emergency_vote(&validator, &ngn, &emergency_rate);
    client.cast_emergency_vote(&validator2, &ngn, &emergency_rate);

    // Step 2: Now consensus is met (2-of-3) — update_rate grants the bypass.
    submit_quorum(&env, &client, &validators, &ngn, &emergency_rate, &emergency_sources);

    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1_060_000, "stored_rate should equal 1_060_000 after 2-of-3 consensus");
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTLIER DETECTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_outlier_detection_filters_bad_source() {
    let (env, client, contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_000_000i128;
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_005_000i128);
    sources.push_back(1_350_000i128); // Outlier

    submit_quorum(&env, &client, &validators, &ngn, &rate, &sources);

    // Stored rate should be median of clean sources only
    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1_002_500, "stored_rate should equal 1_002_500"); // (1_000_000 + 1_005_000) / 2

    // Check outlier event was emitted
    let events = env.events().all();
    let outlier_event = events
        .iter()
        .find(|e| {
            e.0 == contract_id
                && !e.1.is_empty()
                && Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("outlier")
        })
        .expect("outlier event not found");

    let event_data: OutlierDetectionEvent = outlier_event.2.into_val(&env);
    assert_eq!(event_data.outlier_rate, 1_350_000, "event_data.outlier_rate should equal 1_350_000");
}

#[test]
fn test_all_sources_outlier_uses_fallback() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let rate = 1_000_000i128;
    let mut sources = Vec::new(&env);
    sources.push_back(500_000i128);
    sources.push_back(2_000_000i128);
    sources.push_back(1_250_000i128);

    submit_quorum(&env, &client, &validators, &ngn, &rate, &sources);

    // Should not panic, should use fallback
    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1_250_000, "stored_rate should equal 1_250_000"); // raw median
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN RATE OVERRIDE TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_admin_can_set_rate() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let admin_rate = 2_000_000i128;

    client.set_rate_admin(&ngn, &admin_rate);

    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, admin_rate, "stored_rate should equal admin_rate");
}

#[test]
fn test_admin_set_rate_zero_fails() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let result = client.try_set_rate_admin(&ngn, &0);

    assert!(result.is_err());
}

#[test]
fn test_admin_set_rate_negative_fails() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let result = client.try_set_rate_admin(&ngn, &-100);

    assert!(result.is_err());
}

/// AC-013 (#736): once a rate exists, the admin override is subject to the
/// update interval — a rewrite within 6h must fail even at small deviation.
#[test]
fn test_admin_set_rate_rejects_before_interval() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    client.set_rate_admin(&ngn, &1_000_000i128); // bootstrap (no prior rate)

    // Still within the 6h interval — only 2% away, but too soon.
    let result = client.try_set_rate_admin(&ngn, &1_020_000i128);
    assert!(result.is_err(), "admin override before update interval must fail");
}

/// AC-013 (#736): even after the interval, a deviation beyond the
/// per-currency emergency threshold (5%) is rejected with AdminDeviationTooLarge
/// (#7026) — such moves require cast_emergency_vote + update_rate consensus.
#[test]
#[should_panic(expected = "#7026")]
fn test_admin_set_rate_rejects_deviation_above_emergency_threshold() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    client.set_rate_admin(&ngn, &1_000_000i128); // bootstrap

    env.ledger().with_mut(|l| l.timestamp += 21_601); // interval elapsed

    client.set_rate_admin(&ngn, &1_100_000i128); // 10% > 5% threshold
}

/// AC-013 (#736): a within-threshold adjustment after the interval still works,
/// so the override remains usable for small emergency corrections.
#[test]
fn test_admin_set_rate_within_threshold_after_interval_succeeds() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    client.set_rate_admin(&ngn, &1_000_000i128); // bootstrap

    env.ledger().with_mut(|l| l.timestamp += 21_601);

    client.set_rate_admin(&ngn, &1_040_000i128); // 4% <= 5% threshold
    assert_eq!(client.get_rate(&ngn), 1_040_000, "client.get_rate(&ngn) should equal 1_040_000");
}

// ═══════════════════════════════════════════════════════════════════════════
// BASKET CONFIGURATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_basket_config() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let usd = CurrencyCode::new(&env, "USD");
    let eur = CurrencyCode::new(&env, "EUR");
    let mut new_currencies = Vec::new(&env);
    new_currencies.push_back(usd.clone());
    new_currencies.push_back(eur.clone());

    let mut new_weights = Map::new(&env);
    new_weights.set(usd.clone(), 6000i128); // 60%
    new_weights.set(eur.clone(), 4000i128); // 40%

    client.set_basket_config(&new_currencies, &new_weights);

    let stored_currencies = client.get_currencies();
    assert_eq!(stored_currencies.len(), 2, "stored_currencies.len() should equal 2");
    assert_eq!(client.get_basket_weight(&usd), 6000, "client.get_basket_weight(&usd) should equal 6000");
    assert_eq!(client.get_basket_weight(&eur), 4000, "client.get_basket_weight(&eur) should equal 4000");
}

#[test]
fn test_get_basket_weight_nonexistent_returns_zero() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let nonexistent = CurrencyCode::new(&env, "XXX");
    assert_eq!(client.get_basket_weight(&nonexistent), 0, "client.get_basket_weight(&nonexistent) should equal 0");
}

// ═══════════════════════════════════════════════════════════════════════════
// S-TOKEN ADDRESS TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_and_get_s_token_address() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let token_address = Address::generate(&env);

    client.set_s_token_address(&ngn, &token_address);

    let stored_address = client.get_s_token_address(&ngn);
    assert_eq!(stored_address, token_address, "stored_address should equal token_address");
}

#[test]
fn test_get_s_token_address_not_configured_fails() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let nonexistent = CurrencyCode::new(&env, "XXX");
    let result = client.try_get_s_token_address(&nonexistent);

    assert!(result.is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// ACBU RATE CALCULATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_get_acbu_usd_rate_basket_weighted() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");

    // Set rates for both currencies
    let mut ngn_sources = Vec::new(&env);
    ngn_sources.push_back(1_000_000i128);
    ngn_sources.push_back(1_000_000i128);
    ngn_sources.push_back(1_000_000i128);
    submit_quorum(&env, &client, &validators, &ngn, &1_000_000i128, &ngn_sources);

    let mut kes_sources = Vec::new(&env);
    kes_sources.push_back(2_000_000i128);
    kes_sources.push_back(2_000_000i128);
    kes_sources.push_back(2_000_000i128);
    submit_quorum(&env, &client, &validators, &kes, &2_000_000i128, &kes_sources);

    // Basket is 50% NGN (1.0) + 50% KES (2.0) = 1.5
    let acbu_rate = client.get_acbu_usd_rate();
    assert_eq!(acbu_rate, 1_500_000, "acbu_rate should equal 1_500_000");
}

#[test]
fn test_get_acbu_usd_rate_with_timestamp() {
    let (env, client, _contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");

    let mut ngn_sources = Vec::new(&env);
    ngn_sources.push_back(1_000_000i128);
    ngn_sources.push_back(1_000_000i128);
    ngn_sources.push_back(1_000_000i128);
    submit_quorum(&env, &client, &validators, &ngn, &1_000_000i128, &ngn_sources);

    let mut kes_sources = Vec::new(&env);
    kes_sources.push_back(2_000_000i128);
    kes_sources.push_back(2_000_000i128);
    kes_sources.push_back(2_000_000i128);
    submit_quorum(&env, &client, &validators, &kes, &2_000_000i128, &kes_sources);

    let (rate, timestamp) = client.get_acbu_usd_rate_with_timestamp();
    // 50% NGN (1.0) + 50% KES (2.0) = 1.5 USD in 7 decimals, identical to
    // get_acbu_usd_rate (AC-001: previously under-reported as 150).
    assert_eq!(rate, 1_500_000, "rate should equal 1_500_000");
    assert_eq!(rate, client.get_acbu_usd_rate(), "both basket getters must agree");
    assert_eq!(timestamp, env.ledger().timestamp(), "timestamp should equal env.ledger().timestamp()");
}

// ═══════════════════════════════════════════════════════════════════════════
// STALENESS TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_stale_rate_rejected() {
    let (env, client, contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);

    submit_quorum(&env, &client, &validators, &ngn, &1_000_000i128, &sources);

    // Advance past staleness threshold
    advance_ledger_to(&env, &contract_id, 100 + STALE_RATE_MAX_LEDGERS + 1);

    let result = client.try_get_rate(&ngn);
    assert!(result.is_err());
}

#[test]
fn test_rate_at_staleness_boundary_accepted() {
    let (env, client, contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);

    submit_quorum(&env, &client, &validators, &ngn, &1_000_000i128, &sources);

    // Advance exactly to the boundary
    advance_ledger_to(&env, &contract_id, 100 + STALE_RATE_MAX_LEDGERS);

    let rate = client.get_rate(&ngn);
    assert_eq!(rate, 1_000_000, "rate should equal 1_000_000");
}

#[test]
fn test_admin_override_refreshes_stale_rate() {
    let (env, client, contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);

    submit_quorum(&env, &client, &validators, &ngn, &1_000_000i128, &sources);

    // Advance past staleness, and past the update interval so the gated
    // admin override (AC-013) is eligible to refresh the feed.
    advance_ledger_to(&env, &contract_id, 100 + STALE_RATE_MAX_LEDGERS + 1);
    env.ledger().with_mut(|l| l.timestamp += 21_601);

    // Admin refreshes
    client.set_rate_admin(&ngn, &1_050_000i128);

    // Should now be readable
    let rate = client.get_rate(&ngn);
    assert_eq!(rate, 1_050_000, "rate should equal 1_050_000");
}

#[test]
fn test_stale_basket_component_blocks_acbu_rate() {
    let (env, client, contract_id, _admin, validators) = setup();

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);

    submit_quorum(&env, &client, &validators, &ngn, &1_000_000i128, &sources);

    // Advance past staleness
    advance_ledger_to(&env, &contract_id, 100 + STALE_RATE_MAX_LEDGERS + 1);

    let result = client.try_get_acbu_usd_rate_with_timestamp();
    assert!(result.is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ROTATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_transfer_admin_initiates_pending() {
    let (env, client, _contract_id, admin, _validators) = setup();

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    let pending = client.get_pending_admin().expect("pending admin should be set");
    assert_eq!(pending, new_admin, "pending should equal new_admin");

    // Current admin should still be the same
    assert_eq!(client.get_admin(), admin, "client.get_admin() should equal admin");
}

#[test]
fn test_accept_admin_before_timelock_fails() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    // Try to accept immediately
    let result = client.try_accept_admin();
    assert!(result.is_err());
}

#[test]
fn test_accept_admin_after_timelock_succeeds() {
    let (env, client, _contract_id, _admin, _validators) = setup();

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    // Advance time past timelock (24 hours = 86400 seconds)
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    client.accept_admin();

    assert_eq!(client.get_admin(), new_admin, "client.get_admin() should equal new_admin");
    assert!(client.get_pending_admin().is_none());
}

#[test]
fn test_cancel_admin_transfer() {
    let (env, client, _contract_id, admin, _validators) = setup();

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    client.cancel_admin_transfer();

    assert!(client.get_pending_admin().is_none());
    assert_eq!(client.get_admin(), admin, "client.get_admin() should equal admin");
}

#[test]
fn test_cancel_admin_transfer_when_none_pending_fails() {
    let (_env, client, _contract_id, _admin, _validators) = setup();

    let result = client.try_cancel_admin_transfer();
    assert!(result.is_err());
}
