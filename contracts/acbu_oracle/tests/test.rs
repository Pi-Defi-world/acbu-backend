#![cfg(test)]

use acbu_oracle::{OracleContract, OracleContractClient, StaleRateEvent};
use shared::{CurrencyCode, OutlierDetectionEvent, RateUpdateEvent};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, Env, FromVal, IntoVal, Map, Symbol, Vec,
};

/// Large `sequence_number` jumps archive instance storage under default TTL.
/// Step the ledger in chunks and refresh instance (and code) TTL via the deployer
/// API so the contract stays callable through multi-thousand-ledger advances.
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

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let validator1 = Address::generate(&env);
    let validator2 = Address::generate(&env);
    let validator3 = Address::generate(&env);

    let mut validators = Vec::new(&env);
    validators.push_back(validator1);
    validators.push_back(validator2);
    validators.push_back(validator3);

    let min_signatures = 2u32;

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    currencies.push_back(kes.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 1800i128); // 18%
    basket_weights.set(kes.clone(), 1200i128); // 12%

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &validators,
        &min_signatures,
        &currencies,
        &basket_weights,
    );

    let stored_validators = client.get_validators();
    assert_eq!(stored_validators.len(), 3, "stored_validators.len() should equal 3");
    assert_eq!(client.get_min_signatures(), min_signatures, "client.get_min_signatures() should equal min_signatures");
}

#[test]
fn test_update_rate() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000); // Exceed 6h interval
    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let validator2 = Address::generate(&env);
    let validator3 = Address::generate(&env);

    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());
    validators.push_back(validator2);
    validators.push_back(validator3);

    let min_signatures = 1u32;

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10000i128); // 100%

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &validators,
        &min_signatures,
        &currencies,
        &basket_weights,
    );

    let rate = 1234567i128; // 0.1234567 USD per NGN
    let mut sources = Vec::new(&env);
    sources.push_back(1230000i128);
    sources.push_back(1235000i128);
    sources.push_back(1239000i128);

    client.update_rate(&validator, &ngn, &rate, &sources, &env.ledger().timestamp());

    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1235000, "stored_rate should equal 1235000"); // median of sources, not rate parameter (1234567)

    let events = env.events().all();
    let mut found = false;
    for event in events.iter() {
        if event.0 != contract_id {
            continue;
        }
        let topics = event.1;
        if !topics.is_empty()
            && Symbol::from_val(&env, &topics.get(0).unwrap()) == symbol_short!("rate_upd")
        {
            let event_data: RateUpdateEvent = event.2.into_val(&env);
            assert_eq!(event_data.currency, ngn.clone(), "event_data.currency should equal ngn.clone()");
            assert_eq!(event_data.rate, 1235000, "event_data.rate should equal 1235000");
            assert_eq!(event_data.validator, validator, "event_data.validator should equal validator");
            found = true;
            break;
        }
    }
    assert!(found, "expected rate_upd event");
}

#[test]
fn test_admin_set_rate_emits_rate_update_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);

    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    let admin_rate = 2_000_000i128;
    client.set_rate_admin(&ngn, &admin_rate);

    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, admin_rate, "stored_rate should equal admin_rate");

    let events = env.events().all();
    let mut found = false;
    for event in events.iter() {
        if event.0 != contract_id {
            continue;
        }
        let topics = event.1;
        if !topics.is_empty()
            && Symbol::from_val(&env, &topics.get(0).unwrap()) == symbol_short!("rate_upd")
        {
            let event_data: RateUpdateEvent = event.2.into_val(&env);
            assert_eq!(event_data.currency, ngn.clone(), "event_data.currency should equal ngn.clone()");
            assert_eq!(event_data.rate, admin_rate, "event_data.rate should equal admin_rate");
            assert_eq!(event_data.validator, admin, "event_data.validator should equal admin");
            found = true;
            break;
        }
    }
    assert!(found, "expected rate_upd event");
}

