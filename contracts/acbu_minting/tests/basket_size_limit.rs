#![cfg(test)]

use acbu_minting::{MintingConfig, MintingContract, MintingContractClient, MintingError};
use shared::DECIMALS;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, Error, String};

const ACCOUNT: &str = "GAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPSABOV";
const OVERSIZED_BASKET: [&str; 11] = [
    "NGN", "KES", "GHS", "ZAR", "EGP", "RWF", "XOF", "XAF", "MAD", "TZS", "UGX",
];

mod oracle_mock {
    use shared::CurrencyCode;
    use soroban_sdk::{contract, contractimpl, Env, Vec};

    use super::{DECIMALS, OVERSIZED_BASKET};

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }

        pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
            let mut currencies = Vec::new(&env);
            for code in OVERSIZED_BASKET {
                currencies.push_back(CurrencyCode::new(&env, code));
            }
            currencies
        }
    }
}

mod reserve_mock {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockReserveTracker;

    #[contractimpl]
    impl MockReserveTracker {
        pub fn is_reserve_sufficient(_env: Env, _supply: i128) -> bool {
            true
        }
    }
}

fn setup() -> (Env, MintingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let oracle = env.register_contract(None, oracle_mock::MockOracle);
    let reserve_tracker = env.register_contract(None, reserve_mock::MockReserveTracker);
    let contract_id = env.register_contract(None, MintingContract);
    let client = MintingContractClient::new(&env, &contract_id);

    client.initialize(&MintingConfig {
        admin: Address::generate(&env),
        oracle,
        reserve_tracker,
        acbu_token: Address::generate(&env),
        usdc_token: Address::generate(&env),
        vault: Address::generate(&env),
        treasury: Address::generate(&env),
        fee_rate_bps: 50,
        fee_single_bps: 100,
        operator: Address::generate(&env),
        operator_pub_key: BytesN::from_array(&env, &[0u8; 32]),
    });

    (env, client)
}

fn account(env: &Env) -> Address {
    Address::from_string(&String::from_str(env, ACCOUNT))
}

fn contract_error(error: MintingError) -> Error {
    Error::from_contract_error(error as u32)
}

#[test]
fn mint_from_basket_returns_basket_size_error_for_more_than_ten_currencies() {
    let (env, client) = setup();
    let user = account(&env);
    let proof_id = String::from_str(&env, "oversized_basket");

    let result = client.try_mint_from_basket(&user, &user, &(100 * DECIMALS), &proof_id);

    assert_eq!(result, Err(Ok(contract_error(MintingError::BasketSizeExceeded))));
}

#[test]
fn mint_from_basket_keeps_invalid_amount_error_for_malformed_amount() {
    let (env, client) = setup();
    let user = account(&env);
    let proof_id = String::from_str(&env, "invalid_amount");

    let result = client.try_mint_from_basket(&user, &user, &1, &proof_id);

    assert_eq!(result, Err(Ok(contract_error(MintingError::InvalidMintAmount))));
}
