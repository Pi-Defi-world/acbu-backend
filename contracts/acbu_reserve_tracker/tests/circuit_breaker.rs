// AC-030: the reserve tracker's circuit breaker. Minting and burning both gate
// on `is_reserve_sufficient`, so tripping it halts mint and redeem together;
// `is_paused` lets the tracker also serve as an explicit circuit-breaker peer.

use acbu_reserve_tracker::{ReserveTrackerContract, ReserveTrackerContractClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

fn setup() -> (Env, ReserveTrackerContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &id);
    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &10_000,
    );
    (env, client)
}

#[test]
fn not_paused_by_default() {
    let (_env, client) = setup();
    assert!(!client.is_paused());
    // Zero supply is trivially backed.
    assert!(client.is_reserve_sufficient(&0));
}

#[test]
fn pause_reports_reserves_insufficient() {
    let (_env, client) = setup();
    client.pause();
    assert!(client.is_paused());
    assert!(!client.is_reserve_sufficient(&0));
    assert!(!client.is_reserve_sufficient(&1_000_000));
}

#[test]
fn unpause_restores_normal_checks() {
    let (_env, client) = setup();
    client.pause();
    client.unpause();
    assert!(!client.is_paused());
    assert!(client.is_reserve_sufficient(&0));
}

#[test]
#[should_panic]
fn pause_requires_admin() {
    let (env, client) = setup();
    env.mock_auths(&[]);
    client.pause();
}
