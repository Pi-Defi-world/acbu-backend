#![cfg(test)]

use acbu_reserve_tracker::{
    AttestationLeaf, ReserveTrackerContract, ReserveTrackerContractClient,
};
use shared::{CurrencyCode, ReserveData, DECIMALS};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Bytes, BytesN, Env,
};

// ── Mock contracts in isolated modules to prevent symbol-name collisions ──────

mod mock_oracle {
    use shared::CurrencyCode;
    use soroban_sdk::{contract, contractimpl, symbol_short, Env, Map};

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn get_acbu_usd_rate(_env: Env) -> i128 {
            100_000_000 // 1 USD (8 decimals)
        }

        pub fn get_rate_with_timestamp(env: Env, currency: CurrencyCode) -> (i128, u64) {
            let rates: Map<CurrencyCode, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("rates"))
                .unwrap_or(Map::new(&env));
            let rate = rates.get(currency).unwrap_or(0);
            (rate, env.ledger().timestamp())
        }

        pub fn set_rate(env: Env, currency: CurrencyCode, rate: i128) {
            let mut rates: Map<CurrencyCode, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("rates"))
                .unwrap_or(Map::new(&env));
            rates.set(currency, rate);
            env.storage()
                .instance()
                .set(&symbol_short!("rates"), &rates);
        }
    }
}

mod mock_token {
    use shared::DECIMALS;
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn get_total_supply(_env: Env) -> i128 {
            10 * DECIMALS
        }
    }
}

mod mock_token_zero {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockTokenZero;

    #[contractimpl]
    impl MockTokenZero {
        pub fn get_total_supply(_env: Env) -> i128 {
            0
        }
    }
}

use mock_oracle::{MockOracle, MockOracleClient};
use mock_token::MockToken;
use mock_token_zero::MockTokenZero;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn verify_reserves_uses_passed_supply_not_contract_balance() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle);
    let min_ratio_bps = 10_000i128; // 100%

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    let acbu_token = Address::generate(&env);
    client.initialize(&admin, &oracle, &acbu_token, &min_ratio_bps);

    let ngn = CurrencyCode::new(&env, "NGN");
    oracle_client.set_rate(&ngn, &1_000_000);
    client.update_reserve(&admin, &ngn, &1_000_000_000, &100_000_000);

    // 10 USD reserves vs 10 ACBU supply (10 * 10^7) at 100% min ratio → sufficient
    assert!(client.verify_reserves_manual(&(10 * 10_000_000)));

    // Same reserves vs double the supply → insufficient
    assert!(!client.verify_reserves_manual(&(20 * 10_000_000)));
}

#[test]
fn test_update_and_get_all_reserves_and_timestamp() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 12345);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    let acbu_token = Address::generate(&env);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    oracle_client.set_rate(&ngn, &1_000_000_000_000);
    client.update_reserve(&admin, &ngn, &500, &(5 * DECIMALS));

    let reserves: soroban_sdk::Map<CurrencyCode, ReserveData> = client.get_all_reserves();
    let mut found = false;
    for (_c, d) in reserves.iter() {
        if d.currency == ngn {
            found = true;
            assert_eq!(d.amount, 500, "d.amount should equal 500");
            assert_eq!(d.value_usd, 5 * DECIMALS, "d.value_usd should equal 5 * DECIMALS");
            assert_eq!(d.timestamp, 12345, "d.timestamp should equal 12345");
        }
    }
    assert!(found);

    env.ledger().with_mut(|l| l.timestamp = 22345);
    client.update_reserve(&admin, &ngn, &1000, &(10 * DECIMALS));

    let reserves2: soroban_sdk::Map<CurrencyCode, ReserveData> = client.get_all_reserves();
    let mut found2 = false;
    for (_c, d) in reserves2.iter() {
        if d.currency == ngn {
            found2 = true;
            assert_eq!(d.amount, 1000, "d.amount should equal 1000");
            assert_eq!(d.value_usd, 10 * DECIMALS, "d.value_usd should equal 10 * DECIMALS");
            assert_eq!(d.timestamp, 22345, "d.timestamp should equal 22345");
        }
    }
    assert!(found2);
}

