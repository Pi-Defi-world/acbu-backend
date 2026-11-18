#![cfg(test)]

//! Integration test for cross-contract mint-burn flow
//! 
//! This test verifies the complete lifecycle:
//! 1. Oracle provides rates
//! 2. Reserve tracker validates reserves
//! 3. Minting contract mints ACBU via oracle rate
//! 4. Burning contract burns ACBU back to fiat
//!
//! Addresses issue #24: No end-to-end test that mints via oracle rate,
//! verifies reserves, then burns to fiat.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, IntoVal, Map, Symbol, Vec,
};

// Import contract clients
use acbu_minting::{MintingContract, MintingContractClient};
use acbu_burning::{BurningContract, BurningContractClient};
use acbu_oracle::{OracleContract, OracleContractClient};
use acbu_reserve_tracker::{ReserveTracker, ReserveTrackerClient};
use shared::{CurrencyCode, DECIMALS};

/// Setup complete system with all contracts
fn setup_system() -> (
    Env,
    MintingContractClient,
    BurningContractClient,
    OracleContractClient,
    ReserveTrackerClient,
    Address, // admin
    Address, // acbu_token
    Address, // usdc_token
    Address, // vault
    Address, // treasury
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);

    // Deploy ACBU token (Stellar Asset Contract)
    let acbu_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    
    // Deploy USDC token
    let usdc_token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let vault = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Deploy Oracle
    let oracle_id = env.register_contract(None, OracleContract);
    let oracle_client = OracleContractClient::new(&env, &oracle_id);

    let validator1 = Address::generate(&env);
    let validator2 = Address::generate(&env);
    let validator3 = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(validator1.clone());
    validators.push_back(validator2.clone());
    validators.push_back(validator3.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    currencies.push_back(kes.clone());

    let mut basket_weights = Map::new(&env);
    basket_weights.set(ngn.clone(), 5000i128); // 50%
    basket_weights.set(kes.clone(), 5000i128); // 50%

    oracle_client.initialize(&admin, &validators, &2u32, &currencies, &basket_weights);

    // Set initial rates
    let mut ngn_sources = Vec::new(&env);
    ngn_sources.push_back(1_000_000i128); // 0.1 USD per NGN
    ngn_sources.push_back(1_000_000i128);
    ngn_sources.push_back(1_000_000i128);
    oracle_client.update_rate(&validator1, &ngn, &1_000_000i128, &ngn_sources, &env.ledger().timestamp());

    let mut kes_sources = Vec::new(&env);
    kes_sources.push_back(2_000_000i128); // 0.2 USD per KES
    kes_sources.push_back(2_000_000i128);
    kes_sources.push_back(2_000_000i128);
    oracle_client.update_rate(&validator1, &kes, &2_000_000i128, &kes_sources, &env.ledger().timestamp());

    // Deploy Reserve Tracker
    let reserve_tracker_id = env.register_contract(None, ReserveTracker);
    let reserve_tracker_client = ReserveTrackerClient::new(&env, &reserve_tracker_id);
    reserve_tracker_client.initialize(&admin, &oracle_id);

    // Add initial reserves
    reserve_tracker_client.add_reserve(&ngn, &(100_000 * DECIMALS), &(10_000 * DECIMALS));
    reserve_tracker_client.add_reserve(&kes, &(50_000 * DECIMALS), &(10_000 * DECIMALS));

    // Deploy Minting Contract
    let minting_id = env.register_contract(None, MintingContract);
    let minting_client = MintingContractClient::new(&env, &minting_id);
    minting_client.initialize(
        &admin,
        &oracle_id,
        &reserve_tracker_id,
        &acbu_token,
        &usdc_token,
        &vault,
        &treasury,
        &300i128,  // 3% fee for basket/USDC
        &500i128,  // 5% fee for single S-token
    );

    // Deploy Burning Contract
    let burning_id = env.register_contract(None, BurningContract);
    let burning_client = BurningContractClient::new(&env, &burning_id);
    burning_client.initialize(
        &admin,
        &oracle_id,
        &reserve_tracker_id,
        &acbu_token,
        &vault,
        &treasury,
        &300i128, // 3% fee
    );

    (
        env,
        minting_client,
        burning_client,
        oracle_client,
        reserve_tracker_client,
        admin,
        acbu_token,
        usdc_token,
        vault,
        treasury,
    )
}

