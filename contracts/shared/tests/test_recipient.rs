// AC-031: one recipient rule shared by the minting and burning contracts.

use shared::is_account_address;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

// Valid strkeys (correct version byte + CRC16) over the same 32-byte payload.
const ACCOUNT: &str = "GAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSABOV";
const CONTRACT: &str = "CAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSBFLM";

#[test]
fn accepts_account_address() {
    let env = Env::default();
    let addr = Address::from_string(&String::from_str(&env, ACCOUNT));
    assert!(is_account_address(&addr));
}

#[test]
fn rejects_contract_address() {
    let env = Env::default();
    let addr = Address::from_string(&String::from_str(&env, CONTRACT));
    assert!(!is_account_address(&addr));
}

#[test]
fn rejects_generated_contract_address() {
    // `Address::generate` yields a contract (`C…`) address in soroban-sdk 21.
    let env = Env::default();
    let addr = Address::generate(&env);
    assert!(!is_account_address(&addr));
}
