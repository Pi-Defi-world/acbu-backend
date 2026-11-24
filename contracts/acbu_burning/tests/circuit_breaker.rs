// AC-030: redemption honours circuit-breaker peers (minting, reserve tracker,
// …). A peer is any contract exposing `is_paused() -> bool`; a mock stands in
// for the real peers here.

use acbu_burning::{BurningContract, BurningContractClient};
use shared::{ContractError, CurrencyCode, MAX_CIRCUIT_PEERS};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Env, Error, String, Vec};

const ACCOUNT: &str = "GAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSABOV";

#[contract]
pub struct MockPeer;

#[contractimpl]
impl MockPeer {
    pub fn set_paused(env: Env, paused: bool) {
        env.storage()
            .instance()
            .set(&symbol_short!("PAUSED"), &paused);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("PAUSED"))
            .unwrap_or(false)
    }
}

/// A contract that does not implement `is_paused`.
#[contract]
pub struct NotAPeer;

#[contractimpl]
impl NotAPeer {
    pub fn noop(_env: Env) {}
}

fn setup() -> (Env, BurningContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, BurningContract);
    let client = BurningContractClient::new(&env, &id);
    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &30,
        &100,
    );
    (env, client, id)
}

fn peer(env: &Env) -> MockPeerClient<'static> {
    MockPeerClient::new(env, &env.register_contract(None, MockPeer))
}

fn err(e: ContractError) -> Error {
    Error::from_contract_error(e as u32)
}

fn account(env: &Env) -> Address {
    Address::from_string(&String::from_str(env, ACCOUNT))
}

fn redeem_single(env: &Env, client: &BurningContractClient) -> Result<(), Error> {
    let user = account(env);
    match client.try_redeem_single(
        &user,
        &user,
        &100_000_000,
        &CurrencyCode::new(env, "NGN"),
        &None,
    ) {
        Err(Ok(e)) => Err(e),
        _ => Ok(()),
    }
}

#[test]
fn paused_peer_blocks_redeem_single() {
    let (env, client, _) = setup();
    let minting = peer(&env);
    client.set_circuit_peers(&vec![&env, minting.address.clone()]);

    minting.set_paused(&true);
    assert_eq!(redeem_single(&env, &client), Err(err(ContractError::Paused)));
}

#[test]
fn paused_peer_blocks_redeem_basket() {
    let (env, client, _) = setup();
    let minting = peer(&env);
    client.set_circuit_peers(&vec![&env, minting.address.clone()]);
    minting.set_paused(&true);

    let user = account(&env);
    let res = client.try_redeem_basket(&user, &vec![&env, user.clone()], &100_000_000, &None);
    assert_eq!(res, Err(Ok(err(ContractError::Paused))));
}

#[test]
fn active_peer_does_not_block() {
    let (env, client, _) = setup();
    let minting = peer(&env);
    client.set_circuit_peers(&vec![&env, minting.address.clone()]);

    // Fails later (no real oracle) but not on the circuit breaker.
    assert_ne!(redeem_single(&env, &client), Err(err(ContractError::Paused)));
    assert!(!client.is_halted());
}

#[test]
fn any_one_of_several_peers_trips_the_breaker() {
    let (env, client, _) = setup();
    let minting = peer(&env);
    let reserve = peer(&env);
    client.set_circuit_peers(&vec![&env, minting.address.clone(), reserve.address.clone()]);

    reserve.set_paused(&true);
    assert!(client.is_halted());
    assert_eq!(redeem_single(&env, &client), Err(err(ContractError::Paused)));

    reserve.set_paused(&false);
    assert!(!client.is_halted());
}

#[test]
fn unqueryable_peer_fails_closed() {
    let (env, client, _) = setup();
    let broken = env.register_contract(None, NotAPeer);
    client.set_circuit_peers(&vec![&env, broken]);

    assert!(client.is_halted());
    assert_eq!(redeem_single(&env, &client), Err(err(ContractError::Paused)));
}

#[test]
fn is_paused_reports_local_state_only() {
    let (env, client, _) = setup();
    let minting = peer(&env);
    client.set_circuit_peers(&vec![&env, minting.address.clone()]);
    minting.set_paused(&true);

    // Peers query each other's `is_paused`; it must not recurse into peers.
    assert!(!client.is_paused());
    assert!(client.is_halted());
}

#[test]
fn unlinking_peers_reopens_the_path() {
    let (env, client, _) = setup();
    let minting = peer(&env);
    client.set_circuit_peers(&vec![&env, minting.address.clone()]);
    minting.set_paused(&true);

    client.set_circuit_peers(&Vec::new(&env));
    assert_eq!(client.get_circuit_peers().len(), 0);
    assert_ne!(redeem_single(&env, &client), Err(err(ContractError::Paused)));
}

#[test]
fn set_circuit_peers_rejects_self() {
    let (env, client, id) = setup();
    let res = client.try_set_circuit_peers(&vec![&env, id]);
    assert_eq!(res, Err(Ok(err(ContractError::InvalidCircuitPeer))));
}

#[test]
fn set_circuit_peers_rejects_duplicates() {
    let (env, client, _) = setup();
    let p = peer(&env).address;
    let res = client.try_set_circuit_peers(&vec![&env, p.clone(), p]);
    assert_eq!(res, Err(Ok(err(ContractError::InvalidCircuitPeer))));
}

#[test]
fn set_circuit_peers_rejects_too_many() {
    let (env, client, _) = setup();
    let mut peers = Vec::new(&env);
    for _ in 0..=MAX_CIRCUIT_PEERS {
        peers.push_back(Address::generate(&env));
    }
    let res = client.try_set_circuit_peers(&peers);
    assert_eq!(res, Err(Ok(err(ContractError::InvalidCircuitPeer))));
}

#[test]
#[should_panic]
fn set_circuit_peers_requires_admin() {
    let (env, client, _) = setup();
    env.mock_auths(&[]);
    client.set_circuit_peers(&vec![&env, Address::generate(&env)]);
}