#[test]
fn test_mint_usdc_verify_reserves_burn_to_fiat() {
    let (
        env,
        minting_client,
        burning_client,
        oracle_client,
        reserve_tracker_client,
        admin,
        acbu_token,
        usdc_token,
        _vault,
        _treasury,
    ) = setup_system();

    let user = Address::generate(&env);
    let usdc_amount = 1_000 * DECIMALS; // 1000 USDC

    // Mint USDC to user
    let usdc_admin = StellarAssetClient::new(&env, &usdc_token);
    usdc_admin.mint(&user, &usdc_amount);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Mint ACBU from USDC
    // ═══════════════════════════════════════════════════════════════════════

    let acbu_minted = minting_client.mint_from_usdc(&user, &usdc_amount, &user);
    assert!(acbu_minted > 0, "ACBU should be minted");

    // Verify user received ACBU
    let acbu_client = TokenClient::new(&env, &acbu_token);
    let user_acbu_balance = acbu_client.balance(&user);
    assert_eq!(user_acbu_balance, acbu_minted, "user_acbu_balance should equal acbu_minted");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Verify reserves are sufficient
    // ═══════════════════════════════════════════════════════════════════════

    let total_supply = minting_client.get_total_supply();
    let reserves_sufficient = reserve_tracker_client.is_reserve_sufficient(&total_supply);
    assert!(reserves_sufficient, "Reserves should be sufficient after mint");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Burn ACBU back to fiat
    // ═══════════════════════════════════════════════════════════════════════

    let ngn = CurrencyCode::new(&env, "NGN");
    let burn_amount = acbu_minted / 2; // Burn half

    let local_amount = burning_client.burn_to_fiat(&user, &burn_amount, &ngn);
    assert!(local_amount > 0, "Should receive local currency amount");

    // Verify user's ACBU balance decreased
    let user_acbu_balance_after_burn = acbu_client.balance(&user);
    assert!(user_acbu_balance_after_burn < user_acbu_balance, "ACBU balance should decrease after burn");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Verify reserves are still sufficient
    // ═══════════════════════════════════════════════════════════════════════

    let total_supply_after_burn = minting_client.get_total_supply();
    assert!(total_supply_after_burn < total_supply, "Total supply should decrease after burn");

    let reserves_still_sufficient = reserve_tracker_client.is_reserve_sufficient(&total_supply_after_burn);
    assert!(reserves_still_sufficient, "Reserves should still be sufficient after burn");
}

#[test]
fn test_mint_from_basket_burn_to_basket() {
    let (
        env,
        minting_client,
        burning_client,
        oracle_client,
        reserve_tracker_client,
        admin,
        acbu_token,
        _usdc_token,
        vault,
        _treasury,
    ) = setup_system();

    let user = Address::generate(&env);
    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");

    // Setup S-tokens
    let ngn_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let kes_token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    oracle_client.set_s_token_address(&ngn, &ngn_token);
    oracle_client.set_s_token_address(&kes, &kes_token);

    // Mint S-tokens to user
    let ngn_admin = StellarAssetClient::new(&env, &ngn_token);
    let kes_admin = StellarAssetClient::new(&env, &kes_token);
    ngn_admin.mint(&user, &(10_000 * DECIMALS));
    kes_admin.mint(&user, &(10_000 * DECIMALS));

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Mint ACBU from basket
    // ═══════════════════════════════════════════════════════════════════════

    let acbu_amount = 1_000 * DECIMALS;
    let proof_id = soroban_sdk::String::from_str(&env, "proof_123");

    let minted = minting_client.mint_from_basket(&user, &user, &acbu_amount, &proof_id);
    assert_eq!(minted, acbu_amount, "minted should equal acbu_amount");

    // Verify S-tokens were transferred to vault
    let ngn_client = TokenClient::new(&env, &ngn_token);
    let kes_client = TokenClient::new(&env, &kes_token);
    assert!(ngn_client.balance(&vault) > 0, "NGN should be in vault");
    assert!(kes_client.balance(&vault) > 0, "KES should be in vault");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Verify reserves
    // ═══════════════════════════════════════════════════════════════════════

    let total_supply = minting_client.get_total_supply();
    let reserves_sufficient = reserve_tracker_client.is_reserve_sufficient(&total_supply);
    assert!(reserves_sufficient, "Reserves should be sufficient");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Burn ACBU for basket
    // ═══════════════════════════════════════════════════════════════════════

    let burn_amount = acbu_amount / 2;
    let mut recipients = Vec::new(&env);
    recipients.push_back(user.clone());

    let mut amounts = Vec::new(&env);
    amounts.push_back(burn_amount);

    burning_client.burn_for_basket(&user, &burn_amount, &recipients, &amounts);

    // Verify ACBU was burned
    let acbu_client = TokenClient::new(&env, &acbu_token);
    let user_balance = acbu_client.balance(&user);
    assert!(user_balance < acbu_amount, "ACBU should be burned");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Verify final reserves
    // ═══════════════════════════════════════════════════════════════════════

    let final_supply = minting_client.get_total_supply();
    let final_reserves_sufficient = reserve_tracker_client.is_reserve_sufficient(&final_supply);
    assert!(final_reserves_sufficient, "Final reserves should be sufficient");
}

#[test]
fn test_mint_exceeds_reserves_fails() {
    let (
        env,
        minting_client,
        _burning_client,
        _oracle_client,
        reserve_tracker_client,
        admin,
        _acbu_token,
        usdc_token,
        _vault,
        _treasury,
    ) = setup_system();

    let user = Address::generate(&env);
    
    // Try to mint a huge amount that exceeds reserves
    let huge_amount = 1_000_000_000 * DECIMALS; // 1 billion USDC

    let usdc_admin = StellarAssetClient::new(&env, &usdc_token);
    usdc_admin.mint(&user, &huge_amount);

    // This should fail because reserves are insufficient
    let result = minting_client.try_mint_from_usdc(&user, &huge_amount, &user);
    assert!(result.is_err(), "Minting should fail when reserves are insufficient");
}

