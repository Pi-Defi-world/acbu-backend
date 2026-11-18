#![cfg(test)]

use acbu_minting::{MintingContract, MintingContractClient};
use shared::DECIMALS;
use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};
use proptest::prelude::*;

mod mocks {
    use soroban_sdk::{contract, contractimpl, Env, Address, Vec};
    use shared::CurrencyCode;
    use shared::DECIMALS;

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn get_acbu_usd_rate(_env: Env) -> i128 { DECIMALS }
        pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }
        pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
            let mut v = Vec::new(&env);
            v.push_back(CurrencyCode::new(&env, "NGN"));
            v
        }
        pub fn get_basket_weight(_env: Env, _c: CurrencyCode) -> i128 { 10_000 }
        pub fn get_rate(_env: Env, _c: CurrencyCode) -> i128 { DECIMALS }
        pub fn get_rate_with_timestamp(env: Env, _c: CurrencyCode) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }
        pub fn get_s_token_address(env: Env, _c: CurrencyCode) -> Address {
            env.storage().instance().get(&soroban_sdk::symbol_short!("STK")).unwrap()
        }
        pub fn seed_stoken(env: Env, stoken: Address) {
            env.storage().instance().set(&soroban_sdk::symbol_short!("STK"), &stoken);
        }
    }

    #[contract]
    pub struct MockReserveTracker;

    #[contractimpl]
    impl MockReserveTracker {
        pub fn is_reserve_sufficient(_env: Env, _supply: i128) -> bool { true }
    }
}

fn setup_fuzz_test(env: &Env) -> (Address, Address, MintingContractClient, Address, soroban_sdk::token::StellarAssetClient<'_>, soroban_sdk::token::Client<'_>) {
    let admin = Address::generate(env);
    let oracle = env.register_contract(None, mocks::MockOracle);
    let reserve_tracker = env.register_contract(None, mocks::MockReserveTracker);
    let contract_id = env.register_contract(None, MintingContract);
    let client = MintingContractClient::new(env, &contract_id);
    let acbu_token = env.register_stellar_asset_contract_v2(contract_id.clone()).address();
    let usdc_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let usdc_sac = soroban_sdk::token::StellarAssetClient::new(env, &usdc_token);
    let acbu_client = soroban_sdk::token::Client::new(env, &acbu_token);
    
    let config = acbu_minting::MintingConfig {
        admin: admin.clone(),
        oracle: oracle.clone(),
        reserve_tracker: reserve_tracker.clone(),
        acbu_token: acbu_token.clone(),
        usdc_token: usdc_token.clone(),
        vault: admin.clone(),
        treasury: admin.clone(),
        fee_rate_bps: 300,
        fee_single_bps: 100,
        operator: admin.clone(),
    };
    client.initialize(&config);
    (admin, oracle, client, usdc_token, usdc_sac, acbu_client)
}

proptest! {
    #[test]
    fn fuzz_mint_amount_usdc(amount in 1i128..10_000_000_000_000i128) {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, _oracle, client, _usdc_token, usdc_sac, _acbu_client) = setup_fuzz_test(&env);
        let user = Address::generate(&env);
        
        usdc_sac.mint(&user, &amount);
        
        let max_mint = 1_000_000_000_000;
        
        let res = client.try_mint_from_usdc(&user, &amount, &user);
        
        if amount > max_mint {
            assert!(res.is_err());
        } else {
            assert!(res.is_ok());
        }
    }
}