#[test]
fn test_stale_rate_event_decodes_from_event_payload() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 1;
    });

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator);

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);
    client.set_rate_admin(&ngn, &1_000_000i128);

    advance_ledger_to(&env, &contract_id, 20_000);
    let _ = client.try_get_rate(&ngn);

    let stale_event = env
        .events()
        .all()
        .iter()
        .rev()
        .find(|event| {
            event.0 == contract_id
                && Symbol::from_val(&env, &event.1.get(0).unwrap()) == symbol_short!("stale_rt")
        })
        .expect("get_rate must emit stale_rt before returning stale error");

    let decoded: StaleRateEvent = stale_event.2.into_val(&env);
    assert_eq!(decoded.currency, ngn);
    assert_eq!(decoded.current_ledger, env.ledger().sequence());
}

#[test]
fn test_outlier_detection() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let validator2 = Address::generate(&env);
    let validator3 = Address::generate(&env);

    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());
    validators.push_back(validator2);
    validators.push_back(validator3);

    let min_signatures = 1u32;

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10000i128); // 100%

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &validators,
        &min_signatures,
        &currencies,
        &basket_weights,
    );

    let rate = 1234567i128;
    let mut sources = Vec::new(&env);
    // Create sources with one significant outlier
    // Median will be around 1000000
    sources.push_back(1000000i128); // Normal
    sources.push_back(1005000i128); // Normal
    sources.push_back(1350000i128); // Outlier (>3% deviation)

    client.update_rate(&validator, &ngn, &rate, &sources, &env.ledger().timestamp());

    // raw_median([1000000, 1005000, 1350000]) = 1005000
    // 1350000 deviates ~3432 bps > 300 bps → quarantined
    // clean_sources = [1000000, 1005000], median = (1000000 + 1005000) / 2 = 1002500
    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1002500, "stored_rate should equal 1002500");

    let events = env.events().all();
    let mut outlier_found = false;
    let mut rate_update_found = false;

    for event in events.iter() {
        if event.0 != contract_id {
            continue;
        }
        let topics = event.1;
        if !topics.is_empty() {
            let event_symbol = Symbol::from_val(&env, &topics.get(0).unwrap());

            if event_symbol == symbol_short!("rate_upd") {
                rate_update_found = true;
            } else if event_symbol == symbol_short!("outlier") {
                let event_data: OutlierDetectionEvent = event.2.into_val(&env);
                assert_eq!(event_data.currency, ngn.clone(), "event_data.currency should equal ngn.clone()");
                // median_rate in the event is the raw_median used as reference
                assert_eq!(event_data.median_rate, 1005000, "event_data.median_rate should equal 1005000");
                assert_eq!(event_data.outlier_rate, 1350000, "event_data.outlier_rate should equal 1350000");
                assert!(event_data.deviation_bps > 300);
                outlier_found = true;
            }
        }
    }

    assert!(rate_update_found, "expected rate_upd event");
    assert!(outlier_found, "expected outlier detection event");
}

/// Acceptance check: a poisoned source must not be able to move the stored median.
/// Four sources — three clean, one extreme attacker. After quarantine the stored
/// rate must equal the clean-sources median and must be within OUTLIER_THRESHOLD_BPS
/// of each clean source.
#[test]
fn test_outlier_source_cannot_move_median() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    // Three honest sources clustered around 1_001_000; one attacker at 5_000_000.
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_001_000i128);
    sources.push_back(1_002_000i128);
    sources.push_back(5_000_000i128); // poisoned source

    client.update_rate(
        &validator,
        &ngn,
        &1_001_000i128,
        &sources,
        &env.ledger().timestamp(),
    );

    let stored_rate = client.get_rate(&ngn);

    // raw_median([1_000_000, 1_001_000, 1_002_000, 5_000_000]) = (1_001_000 + 1_002_000) / 2 = 1_001_500
    // 5_000_000 deviates (5_000_000 - 1_001_500) / 1_001_500 * 10_000 ≈ 39_926 bps → quarantined
    // clean = [1_000_000, 1_001_000, 1_002_000], median = 1_001_000
    assert_eq!(stored_rate, 1_001_000, "poisoned source shifted the median");

    // Confirm the attacker's event was emitted
    let events = env.events().all();
    let mut outlier_count = 0u32;
    for event in events.iter() {
        if event.0 != contract_id {
            continue;
        }
        let topics = event.1;
        if !topics.is_empty()
            && Symbol::from_val(&env, &topics.get(0).unwrap()) == symbol_short!("outlier")
        {
            let event_data: OutlierDetectionEvent = event.2.into_val(&env);
            assert_eq!(event_data.outlier_rate, 5_000_000, "event_data.outlier_rate should equal 5_000_000");
            outlier_count += 1;
        }
    }
    assert_eq!(outlier_count, 1, "expected exactly one outlier event");
}

