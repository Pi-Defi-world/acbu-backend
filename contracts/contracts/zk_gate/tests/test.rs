#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use zk_gate::{ZkGate, ZkGateClient};

#[test]
fn constructor_stores_owner_and_leaves_vrf_unconfigured() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.__constructor(&owner);

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

    client.__constructor(&owner);
    client.set_vrf(&owner, &verifier);

    assert_eq!(client.get_vrf(), Some(verifier));
}

#[test]
#[should_panic(expected = "#3")]
fn self_verifier_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkGate);
    let client = ZkGateClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    client.__constructor(&owner);
    client.set_vrf(&owner, &contract_id);
}
