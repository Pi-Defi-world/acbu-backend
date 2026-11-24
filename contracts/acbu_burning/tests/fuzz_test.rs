#![cfg(test)]

use acbu_burning::{BurningContract, BurningContractClient};

use proptest::prelude::*;
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

mod mocks {

    use shared::CurrencyCode;
    use shared::DECIMALS;
    use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {

        pub fn get_rate_with_timestamp(env: Env, _c: CurrencyCode) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }

        pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
            let mut v = Vec::new(&env);
            v.push_back(CurrencyCode::new(&env, "NGN"));
            v
        }

        pub fn get_s_token_address(env: Env, _c: CurrencyCode) -> Address {

        }

        pub fn seed_stoken(env: Env, stoken: Address) {

        }
    }

    #[contract]
    pub struct MockReserveTracker;

    #[contractimpl]
    impl MockReserveTracker {
        pub fn is_reserve_sufficient(_env: Env, _supply: i128) -> bool {
            true
        }
    }

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn get_total_supply(_env: Env) -> i128 {
            1_000_000_000_000_000_000
        }

        pub fn burn(_env: Env, _from: Address, _amount: i128) {}
    }
}

proptest! {
    #[test]
    fn fuzz_redeem_basket_recipients(num_recipients in 0usize..20usize) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let oracle = env.register_contract(None, mocks::MockOracle);
        let reserve_tracker = env.register_contract(None, mocks::MockReserveTracker);


        client.initialize(
            &admin,
            &oracle,
            &reserve_tracker,
            &acbu_token,

            &100,
            &200,
        );



        let oracle_client = mocks::MockOracleClient::new(&env, &oracle);
        oracle_client.seed_stoken(&stoken);

        let mut recipients = Vec::new(&env);
        for _ in 0..num_recipients {
            recipients.push_back(Address::generate(&env));
        }

        let burn_amount = 100 * DECIMALS;


        } else {
            assert!(result.is_ok());
        }
    }
}
