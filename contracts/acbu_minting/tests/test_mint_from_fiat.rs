#![cfg(test)]

use acbu_minting::{MintingContract, MintingContractClient};
use shared::{CurrencyCode, MintEvent, DECIMALS};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events},
    Address, Env, FromVal, IntoVal, String as SorobanString, Symbol, Vec,
};

// --- Mocks (reuse from test.rs) ---

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

fn oracle_mock_client<'a>(env: &'a Env, oracle: &'a Address) -> oracle_mock::MockOracleClient<'a> {
    oracle_mock::MockOracleClient::new(env, oracle)
}

fn setup_test(
    env: &Env,
) -> (
    Address,
    Address,
    Address,
    Address,
    Address,
    MintingContractClient,
) {
    let admin = Address::generate(env);
    let oracle = env.register_contract(None, oracle_mock::MockOracle);
    let reserve_tracker = env.register_contract(None, reserve_mock::MockReserveTracker);

    let contract_id = env.register_contract(None, MintingContract);
    let acbu_token = env
        .register_stellar_asset_contract_v2(contract_id.clone())
        .address();

    let usdc_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let client = MintingContractClient::new(env, &contract_id);

    (
        admin,
        oracle,
        reserve_tracker,
        acbu_token,
        usdc_token,
        client,
    )
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

// --- Tests for mint_from_fiat: Access Control and Validation ---

#[test]
fn test_mint_from_fiat_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_001");
    let acbu = client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );

    assert!(acbu > 0);
    let acbu_client = soroban_sdk::token::Client::new(&env, &acbu_token_id);
    assert_eq!(acbu_client.balance(&recipient), acbu, "acbu_client.balance(&recipient) should equal acbu");
    assert_eq!(client.get_total_supply(), acbu, "client.get_total_supply() should equal acbu");
}

#[test]
#[should_panic(expected = "Unauthorized operator")]
#[should_panic(expected = "#5007")]
fn test_mint_from_fiat_unauthorized_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let attacker = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_001");

    // Attacker tries to call mint_from_fiat - should fail
    client.mint_from_fiat(
        &attacker,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}

#[test]
#[should_panic(expected = "Unauthorized operator")]
#[should_panic(expected = "#5007")]
fn test_mint_from_fiat_recipient_self_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_001");

    // Recipient tries to call as themselves - should fail because only operator can call
    client.mint_from_fiat(
        &recipient,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}

#[test]
#[should_panic(expected = "#5014")]
fn test_mint_from_fiat_empty_tx_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "");

    // Call with empty fintech_tx_id - should fail
    client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}

#[test]
#[should_panic(expected = "Fiat transaction already processed")]
#[should_panic(expected = "#5008")]
fn test_mint_from_fiat_duplicate_tx_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(500 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_duplicate");

    // First call succeeds
    client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id.clone(),
    );

    // Second call with same tx_id should fail
    client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}

#[test]
#[should_panic(expected = "#5003")]
fn test_mint_from_fiat_below_min_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    // Mint amount is too small (less than MIN_MINT_AMOUNT)
    let fiat_amount = 1; // Way too small
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_small");

    client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}

#[test]
#[should_panic(expected = "#5003")]
fn test_mint_from_fiat_above_max_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100_000 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    // Mint amount exceeds MAX_MINT_AMOUNT
    let fiat_amount = 1_000_000_000_000_000;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_large");

    client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}

#[test]
fn test_mint_from_fiat_admin_not_default_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    // Set custom operator (not admin)
    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_custom_op");

    // Custom operator should succeed
    let acbu = client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
    assert!(acbu > 0);
}

#[test]
#[should_panic(expected = "Unauthorized operator")]
#[should_panic(expected = "#5007")]
fn test_mint_from_fiat_admin_when_operator_set() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    // Set custom operator (different from admin)
    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_admin_tries");

    // Admin tries to call but is not the operator anymore - should fail
    client.mint_from_fiat(
        &admin,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
    );
}
