#![cfg(test)]

use acbu_lending_pool::{LendingPool, LendingPoolClient};
use soroban_sdk::{
    testutils::Address as _, Address, Env,
};
use proptest::prelude::*;

proptest! {
    #[test]
    fn fuzz_initialize_fee_rate(fee_rate in -5000i128..20_000i128) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let acbu_token = Address::generate(&env);
        let contract_id = env.register_contract(None, LendingPool);
        let client = LendingPoolClient::new(&env, &contract_id);
        
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.initialize(&admin, &acbu_token, &fee_rate);
        }));
        
        // BASIS_POINTS is 10000. So valid fee is 0..=10000
        if fee_rate < 0 || fee_rate > 10000 {
            assert!(res.is_err());
        } else {
            assert!(res.is_ok());
        }
    }
    
    #[test]
    fn fuzz_deposit_amount(amount in -100i128..1_000_000_000_000i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        
        let acbu_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
        
        let contract_id = env.register_contract(None, LendingPool);
        let client = LendingPoolClient::new(&env, &contract_id);
        
        client.initialize(&admin, &acbu_token, &100);
        
        let lender = Address::generate(&env);
        
        if amount > 0 {
            acbu_sac.mint(&lender, &amount);
        }
        
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.deposit(&lender, &amount);
        }));
        
        if amount <= 0 {
            assert!(res.is_err());
        } else {
            assert!(res.is_ok());
        }
    }
}