#[test]
fn test_is_reserve_sufficient_multiple_currencies_and_verify_from_token() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle);
    let token = env.register_contract(None, MockToken);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128); // 100% min ratio

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");

    oracle_client.set_rate(&ngn, &500_000_000_000);
    oracle_client.set_rate(&kes, &250_000_000_000);

    // 5 USD each -> total 10 USD
    client.update_reserve(&admin, &ngn, &1_000, &(5 * DECIMALS));
    client.update_reserve(&admin, &kes, &2_000, &(5 * DECIMALS));

    // supply 10 ACBU (10 * DECIMALS) → sufficient
    assert!(client.verify_reserves_manual(&(10 * DECIMALS)));

    // supply 20 ACBU → insufficient
    assert!(!client.verify_reserves_manual(&(20 * DECIMALS)));

    // verify_reserves reads MockToken which returns 10 * DECIMALS → sufficient
    assert!(client.verify_reserves());
}

#[test]
fn test_zero_and_negative_total_supply_returns_true() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token_zero = env.register_contract(None, MockTokenZero);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token_zero, &10_000i128);

    let zero: i128 = 0;
    let neg: i128 = -10;
    assert!(client.verify_reserves_manual(&zero));
    assert!(client.verify_reserves_manual(&neg));
}

#[test]
fn test_reset_reserves_by_admin_clears_all_entries() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    let acbu_token = Address::generate(&env);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    oracle_client.set_rate(&ngn, &500_000_000_000);
    oracle_client.set_rate(&kes, &250_000_000_000);
    client.update_reserve(&admin, &ngn, &1_000, &(5 * DECIMALS));
    client.update_reserve(&admin, &kes, &2_000, &(5 * DECIMALS));

    assert_eq!(client.get_all_reserves().len(), 2, "client.get_all_reserves().len() should equal 2");

    client.reset_reserves();

    assert_eq!(
        client.get_all_reserves().len(),
        0,
        "reset_reserves must wipe all stored reserve entries"
    );
}

#[test]
fn test_reset_reserves_without_admin_auth_fails() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    let acbu_token = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    oracle_client.set_rate(&ngn, &500_000_000_000);
    client.update_reserve(&admin, &ngn, &1_000, &(5 * DECIMALS));

    use soroban_sdk::testutils::MockAuth;
    use soroban_sdk::testutils::MockAuthInvoke;
    use soroban_sdk::IntoVal;
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "reset_reserves",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_reset_reserves();
    assert!(
        result.is_err(),
        "reset_reserves must reject callers that are not the admin"
    );

    env.mock_all_auths();
    assert_eq!(
        client.get_all_reserves().len(),
        1,
        "reserves must remain intact after a failed reset attempt"
    );
}

#[test]
fn test_verify_reserves_errors_when_total_supply_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token_zero = env.register_contract(None, MockTokenZero);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token_zero, &10_000i128);

    let result = client.try_verify_reserves();
    assert!(
        result.is_err(),
        "verify_reserves must error when total_acbu_supply is zero"
    );
}

#[test]
fn test_add_currency_and_get_currencies() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let acbu_token = Address::generate(&env);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    assert_eq!(client.get_currencies().len(), 0);

    let ngn = CurrencyCode::new(&env, "NGN");
    client.add_currency(&ngn);
    assert_eq!(client.get_currencies().len(), 1);

    let kes = CurrencyCode::new(&env, "KES");
    client.add_currency(&kes);
    assert_eq!(client.get_currencies().len(), 2);
}

#[test]
#[should_panic(expected = "#8008")]
fn test_add_currency_duplicate_panics() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let acbu_token = Address::generate(&env);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    client.add_currency(&ngn);
    client.add_currency(&ngn);
}

