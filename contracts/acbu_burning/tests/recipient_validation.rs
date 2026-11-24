// AC-031: redeem recipients must be `G…` accounts, matching the minting
// contract. Recipient validation runs before any storage/oracle access, so an
// uninitialised contract is enough to exercise it.

use acbu_burning::{BurningContract, BurningContractClient};
use shared::{ContractError, CurrencyCode};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, Error, String};

const ACCOUNT: &str = "GAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSABOV";
const CONTRACT: &str = "CAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSBFLM";

fn setup() -> (Env, BurningContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, BurningContract);
    let client = BurningContractClient::new(&env, &id);
    (env, client, id)
}

fn invalid_recipient() -> Error {
    Error::from_contract_error(ContractError::InvalidRecipient as u32)
}

fn addr(env: &Env, strkey: &str) -> Address {
    Address::from_string(&String::from_str(env, strkey))
}

#[test]
fn redeem_single_rejects_foreign_contract_recipient() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let res = client.try_redeem_single(
        &user,
        &addr(&env, CONTRACT),
        &1_000_000,
        &CurrencyCode::new(&env, "NGN"),
        &None,
    );
    assert_eq!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn redeem_single_rejects_own_contract_address() {
    let (env, client, id) = setup();
    let user = addr(&env, ACCOUNT);
    let res =
        client.try_redeem_single(&user, &id, &1_000_000, &CurrencyCode::new(&env, "NGN"), &None);
    assert_eq!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn redeem_single_accepts_account_recipient() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let res = client.try_redeem_single(
        &user,
        &addr(&env, ACCOUNT),
        &1_000_000,
        &CurrencyCode::new(&env, "NGN"),
        &None,
    );
    // The uninitialised contract fails later, but not on recipient validation.
    assert_ne!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn redeem_basket_rejects_any_contract_recipient() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let recipients = vec![&env, addr(&env, ACCOUNT), Address::generate(&env)];
    let res = client.try_redeem_basket(&user, &recipients, &1_000_000, &None);
    assert_eq!(res, Err(Ok(invalid_recipient())));
}

#[test]
fn redeem_basket_accepts_account_recipients() {
    let (env, client, _) = setup();
    let user = addr(&env, ACCOUNT);
    let recipients = vec![&env, addr(&env, ACCOUNT)];
    let res = client.try_redeem_basket(&user, &recipients, &1_000_000, &None);
    assert_ne!(res, Err(Ok(invalid_recipient())));
}
