// AC-031: the minting contract's recipient rule now comes from
// `shared::is_account_address`; pin its behaviour so it stays aligned with
// the burning contract. Validation runs before any config is read, so an
// uninitialised contract is enough to exercise it.

use acbu_minting::{MintingContract, MintingContractClient, MintingError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Error, String};

const ACCOUNT: &str = "GAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSABOV";
const CONTRACT: &str = "CAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSBFLM";

fn setup() -> (Env, MintingContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MintingContract);
    let client = MintingContractClient::new(&env, &id);
    (env, client, id)
}

fn invalid_recipient() -> Error {
    Error::from_contract_error(MintingError::InvalidRecipient as u32)
}

fn addr(env: &Env, strkey: &str) -> Address {
    Address::from_string(&String::from_str(env, strkey))
}

#[test]
fn mint_rejects_contract_recipient() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let res = client.try_mint_from_usdc(&user, &1_000_000, &addr(&env, CONTRACT), &None);
    assert_eq!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn mint_rejects_own_contract_address() {
    let (env, client, id) = setup();
    let user = addr(&env, ACCOUNT);
    let res = client.try_mint_from_usdc(&user, &1_000_000, &id, &None);
    assert_eq!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn mint_rejects_generated_contract_recipient() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let res = client.try_mint_from_usdc(&user, &1_000_000, &Address::generate(&env), &None);
    assert_eq!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn mint_accepts_account_recipient() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let res = client.try_mint_from_usdc(&user, &1_000_000, &addr(&env, ACCOUNT), &None);
    // The uninitialised contract fails later, but not on recipient validation.
    assert_ne!(res, Err(Ok(invalid_recipient())));
}
