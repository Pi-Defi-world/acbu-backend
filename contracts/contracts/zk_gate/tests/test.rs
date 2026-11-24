#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use zk_gate::{GatePolicy, ZkGate, ZkGateClient};

#[test]
fn constructor_stores_owner_and_leaves_vrf_unconfigured() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.initialize(&owner);

    assert_eq!(client.get_vrf(), None);
}

#[test]
fn owner_can_configure_a_verifier_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let verifier = Address::generate(&env);

    client.initialize(&owner);
    client.set_vrf(&owner, &verifier);

    assert_eq!(client.get_vrf(), Some(verifier));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn self_verifier_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.initialize(&owner);
    client.set_vrf(&owner, &contract_id);
}

#[test]
fn owner_can_configure_on_chain_kyc_policy() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.initialize(&owner);
    client.set_policy(&owner, &2, &50);

    let policy = client.get_policy().expect("policy must be configured");
    assert_eq!(
        policy,
        GatePolicy {
            min_tier: 2,
            max_risk_score: 50,
        }
    );

    assert!(client.check_policy(&2, &50));
    assert!(client.check_policy(&3, &20));
    assert!(!client.check_policy(&1, &50)); // Tier too low
    assert!(!client.check_policy(&2, &60)); // Risk score too high
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn assert_policy_rejects_tier_too_low() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.initialize(&owner);
    client.set_policy(&owner, &2, &50);

    client.assert_policy(&1, &30);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn assert_policy_rejects_risk_score_too_high() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.initialize(&owner);
    client.set_policy(&owner, &2, &50);

    client.assert_policy(&2, &51);
}
