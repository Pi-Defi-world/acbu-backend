// SC-035: Tests for sync_supply — negative value rejection and token cross-check.
#![cfg(test)]

use acbu_minting::{MintingContract, MintingContractClient};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Minimal mocks (same pattern as other test modules)
// ---------------------------------------------------------------------------

mod oracle_mock {
    use super::*;

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
                .expect("seed_stoken not called")
        }
        pub fn seed_stoken(env: Env, stoken: Address) {
            env.storage().instance().set(&symbol_short!("STK"), &stoken);
        }
    }
}

mod reserve_mock {
    use super::*;
    #[contract]
    pub struct MockReserveTracker;

    #[contractimpl]
    impl MockReserveTracker {
        pub fn is_reserve_sufficient(_env: Env, _supply: i128) -> bool {
            true
        }
    }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

/// Returns (admin, operator, acbu_token_address, client).
fn setup(env: &Env) -> (Address, Address, Address, MintingContractClient) {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let operator = Address::generate(env);
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
    client.initialize(
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token,
        &usdc_token,
        &admin, // vault
        &admin, // treasury
        &300i128,
        &100i128,
        &operator,
    );

    (admin, operator, acbu_token, client)
}

// ---------------------------------------------------------------------------
// SC-035 (1): negative value rejection
// ---------------------------------------------------------------------------

/// sync_supply(-1) must panic with NegativeSupply (5025).
#[test]
#[should_panic(expected = "#5025")]
fn test_sync_supply_rejects_negative_value() {
    let env = Env::default();
    let (admin, _operator, _acbu_token, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();
    client.sync_supply(&-1i128);
    let _ = admin; // suppress unused warning
}

/// sync_supply(i128::MIN) must also panic with NegativeSupply (5025).
#[test]
#[should_panic(expected = "#5025")]
fn test_sync_supply_rejects_min_i128() {
    let env = Env::default();
    let (_admin, _operator, _acbu_token, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();
    client.sync_supply(&i128::MIN);
}

// ---------------------------------------------------------------------------
// SC-035 (2): token contract cross-check
// ---------------------------------------------------------------------------

/// sync_supply with a value that does not match the token's on-chain
/// total_supply must panic with SupplyMismatch (5026).
/// The acbu_token SAC is freshly deployed so its total_supply() == 0.
/// Calling sync_supply(500) therefore mismatches → panic.
#[test]
#[should_panic(expected = "#5026")]
fn test_sync_supply_rejects_mismatch_with_token_supply() {
    let env = Env::default();
    let (_admin, _operator, _acbu_token, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();
    // Token SAC has no minted supply yet → total_supply() == 0.
    // Supplying 500 must be rejected as a mismatch.
    client.sync_supply(&500i128);
}

/// sync_supply(0) when token total_supply() is also 0 must succeed (no-op
/// reconciliation at genesis).
#[test]
fn test_sync_supply_accepts_zero_when_token_supply_is_zero() {
    let env = Env::default();
    let (_admin, _operator, _acbu_token, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();
    // Token SAC total_supply() == 0; syncing to 0 is valid.
    client.sync_supply(&0i128);
    assert_eq!(client.get_total_supply(), 0);
}

/// sync_supply with the correct value (matching token total_supply) succeeds
/// and updates the internal counter.
///
/// We simulate a previously minted supply by directly manipulating the SAC,
/// then call sync_supply with the matching value.
#[test]
fn test_sync_supply_succeeds_when_matching_token_supply() {
    let env = Env::default();
    let (_admin, _operator, acbu_token_addr, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();

    // Mint some ACBU tokens directly via the SAC so total_supply() > 0.
    let recipient = Address::generate(&env);
    let mint_amount: i128 = 1_000 * DECIMALS;
    let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token_addr);
    acbu_sac.mint(&recipient, &mint_amount);

    // Now sync_supply with the matching value should succeed.
    client.sync_supply(&mint_amount);
    assert_eq!(client.get_total_supply(), mint_amount);
}

// ---------------------------------------------------------------------------
// Ensure paused contract rejects sync_supply (existing behaviour preserved)
// ---------------------------------------------------------------------------

/// sync_supply on a paused contract must panic with Paused (5012).
#[test]
#[should_panic(expected = "#5012")]
fn test_sync_supply_rejects_when_paused() {
    let env = Env::default();
    let (_admin, _operator, acbu_token_addr, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();

    // Mint to match total_supply so we don't hit NegativeSupply/SupplyMismatch first.
    let recipient = Address::generate(&env);
    let mint_amount: i128 = 100 * DECIMALS;
    let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token_addr);
    acbu_sac.mint(&recipient, &mint_amount);

    client.pause();
    client.sync_supply(&mint_amount);
}

// ---------------------------------------------------------------------------
// Supply-cap check is preserved
// ---------------------------------------------------------------------------

/// sync_supply with a value exceeding max_supply must panic with
/// MaxSupplyExceeded (5019).
/// Note: the value must match the token's total_supply too, so we first mint
/// an amount beyond the cap directly via the SAC, then attempt sync.
#[test]
#[should_panic(expected = "#5019")]
fn test_sync_supply_rejects_above_max_supply() {
    let env = Env::default();
    let (_admin, _operator, acbu_token_addr, client) = setup(&env);

    env.mock_all_auths_allowing_non_root_auth();

    // shared::MAX_TOTAL_SUPPLY is 1_000_000_000 * DECIMALS (1 quadrillion with 7 decimals).
    // Overflow the cap by minting one more than the max.
    // We use set_max_supply to a smaller value to make the test fast.
    client.set_max_supply(&(10 * DECIMALS)); // cap = 10 ACBU

    // Mint 11 ACBU via SAC so total_supply() > cap.
    let recipient = Address::generate(&env);
    let over_cap: i128 = 11 * DECIMALS;
    let acbu_sac = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token_addr);
    acbu_sac.mint(&recipient, &over_cap);

    // sync_supply(11 ACBU) matches token supply but exceeds cap → MaxSupplyExceeded.
    client.sync_supply(&over_cap);
}
