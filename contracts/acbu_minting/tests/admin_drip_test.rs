#![cfg(test)]

use acbu_minting::{MintingContract, MintingContractClient};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    Address, Env, Vec,
};

mod oracle_mock {
    use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Vec};

    use shared::CurrencyCode;
    use super::DECIMALS;

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn get_acbu_usd_rate(_env: Env) -> i128 {
            DECIMALS
        }
        pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }
        pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
            let mut v = Vec::new(&env);
            v.push_back(CurrencyCode::new(&env, "NGN"));
            v
        }
        pub fn get_basket_weight(_env: Env, _c: CurrencyCode) -> i128 {
            10_000
        }
        pub fn get_rate(_env: Env, _c: CurrencyCode) -> i128 {
            DECIMALS
        }
        pub fn get_rate_with_timestamp(env: Env, _c: CurrencyCode) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }
        pub fn get_s_token_address(env: Env, _c: CurrencyCode) -> Address {
            env.storage()
                .instance()
                .get(&symbol_short!("STK"))
                .expect("seed_stoken not called in test")
        }
        pub fn seed_stoken(env: Env, stoken: Address) {
            env.storage().instance().set(&symbol_short!("STK"), &stoken);
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

fn init_mint_client(
    _env: &Env,
    client: &MintingContractClient,
    admin: &Address,
    oracle: &Address,
    reserve_tracker: &Address,
    acbu_token: &Address,
    usdc_token: &Address,
    vault: &Address,
    treasury: &Address,
    fee_rate: i128,
    fee_single: i128,
) {
    let config = acbu_minting::MintingConfig {
        admin: admin.clone(),
        oracle: oracle.clone(),
        reserve_tracker: reserve_tracker.clone(),
        acbu_token: acbu_token.clone(),
        usdc_token: usdc_token.clone(),
        vault: vault.clone(),
        treasury: treasury.clone(),
        fee_rate_bps: fee_rate,
        fee_single_bps: fee_single,
        operator: admin.clone(),
    };
    client.initialize(&config);
}

fn setup_drip_test(env: &Env) -> (Address, Address, MintingContractClient, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let oracle = env.register_contract(None, oracle_mock::MockOracle);
    let reserve_tracker = env.register_contract(None, reserve_mock::MockReserveTracker);

    let contract_id = env.register_contract(None, MintingContract);
    let client = MintingContractClient::new(env, &contract_id);

    let acbu_token = env.register_stellar_asset_contract_v2(contract_id.clone()).address();
    let usdc_token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let stoken_id = env.register_stellar_asset_contract_v2(admin.clone()).address();

    oracle_mock::MockOracleClient::new(env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        env, &client, &admin, &oracle, &reserve_tracker,
        &acbu_token, &usdc_token, &admin, &admin, 100, 200,
    );

    (admin, stoken_id, client, contract_id)
}

#[test]
fn test_admin_drip_fiat_success() {
    let env = Env::default();
    let (_admin, stoken_id, client, _contract_id) = setup_drip_test(&env);
    let recipient = Address::generate(&env);
    let amount = 500_000_000;

    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    let stoken_client = soroban_sdk::token::Client::new(&env, &stoken_id);

    stoken_sac.mint(&client.address, &amount);
    assert_eq!(stoken_client.balance(&recipient), 0, "stoken_client.balance(&recipient) should equal 0");

    let currency = CurrencyCode::new(&env, "NGN");
    client.admin_drip_fiat(&recipient, &currency, &amount);

    assert_eq!(stoken_client.balance(&recipient), amount, "stoken_client.balance(&recipient) should equal amount");
    assert_eq!(stoken_client.balance(&client.address), 0, "stoken_client.balance(&client.address) should equal 0");
}

#[test]
#[should_panic(expected = "#5009")]
fn test_admin_drip_fiat_zero_amount() {
    let env = Env::default();
    let (_admin, stoken_id, client, _contract_id) = setup_drip_test(&env);
    let recipient = Address::generate(&env);

    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&client.address, &1_000_000_000);

    let currency = CurrencyCode::new(&env, "NGN");
    client.admin_drip_fiat(&recipient, &currency, &0);
}

#[test]
#[should_panic(expected = "#5009")]
fn test_admin_drip_fiat_negative_amount() {
    let env = Env::default();
    let (_admin, stoken_id, client, _contract_id) = setup_drip_test(&env);
    let recipient = Address::generate(&env);

    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&client.address, &1_000_000_000);

    let currency = CurrencyCode::new(&env, "NGN");
    client.admin_drip_fiat(&recipient, &currency, &(-100));
}

#[test]
#[should_panic(expected = "#5010")]
fn test_admin_drip_fiat_exceeds_cap() {
    let env = Env::default();
    let (_admin, stoken_id, client, _contract_id) = setup_drip_test(&env);
    let recipient = Address::generate(&env);

    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&client.address, &200_000_000_000_000i128);

    let currency = CurrencyCode::new(&env, "NGN");
    let huge_amount = 100_000_000_000_001i128;
    client.admin_drip_fiat(&recipient, &currency, &huge_amount);
}

#[test]
#[should_panic(expected = "#5011")]
fn test_admin_drip_fiat_insufficient_custody() {
    let env = Env::default();
    let (_admin, stoken_id, client, _contract_id) = setup_drip_test(&env);
    let recipient = Address::generate(&env);

    let amount = 500_000_000;
    let currency = CurrencyCode::new(&env, "NGN");
    client.admin_drip_fiat(&recipient, &currency, &amount);
}