#[test]
fn test_update_reserve_without_admin_auth_fails() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    let acbu_token = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");

    use soroban_sdk::testutils::MockAuth;
    use soroban_sdk::testutils::MockAuthInvoke;
    use soroban_sdk::IntoVal;
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "update_reserve",
            args: (attacker.clone(), ngn.clone(), 1_000i128, 5i128 * DECIMALS).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_update_reserve(&attacker, &ngn, &1_000, &(5 * DECIMALS));
    assert!(
        result.is_err(),
        "update_reserve must reject callers that are not the admin"
    );
}

#[test]
fn test_verify_reserves_caches_result_during_cooldown() {
// ── Oracle cross-validation tests ─────────────────────────────────────────────

#[test]
fn test_set_custodian_by_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let custodian = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);
    let oracle_client = MockOracleClient::new(&env, &oracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    // 10 USD reserve
    client.update_reserve(&admin, &ngn, &1_000_000_000, &100_000_000);

    // First call at t=1: token returns 10*DECIMALS, reserves=10 USD → sufficient (true)
    assert!(client.verify_reserves());

    // Call again at t=10 (within 60s cooldown): must return cached result, not false
    env.ledger().with_mut(|l| l.timestamp = 10);
    assert!(
        client.verify_reserves(),
        "verify_reserves must return cached true during cooldown, not false"
    );

    // After cooldown expires at t=61, re-checks fresh
    env.ledger().with_mut(|l| l.timestamp = 61);
    assert!(client.verify_reserves());
}

#[test]
fn test_verify_reserves_caches_false_during_cooldown() {
    let acbu_token = Address::generate(&env);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    assert_eq!(client.get_custodian(), custodian);
}

#[test]
fn test_set_custodian_without_admin_auth_fails() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &oracle, &token, &10_000i128);

    let custodian = Address::generate(&env);

    use soroban_sdk::testutils::MockAuth;
    use soroban_sdk::testutils::MockAuthInvoke;
    use soroban_sdk::IntoVal;
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_custodian",
            args: (custodian.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_set_custodian(&custodian);
    assert!(
        result.is_err(),
        "set_custodian must reject callers that are not the admin"
    );
}

#[test]
fn test_submit_attestation() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 42);

    let admin = Address::generate(&env);
    let custodian = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);
    client.set_custodian(&custodian);

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "NGN"),
        amount: 1000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let root = hash_leaf_test(&env, &leaf);
    client.submit_attestation(&root);

    let (stored_root, stored_ts) = client.get_latest_attestation();
    assert_eq!(stored_root, root);
    assert_eq!(stored_ts, 42);
}

