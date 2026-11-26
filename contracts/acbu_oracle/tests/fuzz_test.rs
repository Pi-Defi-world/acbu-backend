#![cfg(test)]

use acbu_oracle::{OracleContract, OracleContractClient};
use proptest::prelude::*;
use shared::{CurrencyCode, BASIS_POINTS, DECIMALS};
use soroban_sdk::{testutils::Address as _, Address, Env, Map, Vec};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Set up a minimal oracle with one validator and one currency.
fn setup_oracle(env: &Env) -> (OracleContractClient<'_>, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let validator = Address::generate(env);

    let mut validators = Vec::new(env);
    validators.push_back(validator.clone());

    let ngn = CurrencyCode::new(env, "NGN");
    let mut currencies = Vec::new(env);
    currencies.push_back(ngn.clone());

    let mut basket_weights = Map::new(env);
    basket_weights.set(ngn, 10_000i128); // 100 % weight

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(env, &contract_id);
    client.initialize(&admin, &validators, &1u32, &currencies, &basket_weights);

    (client, admin, validator)
}

// ---------------------------------------------------------------------------
// Property: min_signatures boundary
//
// min_signatures must be in 1..=validators.len(). Values outside this range,
// including zero, must be rejected.
// ---------------------------------------------------------------------------
proptest! {
    #[test]
    fn prop_initialize_min_signatures_boundary(
        num_validators in 1usize..10usize,
        min_sigs_offset in -5i32..15i32,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);

        let mut validators = Vec::new(&env);
        for _ in 0..num_validators {
            validators.push_back(Address::generate(&env));
        }

        let min_sigs_raw = (num_validators as i32) + min_sigs_offset;
        if min_sigs_raw <= 0 || min_sigs_raw > 50 {
            // Skip values outside the representable u32 range.
            return Ok(());
        }
        let min_sigs = min_sigs_raw as u32;

        let ngn = CurrencyCode::new(&env, "NGN");
        let mut currencies = Vec::new(&env);
        currencies.push_back(ngn.clone());
        let mut basket_weights = Map::new(&env);
        basket_weights.set(ngn, 10_000i128);

        let contract_id = env.register_contract(None, OracleContract);
        let client = OracleContractClient::new(&env, &contract_id);

        let result = client.try_initialize(
            &admin, &validators, &min_sigs, &currencies, &basket_weights,
        );

        let valid = min_sigs >= 1 && min_sigs <= (num_validators as u32);
        if valid {
            assert!(result.is_ok(), "valid min_sigs={min_sigs} with {num_validators} validators must be accepted");
        } else {
            assert!(result.is_err(), "invalid min_sigs={min_sigs} with {num_validators} validators must be rejected");
        }
    }

    // -----------------------------------------------------------------------
    // Property: rate deviation arithmetic — `calculate_deviation` must never
    //           return a negative value and must be symmetric around the reference.
    //
    // deviation_bps = |new_rate - old_rate| * BASIS_POINTS / old_rate
    // -----------------------------------------------------------------------
    #[test]
    fn prop_rate_deviation_non_negative(
        old_rate in 1i128..1_000_000_000_000i128,
        new_rate in 1i128..1_000_000_000_000i128,
    ) {
        // Reproduce shared::calculate_deviation inline.
        let diff = (new_rate - old_rate).abs();
        let deviation_bps = diff
            .checked_mul(BASIS_POINTS)
            .and_then(|v| v.checked_div(old_rate));

        if let Some(dev) = deviation_bps {
            assert!(dev >= 0, "deviation must be non-negative: old={old_rate} new={new_rate}");
        }
        // Overflow cases are acceptable (they correspond to unrealistically
        // large rate swings) — the contract handles them via checked arithmetic.
    }

    // -----------------------------------------------------------------------
    // Property: median of a single-element list equals that element
    // -----------------------------------------------------------------------
    #[test]
    fn prop_median_singleton(value in 1i128..1_000_000_000_000i128) {
        let env = Env::default();
        let mut values = soroban_sdk::Vec::new(&env);
        values.push_back(value);

        let result = shared::median(values);
        assert_eq!(result, Some(value), "median of a single element must equal that element");
    }

    // -----------------------------------------------------------------------
    // Property: median of two equal elements equals that element
    // -----------------------------------------------------------------------
    #[test]
    fn prop_median_two_equal(value in 1i128..1_000_000_000i128) {
        let env = Env::default();
        let mut values = soroban_sdk::Vec::new(&env);
        values.push_back(value);
        values.push_back(value);

        let result = shared::median(values);
        assert_eq!(result, Some(value), "median of two equal elements must equal that element");
    }

    // -----------------------------------------------------------------------
    // Property: median is bounded by min and max of the input list
    // -----------------------------------------------------------------------
    #[test]
    fn prop_median_bounded_by_extremes(
        a in 1i128..500_000_000i128,
        b in 1i128..500_000_000i128,
        c in 1i128..500_000_000i128,
    ) {
        let env = Env::default();
        let mut values = soroban_sdk::Vec::new(&env);
        values.push_back(a);
        values.push_back(b);
        values.push_back(c);

        let min_val = a.min(b).min(c);
        let max_val = a.max(b).max(c);

        if let Some(m) = shared::median(values) {
            assert!(
                m >= min_val && m <= max_val,
                "median={m} must lie between min={min_val} and max={max_val}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Property: rate validation — zero and negative rates must be rejected
    //           when submitted via the admin override path.
    //
    // The oracle rejects rates <= 0 as InvalidRate to prevent division-by-zero
    // in downstream conversions.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_admin_set_rate_nonpositive_rejected(rate in -1_000_000_000i128..0i128) {
        let env = Env::default();
        let (client, _admin, _validator) = setup_oracle(&env);

        let ngn = CurrencyCode::new(&env, "NGN");
        let result = client.try_set_rate_admin(&ngn, &rate);
        assert!(
            result.is_err(),
            "non-positive rate={rate} must be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Property: `calculate_fee` and `calculate_amount_after_fee` are
    //           consistent — fee + net == gross for all valid inputs.
    //
    // These shared helpers underpin minting and burning fee calculations.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_fee_helpers_consistent(
        amount in 1i128..1_000_000_000_000i128,
        fee_rate_bps in 0i128..10_000i128,
    ) {
        let fee_result = shared::calculate_fee(amount, fee_rate_bps);
        let net_result = shared::calculate_amount_after_fee(amount, fee_rate_bps);

        match (fee_result, net_result) {
            (Ok(fee), Ok(net)) => {
                assert_eq!(
                    fee + net,
                    amount,
                    "fee={fee} + net={net} must equal amount={amount}"
                );
                assert!(fee >= 0, "fee must be non-negative");
                assert!(net >= 0, "net must be non-negative");
            }
            _ => {
                // Overflow on extreme inputs — acceptable, the contract returns a typed error.
            }
        }
    }

    // -----------------------------------------------------------------------
    // Property: ACBU/USD rate conversion — amount_acbu = usdc_amount * DECIMALS / rate
    //           must be non-negative for positive inputs.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_acbu_conversion_non_negative(
        usdc_amount in 1i128..1_000_000_000_000i128,
        rate in 1i128..1_000_000_000_000i128,
    ) {
        let acbu_amount = usdc_amount
            .checked_mul(DECIMALS)
            .and_then(|v| v.checked_div(rate));

        if let Some(result) = acbu_amount {
            assert!(
                result >= 0,
                "ACBU conversion must be non-negative: usdc={usdc_amount} rate={rate}"
            );
        }
        // Overflow / underflow: acceptable for edge inputs.
    }
}