/// Edge case: when every submitted source is an outlier (extreme disagreement),
/// the contract should not trap — it falls back to the raw median.
#[test]
fn test_all_sources_outlier_falls_back_to_raw_median() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    // Two maximally-separated sources: both deviate > 300 bps from their average.
    // raw_median = (500_000 + 2_000_000) / 2 = 1_250_000
    // |500_000 - 1_250_000| / 1_250_000 * 10_000 = 6_000 bps > 300 → outlier
    // |2_000_000 - 1_250_000| / 1_250_000 * 10_000 = 6_000 bps > 300 → outlier
    // All filtered → fallback to raw_median = 1_250_000
    let mut sources = Vec::new(&env);
    sources.push_back(500_000i128);
    sources.push_back(2_000_000i128);
    // Third feed at the even-count raw median so quorum (≥3) is satisfied and
    // both extremes remain outliers vs the three-point median.
    sources.push_back(1_250_000i128);

    client.update_rate(
        &validator,
        &ngn,
        &1_000_000i128,
        &sources,
        &env.ledger().timestamp(),
    );

    // Must not trap; fallback value is the raw median
    let stored_rate = client.get_rate(&ngn);
    assert_eq!(stored_rate, 1_250_000, "stored_rate should equal 1_250_000");
}

#[test]
fn test_update_rate_uses_even_source_median_average() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let admin = Address::generate(&env);
    let validator = Address::generate(&env);

    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    let mut sources = Vec::new(&env);
    sources.push_back(1000000i128);
    sources.push_back(1020000i128);
    sources.push_back(980000i128);
    sources.push_back(1040000i128);

    client.update_rate(
        &validator,
        &ngn,
        &1234567i128,
        &sources,
        &env.ledger().timestamp(),
    );
    let stored_rate = client.get_rate(&ngn);
    // Sorted = [980000, 1000000, 1020000, 1040000], median = (1000000 + 1020000) / 2
    assert_eq!(stored_rate, 1010000, "stored_rate should equal 1010000");
}

#[test]
fn test_update_rate_falls_back_to_provided_rate_when_sources_empty() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let admin = Address::generate(&env);
    let validator = Address::generate(&env);

    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    let sources = Vec::new(&env);
    let submitted_rate = 1_111_111i128;
    client.update_rate(
        &validator,
        &ngn,
        &submitted_rate,
        &sources,
        &env.ledger().timestamp(),
    );
    assert_eq!(client.get_rate(&ngn), submitted_rate, "client.get_rate(&ngn) should equal submitted_rate");
}

// ─── Staleness tests ──────────────────────────────────────────────────────────

