// AC-030: minting honours circuit-breaker peers (burning, reserve tracker, …).
// A peer is any contract exposing `is_paused() -> bool`; a mock stands in for
// the real peers here.

use acbu_minting::{MintingConfig, MintingContract, MintingContractClient, MintingError};
use shared::MAX_CIRCUIT_PEERS;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, BytesN, Env, Error, String, Vec};

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

fn setup() -> (Env, MintingContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MintingContract);
    let client = MintingContractClient::new(&env, &id);
    client.initialize(&MintingConfig {
        admin: Address::generate(&env),
        oracle: Address::generate(&env),
        reserve_tracker: Address::generate(&env),
        acbu_token: Address::generate(&env),
        usdc_token: Address::generate(&env),
        vault: Address::generate(&env),
        treasury: Address::generate(&env),
        fee_rate_bps: 30,
        fee_single_bps: 100,
        operator: Address::generate(&env),
        operator_pub_key: BytesN::from_array(&env, &[0u8; 32]),
    });
    (env, client, id)
}

fn peer(env: &Env) -> MockPeerClient<'static> {
    MockPeerClient::new(env, &env.register_contract(None, MockPeer))
}

fn err(e: MintingError) -> Error {
    Error::from_contract_error(e as u32)
}

fn mint(env: &Env, client: &MintingContractClient) -> Result<(), Error> {
    let user = Address::from_string(&String::from_str(env, ACCOUNT));
    match client.try_mint_from_usdc(&user, &100_000_000, &user, &None) {
        Err(Ok(e)) => Err(e),
        _ => Ok(()),
    }
}

#[test]
fn paused_peer_blocks_minting() {
    let (env, client, _) = setup();
    let burning = peer(&env);
    client.set_circuit_peers(&vec![&env, burning.address.clone()]);

    burning.set_paused(&true);
    assert!(client.is_halted());
    assert!(!client.is_paused(), "is_paused must report local state only");
    assert_eq!(mint(&env, &client), Err(err(MintingError::Paused)));
}

#[test]
fn active_peer_does_not_block_minting() {
    let (env, client, _) = setup();
    let burning = peer(&env);
    client.set_circuit_peers(&vec![&env, burning.address.clone()]);

    // Fails later (no real oracle) but not on the circuit breaker.
    assert!(!client.is_halted());
    assert_ne!(mint(&env, &client), Err(err(MintingError::Paused)));
}

#[test]
fn peer_pause_does_not_lock_admin_config() {
    let (env, client, _) = setup();
    let burning = peer(&env);
    client.set_circuit_peers(&vec![&env, burning.address.clone()]);
    burning.set_paused(&true);

    // Recovery actions stay available while a peer holds the breaker.
    client.set_fee_rate(&50);
    assert_eq!(client.get_fee_rate(), 50);
}

#[test]
fn set_circuit_peers_rejects_invalid_lists() {
    let (env, client, id) = setup();
    let invalid = Err(Ok(err(MintingError::InvalidCircuitPeer)));

    assert_eq!(client.try_set_circuit_peers(&vec![&env, id]), invalid);

    let p = peer(&env).address;
    assert_eq!(client.try_set_circuit_peers(&vec![&env, p.clone(), p]), invalid);

    let mut many = Vec::new(&env);
    for _ in 0..=MAX_CIRCUIT_PEERS {
        many.push_back(Address::generate(&env));
    }
    assert_eq!(client.try_set_circuit_peers(&many), invalid);
}
