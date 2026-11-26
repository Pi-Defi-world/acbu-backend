#![cfg(test)]

use acbu_savings_vault::{SavingsVault, SavingsVaultClient};
use proptest::prelude::*;
use shared::BASIS_POINTS;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup(
    env: &Env,
    fee_rate_bps: i128,
    yield_rate_bps: i128,
) -> (SavingsVaultClient<'_>, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(env, &contract_id);
    client.initialize(&admin, &acbu_token, &fee_rate_bps, &yield_rate_bps);
    (client, admin, acbu_token)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// Property: fee and yield rate boundary enforcement
//
// Only values 0..=BASIS_POINTS (10 000) are valid for each rate.
// ---------------------------------------------------------------------------
proptest! {
    #[test]
    fn prop_initialize_fee_rate_boundary(fee_rate in -5_000i128..20_000i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let acbu_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, SavingsVault);
        let client = SavingsVaultClient::new(&env, &contract_id);

        let result = client.try_initialize(&admin, &acbu_token, &fee_rate, &0i128);

        if (0..=BASIS_POINTS).contains(&fee_rate) {
            assert!(result.is_ok(), "valid fee_rate={fee_rate} must be accepted");
        } else {
            assert!(result.is_err(), "invalid fee_rate={fee_rate} must be rejected");
        }
    }

    #[test]
    fn prop_initialize_yield_rate_boundary(yield_rate in -5_000i128..20_000i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let acbu_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, SavingsVault);
        let client = SavingsVaultClient::new(&env, &contract_id);

        let result = client.try_initialize(&admin, &acbu_token, &0i128, &yield_rate);

        if (0..=BASIS_POINTS).contains(&yield_rate) {
            assert!(result.is_ok(), "valid yield_rate={yield_rate} must be accepted");
        } else {
            assert!(result.is_err(), "invalid yield_rate={yield_rate} must be rejected");
        }
    }

    // -----------------------------------------------------------------------
    // Property: deposit rejects non-positive amounts
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_nonpositive_amount_rejected(amount in -100_000_000i128..0i128) {
        let env = Env::default();
        let (client, _admin, _token) = setup(&env, 100, 500);

        let user = Address::generate(&env);
        let result = client.try_deposit(&user, &amount, &86_400u64);
        assert!(
            result.is_err(),
            "non-positive deposit amount={amount} must be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Property: deposit rejects zero term
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_zero_term_rejected(amount in 1_000_000i128..100_000_000i128) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env, 100, 500);
        let user = Address::generate(&env);
        mint(&env, &token, &user, amount);

        let result = client.try_deposit(&user, &amount, &0u64);
        assert!(result.is_err(), "zero term_seconds must be rejected");
    }

    // -----------------------------------------------------------------------
    // Property: fee arithmetic — net amount equals gross minus fee and is
    //           always non-negative for valid inputs.
    //
    // This mirrors the vault's internal `calculate_fee` / `net_amount` logic:
    //   fee  = amount * fee_rate_bps / 10_000
    //   net  = amount - fee
    // Both must be non-negative and their sum must equal `amount`.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_fee_arithmetic_no_loss(
        amount in 1_000_000i128..1_000_000_000_000i128,
        fee_rate_bps in 0i128..10_000i128,
    ) {
        // Reproduce the vault's fee formula inline.
        let fee = amount
            .checked_mul(fee_rate_bps)
            .and_then(|v| v.checked_div(BASIS_POINTS))
            .expect("fee calculation must not overflow for realistic inputs");

        let net = amount
            .checked_sub(fee)
            .expect("net amount must not underflow");

        assert!(fee >= 0, "fee must be non-negative");
        assert!(net >= 0, "net deposit must be non-negative");
        assert_eq!(
            fee + net,
            amount,
            "fee + net must equal gross amount (no value created or destroyed)"
        );
    }

    // -----------------------------------------------------------------------
    // Property: deposit net amount is strictly less than gross when fee > 0,
    //           and equal when fee = 0.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_net_amount_monotone(
        amount in 10_000_000i128..100_000_000i128,
        fee_rate_bps in 0i128..10_000i128,
    ) {
        let fee = amount * fee_rate_bps / BASIS_POINTS;
        let net = amount - fee;

        if fee_rate_bps == 0 {
            assert_eq!(net, amount, "net must equal gross when fee_rate=0");
        } else {
            assert!(net < amount, "net must be less than gross when fee_rate>0");
        }
        assert!(net >= 0, "net must always be non-negative");
    }

    // -----------------------------------------------------------------------
    // Property: deposit with zero fee rate — net amount equals gross amount
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_zero_fee_net_equals_gross(
        amount in 10_000_000i128..100_000_000i128,
        term in 86_400u64..2_592_000u64,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env, 0, 0);
        let user = Address::generate(&env);

        mint(&env, &token, &user, amount);

        // deposit() returns net_amount.
        let net = client.deposit(&user, &amount, &term);
        assert_eq!(
            net, amount,
            "net deposit must equal gross when fee_rate=0"
        );
    }

    // -----------------------------------------------------------------------
    // Property: locked deposit cannot be withdrawn before term elapses
    // -----------------------------------------------------------------------
    #[test]
    fn prop_locked_deposit_cannot_be_withdrawn_early(
        amount in 10_000_000i128..100_000_000i128,
        term in 86_400u64..2_592_000u64, // 1 day to 30 days
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env, 0, 0);
        let user = Address::generate(&env);

        mint(&env, &token, &user, amount);
        client.deposit(&user, &amount, &term);

        // Try to withdraw immediately (time has not advanced).
        let result = client.try_withdraw(&user, &term, &amount);
        assert!(
            result.is_err(),
            "early withdrawal before term={term} must be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Property: deposit amount validation — zero produces ZeroNetDeposit when
    //           fee_rate = BASIS_POINTS (100 %) or is otherwise invalid.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_zero_amount_always_rejected(term in 1u64..2_592_000u64) {
        let env = Env::default();
        let (client, _admin, _token) = setup(&env, 100, 500);
        let user = Address::generate(&env);

        let result = client.try_deposit(&user, &0i128, &term);
        assert!(result.is_err(), "zero deposit amount must always be rejected");
    }
}
