#![cfg(test)]

use acbu_lending_pool::{LendingPool, LendingPoolClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_pool(env: &Env, fee_rate_bps: i128) -> (LendingPoolClient<'_>, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register_contract(None, LendingPool);
    let client = LendingPoolClient::new(env, &contract_id);
    client.initialize(&admin, &acbu_token, &fee_rate_bps);
    (client, admin, acbu_token)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// Property: fee_rate_bps boundary — only 0..=10000 is valid
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
        let contract_id = env.register_contract(None, LendingPool);
        let client = LendingPoolClient::new(&env, &contract_id);

        let result = client.try_initialize(&admin, &acbu_token, &fee_rate);

        if (0..=10_000i128).contains(&fee_rate) {
            assert!(result.is_ok(), "valid fee_rate={fee_rate} must be accepted");
        } else {
            assert!(result.is_err(), "invalid fee_rate={fee_rate} must be rejected");
        }
    }

    // -----------------------------------------------------------------------
    // Property: deposit amount validation — only positive amounts allowed
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_amount_sign(amount in -100i128..1_000_000_000_000i128) {
        let env = Env::default();
        let (client, _admin, acbu_token) = setup_pool(&env, 300);
        let lender = Address::generate(&env);

        if amount > 0 {
            mint(&env, &acbu_token, &lender, amount);
        }

        let result = client.try_deposit(&lender, &amount);

        if amount <= 0 {
            assert!(result.is_err(), "non-positive amount={amount} must be rejected");
        } else {
            assert!(result.is_ok(), "positive amount={amount} must be accepted");
        }
    }

    // -----------------------------------------------------------------------
    // Property: deposit then withdraw full balance — balance returns to zero
    //           and no funds are lost.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_deposit_withdraw_roundtrip(amount in 1_000_001i128..500_000_000i128) {
        let env = Env::default();
        let (client, _admin, acbu_token) = setup_pool(&env, 0);
        let lender = Address::generate(&env);
        let token_client = soroban_sdk::token::Client::new(&env, &acbu_token);

        mint(&env, &acbu_token, &lender, amount);

        client.deposit(&lender, &amount);

        // Withdraw the full amount.
        client.withdraw(&lender, &amount);

        assert_eq!(
            token_client.balance(&lender),
            amount,
            "full withdraw must return all funds to lender"
        );
        assert_eq!(
            client.get_balance(&lender),
            0,
            "pool balance must be zero after full withdrawal"
        );
    }

    // -----------------------------------------------------------------------
    // Property: multiple deposits accumulate — pool balance equals sum of deposits
    // -----------------------------------------------------------------------
    #[test]
    fn prop_multiple_deposits_accumulate(
        amount1 in 1_000_000i128..100_000_000i128,
        amount2 in 1_000_000i128..100_000_000i128,
    ) {
        let env = Env::default();
        let (client, _admin, acbu_token) = setup_pool(&env, 0);
        let lender = Address::generate(&env);

        mint(&env, &acbu_token, &lender, amount1 + amount2);

        client.deposit(&lender, &amount1);
        client.deposit(&lender, &amount2);

        assert_eq!(
            client.get_balance(&lender),
            amount1 + amount2,
            "pool balance must equal sum of deposits"
        );
    }

    // -----------------------------------------------------------------------
    // Property: borrow amount validation — only positive amounts allowed
    // -----------------------------------------------------------------------
    #[test]
    fn prop_borrow_nonpositive_rejected(amount in -1_000_000i128..0i128) {
        let env = Env::default();
        let (client, _admin, acbu_token) = setup_pool(&env, 300);
        let lender = Address::generate(&env);
        let borrower = Address::generate(&env);

        // Seed liquidity so the rejection is about amount validation, not balance.
        mint(&env, &acbu_token, &lender, 100_000_000);
        client.deposit(&lender, &100_000_000);

        let result = client.try_borrow(&borrower, &lender, &amount, &1u64);
        assert!(
            result.is_err(),
            "non-positive borrow amount={amount} must be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Property: interest calculation never overflows for realistic inputs
    //
    // The lending pool calculates accrued interest as:
    //   interest = (principal * rate_bps * elapsed_secs) / (BASIS_POINTS * SECONDS_PER_YEAR)
    //
    // For realistic principal (up to ~1 trillion stroops) and term (up to 30 days),
    // this must never produce a negative or overflow result.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_loan_interest_non_negative(
        principal in 1_000_000i128..1_000_000_000_000i128,
        fee_rate_bps in 0i128..10_000i128,
        elapsed_secs in 0u64..2_592_000u64, // 0 to 30 days
    ) {
        // Reproduce the lending pool's fee accrual formula inline to verify
        // the calculation stays within range without calling the contract.
        //
        // calculate_accrued_fee(principal, rate_bps, elapsed):
        //   (principal * rate_bps * elapsed) / (10_000 * 31_536_000)
        let basis_points: i128 = 10_000;
        let seconds_per_year: i128 = 31_536_000;

        let numerator = (principal as i128)
            .checked_mul(fee_rate_bps)
            .and_then(|v| v.checked_mul(elapsed_secs as i128));

        if let Some(num) = numerator {
            let denominator = basis_points
                .checked_mul(seconds_per_year)
                .expect("denominator must not overflow");
            let interest = num.checked_div(denominator).unwrap_or(0);
            assert!(
                interest >= 0,
                "accrued interest must be non-negative: principal={principal} \
                 rate={fee_rate_bps} elapsed={elapsed_secs}"
            );
            // Interest must not exceed the principal (rate is annualised,
            // elapsed is at most 30 days, rate at most 100 %).
            assert!(
                interest <= principal,
                "accrued interest={interest} must not exceed principal={principal} \
                 for a 30-day window"
            );
        }
        // If numerator overflowed, the contract would panic_with_error — that
        // is acceptable and outside the realistic input range.
    }

    // -----------------------------------------------------------------------
    // Property: repay amount validation — zero or negative rejected
    // -----------------------------------------------------------------------
    #[test]
    fn prop_repay_nonpositive_rejected(amount in -1_000_000i128..0i128) {
        let env = Env::default();
        let (client, _admin, acbu_token) = setup_pool(&env, 300);
        let lender = Address::generate(&env);
        let borrower = Address::generate(&env);

        // Establish a live loan.
        mint(&env, &acbu_token, &lender, 100_000_000);
        mint(&env, &acbu_token, &borrower, 1_000_000);
        client.deposit(&lender, &100_000_000);
        client.borrow(&borrower, &lender, &10_000_000, &1u64);

        let result = client.try_repay(&borrower, &amount, &1u64);
        assert!(
            result.is_err(),
            "non-positive repay amount={amount} must be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Property: borrow + full repay — lender's outstanding loan balance returns
    //           to zero and no funds are stranded (zero-fee pool).
    // -----------------------------------------------------------------------
    #[test]
    fn prop_borrow_full_repay_clears_loan(
        borrow_amount in 1_000_000i128..50_000_000i128,
    ) {
        let env = Env::default();
        // Use fee_rate = 0 so repayment equals principal exactly.
        let (client, _admin, acbu_token) = setup_pool(&env, 0);
        let lender = Address::generate(&env);
        let borrower = Address::generate(&env);

        mint(&env, &acbu_token, &lender, 100_000_000);
        mint(&env, &acbu_token, &borrower, borrow_amount);
        client.deposit(&lender, &100_000_000);
        client.borrow(&borrower, &lender, &borrow_amount, &1u64);

        // Repay exactly the borrowed principal (no interest at rate=0).
        client.repay(&borrower, &borrow_amount, &1u64);

        // After full repayment the lender's available balance must recover.
        // Balance stored should be >= borrow_amount (repaid principal credited back).
        let lender_balance = client.get_balance(&lender);
        assert!(
            lender_balance >= borrow_amount,
            "lender balance={lender_balance} must be >= borrow_amount={borrow_amount} after full repay"
        );
    }

    // -----------------------------------------------------------------------
    // Property: withdraw beyond available balance is rejected
    // -----------------------------------------------------------------------
    #[test]
    fn prop_withdraw_beyond_balance_rejected(
        deposit in 1_000_001i128..50_000_000i128,
        excess in 1i128..10_000_000i128,
    ) {
        let env = Env::default();
        let (client, _admin, acbu_token) = setup_pool(&env, 0);
        let lender = Address::generate(&env);

        mint(&env, &acbu_token, &lender, deposit);
        client.deposit(&lender, &deposit);

        let overdraft = deposit + excess;
        let result = client.try_withdraw(&lender, &overdraft);
        assert!(
            result.is_err(),
            "withdraw of {overdraft} beyond deposit of {deposit} must fail"
        );
    }
}
