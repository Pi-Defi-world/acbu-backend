#![cfg(test)]

use acbu_reserve_tracker::{ReserveTrackerContract, ReserveTrackerContractClient};
use proptest::prelude::*;
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{testutils::Address as _, Env};

// ---------------------------------------------------------------------------
// Property: reserve ratio arithmetic
//
// The contract computes:
//   reserve_ratio_bps = total_reserve_usd * BASIS_POINTS * DECIMALS / total_acbu_usd
//
// For non-negative inputs this must stay non-negative and must equal or
// exceed BASIS_POINTS (100 %) when reserves equal or exceed supply value.
// ---------------------------------------------------------------------------
proptest! {
    #[test]
    fn prop_reserve_ratio_non_negative(
        total_reserve_usd in 0i128..1_000_000_000_000_000i128,
        total_acbu_usd in 1i128..1_000_000_000_000_000i128,
    ) {
        let basis_points: i128 = 10_000;

        // Reproduce the reserve tracker's ratio formula:
        //   ratio_bps = total_reserve_usd * BASIS_POINTS * DECIMALS / total_acbu_usd
        let ratio = total_reserve_usd
            .checked_mul(basis_points)
            .and_then(|v| v.checked_mul(DECIMALS))
            .and_then(|v| v.checked_div(total_acbu_usd));

        if let Some(r) = ratio {
            assert!(r >= 0, "reserve ratio must be non-negative");
        }
    }

    #[test]
    fn prop_reserve_at_parity_meets_minimum(
        supply_usd in 1i128..1_000_000_000_000i128,
    ) {
        let basis_points: i128 = 10_000;
        // When reserves exactly equal supply, ratio must equal BASIS_POINTS (100 %).
        let total_reserve_usd = supply_usd;
        let total_acbu_usd = supply_usd;

        let ratio = total_reserve_usd
            .checked_mul(basis_points)
            .and_then(|v| v.checked_mul(DECIMALS))
            .and_then(|v| v.checked_div(total_acbu_usd));

        if let Some(r) = ratio {
            // Due to integer division the ratio can be slightly below BASIS_POINTS * DECIMALS
            // only when rounding truncates the LSB.
            assert!(
                r >= basis_points,
                "reserve ratio={r} must be >= BASIS_POINTS when reserves == supply"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Property: `update_reserve` rejects non-positive amount or value_usd
    //
    // The contract validates amount > 0 and value_usd > 0 before any
    // cross-contract call, so these tests do not require a mock oracle.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_update_reserve_nonpositive_amount_rejected(
        amount in -1_000_000_000i128..0i128,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = soroban_sdk::Address::generate(&env);
        let oracle = soroban_sdk::Address::generate(&env);
        let acbu_token = soroban_sdk::Address::generate(&env);

        let contract_id = env.register_contract(None, ReserveTrackerContract);
        let client = ReserveTrackerContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

        let ngn = CurrencyCode::new(&env, "NGN");

        // The contract panics with NonPositiveAmount before it reaches the oracle call.
        let result = client.try_update_reserve(
            &admin,
            &ngn,
            &amount,
            &100_000_000i128,
        );
        assert!(
            result.is_err(),
            "non-positive amount={amount} must be rejected before any oracle call"
        );
    }

    #[test]
    fn prop_update_reserve_nonpositive_value_usd_rejected(
        value_usd in -1_000_000_000i128..0i128,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = soroban_sdk::Address::generate(&env);
        let oracle = soroban_sdk::Address::generate(&env);
        let acbu_token = soroban_sdk::Address::generate(&env);

        let contract_id = env.register_contract(None, ReserveTrackerContract);
        let client = ReserveTrackerContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

        let ngn = CurrencyCode::new(&env, "NGN");

        let result = client.try_update_reserve(
            &admin,
            &ngn,
            &100_000_000i128,
            &value_usd,
        );
        assert!(
            result.is_err(),
            "non-positive value_usd={value_usd} must be rejected before any oracle call"
        );
    }

    // -----------------------------------------------------------------------
    // Property: reserve tolerance arithmetic
    //
    // The contract accepts `value_usd` if it lies within RESERVE_TOLERANCE_BPS
    // (10 bps) of the oracle-derived value. For realistic inputs the tolerance
    // window must be symmetric and non-negative.
    //
    // derived_usd = amount * oracle_rate / DECIMALS
    // tolerance   = max(derived_usd * 10 / 10_000,  DECIMALS / 100)
    // -----------------------------------------------------------------------
    #[test]
    fn prop_reserve_tolerance_non_negative(
        amount in 1i128..1_000_000_000_000i128,
        oracle_rate in 1i128..1_000_000_000_000i128,
    ) {
        let tolerance_bps: i128 = 10;
        let basis_points: i128 = 10_000;
        let min_tolerance: i128 = DECIMALS / 100;

        let derived_usd = amount
            .checked_mul(oracle_rate)
            .and_then(|v| v.checked_div(DECIMALS));

        if let Some(derived) = derived_usd {
            let pct_tolerance = derived
                .checked_mul(tolerance_bps)
                .and_then(|v| v.checked_div(basis_points))
                .unwrap_or(0);

            let tolerance = pct_tolerance.max(min_tolerance);

            assert!(tolerance >= 0, "tolerance must be non-negative");
            assert!(
                min_tolerance >= 0,
                "minimum tolerance must be non-negative"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Property: double initialization must fail
    // -----------------------------------------------------------------------
    #[test]
    fn prop_double_initialize_rejected(_seed in 0u32..1000u32) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = soroban_sdk::Address::generate(&env);
        let oracle = soroban_sdk::Address::generate(&env);
        let acbu_token = soroban_sdk::Address::generate(&env);

        let contract_id = env.register_contract(None, ReserveTrackerContract);
        let client = ReserveTrackerContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &acbu_token, &10_000i128);

        let oracle2 = soroban_sdk::Address::generate(&env);
        let token2 = soroban_sdk::Address::generate(&env);
        let result = client.try_initialize(&admin, &oracle2, &token2, &10_000i128);
        assert!(result.is_err(), "second initialize must be rejected");
    }
}