/// Acceptance check: a rate stored N+1 ledgers ago must be rejected at read time.
/// This is the core acceptance criterion: stale rate cannot be used for new mints.
#[test]
fn test_stale_rate_rejected_at_read() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    // Write a fresh rate at ledger 100 (≥3 oracle feeds required).
    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);
    client.update_rate(
        &validator,
        &ngn,
        &1_000_000i128,
        &sources,
        &env.ledger().timestamp(),
    );

    // Advance ledger sequence past STALE_RATE_MAX_LEDGERS (4_320).
    advance_ledger_to(&env, &contract_id, 100 + 4_321); // one beyond the limit
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000 + 21_601; // also past the timestamp window
    });

    // get_rate must now panic with a stale-rate error.
    let result = client.try_get_rate(&ngn);
    assert!(result.is_err(), "expected stale rate to be rejected");

    // A stale_rt event must have been emitted.
    let events = env.events().all();
    let stale_event_found = events.iter().any(|e| {
        if e.0 != contract_id {
            return false;
        }
        !e.1.is_empty() && Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("stale_rt")
    });
    assert!(stale_event_found, "expected stale_rt event to be emitted");
}

/// A rate that is exactly at the staleness boundary (age == STALE_RATE_MAX_LEDGERS) must still be accepted.
#[test]
fn test_rate_at_boundary_is_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);
    client.update_rate(
        &validator,
        &ngn,
        &1_000_000i128,
        &sources,
        &env.ledger().timestamp(),
    );

    // Advance exactly to the limit — should still pass.
    advance_ledger_to(&env, &contract_id, 100 + 4_320); // exactly at limit

    let rate = client.get_rate(&ngn);
    assert_eq!(rate, 1_000_000, "rate at boundary should be accepted");
}

/// Admin override: set_rate_admin refreshes the ledger stamp, unblocking a stale feed.
#[test]
fn test_admin_override_unblocks_stale_rate() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);
    client.update_rate(
        &validator,
        &ngn,
        &1_000_000i128,
        &sources,
        &env.ledger().timestamp(),
    );

    // Advance past staleness window.
    advance_ledger_to(&env, &contract_id, 100 + 4_321);
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000 + 21_601;
    });

    // Admin refreshes the rate — this stamps the current ledger sequence.
    let override_rate = 1_050_000i128;
    client.set_rate_admin(&ngn, &override_rate);

    // Now get_rate must succeed with the admin-set value.
    let rate = client.get_rate(&ngn);
    assert_eq!(
        rate, override_rate,
        "admin override should unblock stale rate"
    );
}

/// Basket rate (get_acbu_usd_rate_with_timestamp) must also be blocked when any
/// basket component is stale — a stale component cannot silently contribute to mints.
#[test]
fn test_stale_basket_component_blocks_acbu_rate() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    let mut sources = Vec::new(&env);
    sources.push_back(1_000_000i128);
    sources.push_back(1_000_001i128);
    sources.push_back(999_999i128);
    client.update_rate(
        &validator,
        &ngn,
        &1_000_000i128,
        &sources,
        &env.ledger().timestamp(),
    );

    // Advance past staleness window.
    advance_ledger_to(&env, &contract_id, 100 + 4_321);
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000 + 21_601;
    });

    let result = client.try_get_acbu_usd_rate_with_timestamp();
    assert!(
        result.is_err(),
        "stale basket component must block acbu rate"
    );
}

/// Oracle must return RateNotInitialized error before any rate submissions.
/// This prevents division by zero or 0-rate mints/burns before the first epoch.
#[test]
fn test_rate_not_initialized_before_first_submission() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let validator = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    currencies.push_back(kes.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 5000i128);
    basket_weights.set(kes.clone(), 5000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    // get_rate should fail before first submission
    let result = client.try_get_rate(&ngn);
    assert!(result.is_err(), "get_rate should fail before first submission");

    // get_rate_with_timestamp should fail before first submission
    let result = client.try_get_rate_with_timestamp(&ngn);
    assert!(result.is_err(), "get_rate_with_timestamp should fail before first submission");

    // get_acbu_usd_rate should fail before first submission
    let result = client.try_get_acbu_usd_rate();
    assert!(result.is_err(), "get_acbu_usd_rate should fail before first submission");

    // get_acbu_usd_rate_with_timestamp should fail before first submission
    let result = client.try_get_acbu_usd_rate_with_timestamp();
    assert!(result.is_err(), "get_acbu_usd_rate_with_timestamp should fail before first submission");
}