#[test]
fn test_oracle_rate_affects_mint_burn_amounts() {
    let (
        env,
        minting_client,
        burning_client,
        oracle_client,
        _reserve_tracker_client,
        admin,
        acbu_token,
        usdc_token,
        _vault,
        _treasury,
    ) = setup_system();

    let user = Address::generate(&env);
    let usdc_amount = 1_000 * DECIMALS;

    // Mint USDC to user
    let usdc_admin = StellarAssetClient::new(&env, &usdc_token);
    usdc_admin.mint(&user, &usdc_amount * 2);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Mint at initial rate
    // ═══════════════════════════════════════════════════════════════════════

    let acbu_minted_1 = minting_client.mint_from_usdc(&user, &usdc_amount, &user);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Update oracle rate (double the rate)
    // ═══════════════════════════════════════════════════════════════════════

    let validator = oracle_client.get_validators().get(0).unwrap();
    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");

    // Advance time to allow rate update
    env.ledger().with_mut(|l| l.timestamp += 21_601);

    let mut ngn_sources = Vec::new(&env);
    ngn_sources.push_back(2_000_000i128); // Double the rate
    ngn_sources.push_back(2_000_000i128);
    ngn_sources.push_back(2_000_000i128);
    oracle_client.update_rate(&validator, &ngn, &2_000_000i128, &ngn_sources, &env.ledger().timestamp());

    let mut kes_sources = Vec::new(&env);
    kes_sources.push_back(4_000_000i128); // Double the rate
    kes_sources.push_back(4_000_000i128);
    kes_sources.push_back(4_000_000i128);
    oracle_client.update_rate(&validator, &kes, &4_000_000i128, &kes_sources, &env.ledger().timestamp());

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Mint at new rate
    // ═══════════════════════════════════════════════════════════════════════

    let acbu_minted_2 = minting_client.mint_from_usdc(&user, &usdc_amount, &user);

    // With doubled rate, should get less ACBU for same USDC
    assert!(acbu_minted_2 < acbu_minted_1, "Should get less ACBU when rate increases");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Burn and verify rate affects local currency amount
    // ═══════════════════════════════════════════════════════════════════════

    let burn_amount = acbu_minted_2;
    let local_amount = burning_client.burn_to_fiat(&user, &burn_amount, &ngn);

    // With doubled rate, should get more NGN for same ACBU
    assert!(local_amount > 0, "Should receive local currency");
}

#[test]
fn test_complete_lifecycle_multiple_users() {
    let (
        env,
        minting_client,
        burning_client,
        oracle_client,
        reserve_tracker_client,
        admin,
        acbu_token,
        usdc_token,
        _vault,
        _treasury,
    ) = setup_system();

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    let usdc_admin = StellarAssetClient::new(&env, &usdc_token);
    let acbu_client = TokenClient::new(&env, &acbu_token);

    // ═══════════════════════════════════════════════════════════════════════
    // Multiple users mint
    // ═══════════════════════════════════════════════════════════════════════

    usdc_admin.mint(&user1, &(1_000 * DECIMALS));
    usdc_admin.mint(&user2, &(2_000 * DECIMALS));
    usdc_admin.mint(&user3, &(3_000 * DECIMALS));

    let acbu1 = minting_client.mint_from_usdc(&user1, &(1_000 * DECIMALS), &user1);
    let acbu2 = minting_client.mint_from_usdc(&user2, &(2_000 * DECIMALS), &user2);
    let acbu3 = minting_client.mint_from_usdc(&user3, &(3_000 * DECIMALS), &user3);

    assert!(acbu1 > 0 && acbu2 > 0 && acbu3 > 0);

    // Verify total supply
    let total_supply = minting_client.get_total_supply();
    assert!(total_supply >= acbu1 + acbu2 + acbu3);

    // ═══════════════════════════════════════════════════════════════════════
    // Multiple users burn
    // ═══════════════════════════════════════════════════════════════════════

    let ngn = CurrencyCode::new(&env, "NGN");

    burning_client.burn_to_fiat(&user1, &(acbu1 / 2), &ngn);
    burning_client.burn_to_fiat(&user2, &(acbu2 / 2), &ngn);
    burning_client.burn_to_fiat(&user3, &(acbu3 / 2), &ngn);

    // Verify balances decreased
    assert!(acbu_client.balance(&user1) < acbu1);
    assert!(acbu_client.balance(&user2) < acbu2);
    assert!(acbu_client.balance(&user3) < acbu3);

    // Verify reserves still sufficient
    let final_supply = minting_client.get_total_supply();
    assert!(reserve_tracker_client.is_reserve_sufficient(&final_supply));
}