#[test]
fn test_submit_attestation_without_custodian_identity_fails() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let custodian = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);
    let oracle_client = MockOracleClient::new(&env, &oracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    // Tiny reserve (0.1 USD) vs 10 ACBU supply → insufficient
    client.update_reserve(&admin, &ngn, &1, &10_000_000);

    // First call: insufficient (false)
    assert!(!client.verify_reserves());

    // Within cooldown: returns cached false (not a stale true)
    env.ledger().with_mut(|l| l.timestamp = 30);
    assert!(
        !client.verify_reserves(),
        "verify_reserves must return cached false during cooldown"
    let acbu_token = Address::generate(&env);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let mut root_buf = Bytes::new(&env);
    root_buf.extend_from_slice(&[0xabu8; 32][..]);
    let root = env.crypto().keccak256(&root_buf).to_bytes();

    env.mock_auths(&[]);
    let result = client.try_submit_attestation(&root);
    assert!(
        result.is_err(),
        "submit_attestation must reject callers that are not the custodian"
    );
}

#[test]
fn test_verify_reserves_refreshes_after_cooldown_expires() {
fn test_update_reserve_accepts_consistent_value_usd() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let custodian = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);
    let oracle_client = MockOracleClient::new(&env, &oracle);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    // Tiny reserve → insufficient
    client.update_reserve(&admin, &ngn, &1, &10_000_000);

    // First call: false
    assert!(!client.verify_reserves());

    // Add real reserves
    env.ledger().with_mut(|l| l.timestamp = 2);
    client.update_reserve(&admin, &ngn, &1_000_000_000, &100_000_000);

    // Still within cooldown of first call → returns cached false
    env.ledger().with_mut(|l| l.timestamp = 30);
    assert!(
        !client.verify_reserves(),
        "must still return cached false within cooldown of first call"
    );

    // After cooldown (t=61 > 1+60): fresh check sees new reserves → true
    env.ledger().with_mut(|l| l.timestamp = 61);
    assert!(
        client.verify_reserves(),
        "must re-evaluate after cooldown expires and return true"
    let acbu_token = Address::generate(&env);
    client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    let eur = CurrencyCode::new(&env, "EUR");
    let gbp = CurrencyCode::new(&env, "GBP");

    let leaf0 = AttestationLeaf {
        currency: ngn,
        amount: 1000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let leaf1 = AttestationLeaf {
        currency: kes,
        amount: 2000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let leaf2 = AttestationLeaf {
        currency: eur,
        amount: 1500,
        value_usd: 3 * DECIMALS,
        timestamp: 1,
    };
    let leaf3 = AttestationLeaf {
        currency: gbp,
        amount: 800,
        value_usd: 2 * DECIMALS,
        timestamp: 1,
    };

    let h0 = hash_leaf_test(&env, &leaf0);
    let h1 = hash_leaf_test(&env, &leaf1);
    let h2 = hash_leaf_test(&env, &leaf2);
    let h3 = hash_leaf_test(&env, &leaf3);

    let h01 = hash_pair(&env, &h0, &h1);
    let h23 = hash_pair(&env, &h2, &h3);
    let root = hash_pair(&env, &h01, &h23);

    client.submit_attestation(&root);

    let proof = vec![&env, h1.clone(), h23.clone()];
    assert!(client.verify_merkle_proof(&leaf0, &proof, &0u32));

    let proof3 = vec![&env, h2.clone(), h01.clone()];
    assert!(client.verify_merkle_proof(&leaf3, &proof3, &3u32));
}

#[test]
fn test_verify_merkle_proof_invalid_proof_panics() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let custodian = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);
    client.set_custodian(&custodian);

    let ngn = CurrencyCode::new(&env, "NGN");
    let leaf = AttestationLeaf {
        currency: ngn,
        amount: 1000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let root = hash_leaf_test(&env, &leaf);
    client.submit_attestation(&root);

    let mut fake_buf = Bytes::new(&env);
    fake_buf.extend_from_slice(&[0xabu8; 32][..]);
    let fake_sibling = env.crypto().keccak256(&fake_buf).to_bytes();
    let bad_proof = vec![&env, fake_sibling];

    let result = client.try_verify_merkle_proof(&leaf, &bad_proof, &0u32);
    assert!(
        result.is_err(),
        "verify_merkle_proof must panic with InvalidMerkleProof for a bad proof"
    );
}

#[test]
fn test_verify_merkle_proof_no_attestation_panics() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1);

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);

    let ngn = CurrencyCode::new(&env, "NGN");
    let leaf = AttestationLeaf {
        currency: ngn,
        amount: 1000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let proof = vec![&env];

    let result = client.try_verify_merkle_proof(&leaf, &proof, &0u32);
    assert!(
        result.is_err(),
        "verify_merkle_proof must panic with AttestationNotFound when no root exists"
    );
}

#[test]
fn test_get_latest_attestation_before_submit_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let token = env.register_contract(None, MockToken);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &token, &10_000i128);

    let result = client.try_get_latest_attestation();
    assert!(
        result.is_err(),
        "get_latest_attestation must panic when no attestation has been submitted"
    );
}