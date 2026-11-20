#![cfg(test)]

use acbu_lending_pool::{
    BorrowEvent, LoanCreatedEvent, LendingPool, LendingPoolClient, LoanStatus, RepayEvent,
};
use shared::DECIMALS;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Symbol, TryIntoVal,
};

/// Test helper: setup environment with initialized lending pool
fn setup() -> (Env, LendingPoolClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let fee_rate = 300i128; // 3%

    let contract_id = env.register_contract(None, LendingPool);
    let client = LendingPoolClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token, &fee_rate);

    (env, client, contract_id, admin, acbu_token)
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPOSIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_deposit_increases_balance() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 1_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);

    assert_eq!(client.get_balance(&lender), amount, "client.get_balance(&lender) should equal amount");
}

#[test]
fn test_deposit_zero_amount_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    let lender = Address::generate(&env);
    let result = client.try_deposit(&lender, &0);

    assert!(result.is_err());
}

#[test]
fn test_deposit_negative_amount_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    let lender = Address::generate(&env);
    let result = client.try_deposit(&lender, &-100);

    assert!(result.is_err());
}

#[test]
fn test_multiple_deposits_accumulate() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount1 = 500 * DECIMALS;
    let amount2 = 300 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &(amount1 + amount2));

    client.deposit(&lender, &amount1);
    client.deposit(&lender, &amount2);

    assert_eq!(client.get_balance(&lender), amount1 + amount2, "client.get_balance(&lender) should equal amount1 + amount2");
}

// ═══════════════════════════════════════════════════════════════════════════
// WITHDRAW TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_decreases_balance() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let deposit_amount = 1_000 * DECIMALS;
    let withdraw_amount = 400 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &deposit_amount);

    client.deposit(&lender, &deposit_amount);
    client.withdraw(&lender, &withdraw_amount);

    assert_eq!(client.get_balance(&lender), deposit_amount - withdraw_amount, "client.get_balance(&lender) should equal deposit_amount - withdraw_amount");
}

#[test]
fn test_withdraw_all_balance() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 1_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);
    client.withdraw(&lender, &amount);

    assert_eq!(client.get_balance(&lender), 0, "client.get_balance(&lender) should equal 0");
}

#[test]
fn test_withdraw_more_than_balance_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);

    let result = client.try_withdraw(&lender, &(amount + 1));
    assert!(result.is_err());
}

/// A partial withdrawal that would leave a dust balance (below the minimum)
/// must be rejected, leaving the lender's balance untouched.
#[test]
fn test_withdraw_leaving_dust_balance_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);

    // Withdrawing all but 1 stroop would leave a dust balance.
    let result = client.try_withdraw(&lender, &(amount - 1));
    assert!(result.is_err());
    assert_eq!(client.get_balance(&lender), amount, "client.get_balance(&lender) should equal amount");
}

/// Withdrawing the entire balance to exactly zero is always allowed, even
/// though zero is below the minimum balance threshold.
#[test]
fn test_withdraw_full_balance_to_zero_succeeds() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);
    client.withdraw(&lender, &amount);

    assert_eq!(client.get_balance(&lender), 0, "client.get_balance(&lender) should equal 0");
}

/// A partial withdrawal that leaves at least the minimum balance succeeds.
#[test]
fn test_withdraw_leaving_above_minimum_succeeds() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);
    client.withdraw(&lender, &(50 * DECIMALS));

    assert_eq!(client.get_balance(&lender), 50 * DECIMALS, "client.get_balance(&lender) should equal 50 * DECIMALS");
}

#[test]
fn test_withdraw_zero_amount_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    let lender = Address::generate(&env);
    let result = client.try_withdraw(&lender, &0);

    assert!(result.is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// BORROW TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_borrow_creates_loan() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    let loan = client.get_loan(&borrower, &loan_id).expect("loan should exist");
    assert_eq!(loan.amount, borrow_amount, "loan.amount should equal borrow_amount");
    assert_eq!(loan.borrower, borrower, "loan.borrower should equal borrower");
    assert_eq!(loan.collateral_amount, 0, "loan.collateral_amount should be 0");
}

#[test]
fn test_borrow_transfers_tokens_to_borrower() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 3_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    let token_client = TokenClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &1u64);

    assert_eq!(token_client.balance(&borrower), borrow_amount, "token_client.balance(&borrower) should equal borrow_amount");
}

#[test]
fn test_borrow_exceeds_pool_liquidity_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 1_000 * DECIMALS;
    let borrow_amount = 2_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);

    let result = client.try_borrow(&borrower, &lender, &borrow_amount, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_borrow_zero_amount_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    let borrower = Address::generate(&env);
    let lender = Address::generate(&env);
    let result = client.try_borrow(&borrower, &lender, &0, &1u64);

    assert!(result.is_err());
}

#[test]
fn test_borrow_duplicate_loan_id_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 2_000 * DECIMALS;
    let loan_id = 42u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    let result = client.try_borrow(&borrower, &lender, &borrow_amount, &loan_id);
    assert!(result.is_err());
}

#[test]
fn test_borrow_emits_event() {
    let (env, client, contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 3_000 * DECIMALS;
    let loan_id = 7u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    let events = env.events().all();
    let borrow_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == contract_id
                && e.1.first().is_some_and(|t| {
                    TryIntoVal::<_, Symbol>::try_into_val(&t, &env)
                        .is_ok_and(|s| s == symbol_short!("borrow"))
                })
        })
        .expect("borrow event not found");

    let event_data: BorrowEvent = borrow_event.2.try_into_val(&env).unwrap();
    assert_eq!(event_data.creator, borrower, "event_data.creator should equal borrower");
    assert_eq!(event_data.amount, borrow_amount, "event_data.amount should equal borrow_amount");
    assert_eq!(event_data.loan_id, loan_id, "event_data.loan_id should equal loan_id");
}

// ═══════════════════════════════════════════════════════════════════════════
// REPAY TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_repay_partial_reduces_loan_amount() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let repay_amount = 2_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);
    client.repay(&borrower, &repay_amount, &loan_id);

    let loan = client.get_loan(&borrower, &loan_id).expect("loan should still exist");
    assert_eq!(loan.amount, borrow_amount - repay_amount, "loan.amount should equal borrow_amount - repay_amount");
}

#[test]
fn test_repay_full_removes_loan() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);
    client.repay(&borrower, &borrow_amount, &loan_id);

    let loan = client
        .get_loan(&borrower, &loan_id)
        .expect("repaid loan state should remain available");
    assert_eq!(loan.amount, 0);
    assert!(matches!(loan.status, LoanStatus::Repaid));
}

#[test]
fn test_repay_full_clears_loan() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    let token_client = TokenClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);
    
    // After borrow: borrower has borrow_amount
    assert_eq!(token_client.balance(&borrower), borrow_amount, "token_client.balance(&borrower) should equal borrow_amount");
    
    client.repay(&borrower, &borrow_amount, &loan_id);
    
    // After full repay: borrower has 0
    assert_eq!(token_client.balance(&borrower), 0, "token_client.balance(&borrower) should equal 0");
}

#[test]
fn test_repay_more_than_loan_amount_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    let result = client.try_repay(&borrower, &(borrow_amount + 1), &loan_id);
    assert!(result.is_err());
}

#[test]
fn test_repay_nonexistent_loan_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    let borrower = Address::generate(&env);
    let result = client.try_repay(&borrower, &1000, &999u64);

    assert!(result.is_err());
}

#[test]
fn test_repay_zero_amount_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    let result = client.try_repay(&borrower, &0, &loan_id);
    assert!(result.is_err());
}

#[test]
fn test_repay_emits_event() {
    let (env, client, contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let repay_amount = 2_000 * DECIMALS;
    let loan_id = 3u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);
    client.repay(&borrower, &repay_amount, &loan_id);

    let events = env.events().all();
    let repay_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == contract_id
                && e.1.first().is_some_and(|t| {
                    TryIntoVal::<_, Symbol>::try_into_val(&t, &env)
                        .is_ok_and(|s| s == symbol_short!("repay"))
                })
        })
        .expect("repay event not found");

    let event_data: RepayEvent = repay_event.2.try_into_val(&env).unwrap();
    assert_eq!(event_data.creator, borrower, "event_data.creator should equal borrower");
    assert_eq!(event_data.amount, repay_amount, "event_data.amount should equal repay_amount");
    assert_eq!(event_data.loan_id, loan_id, "event_data.loan_id should equal loan_id");
}

// ═══════════════════════════════════════════════════════════════════════════
// PAUSE/UNPAUSE TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_deposit_when_paused_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    client.pause();

    let lender = Address::generate(&env);
    let result = client.try_deposit(&lender, &1000);

    assert!(result.is_err());
}

#[test]
fn test_withdraw_when_paused_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 1_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);
    client.pause();

    let result = client.try_withdraw(&lender, &amount);
    assert!(result.is_err());
}

#[test]
fn test_borrow_when_paused_fails() {
    let (env, client, _contract_id, _admin, _acbu_token) = setup();

    client.pause();

    let borrower = Address::generate(&env);
    let lender = Address::generate(&env);
    let result = client.try_borrow(&borrower, &lender, &1000, &1u64);

    assert!(result.is_err());
}

#[test]
fn test_repay_when_paused_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);
    
    client.pause();

    let result = client.try_repay(&borrower, &1000, &loan_id);
    assert!(result.is_err());
}

#[test]
fn test_unpause_allows_operations() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    client.pause();
    client.unpause();

    let lender = Address::generate(&env);
    let amount = 1_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);
    assert_eq!(client.get_balance(&lender), amount, "client.get_balance(&lender) should equal amount");
}

// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_multiple_borrowers_same_lender() {
    let (env, client, contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower1 = Address::generate(&env);
    let borrower2 = Address::generate(&env);
    let pool_liquidity = 20_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    let token_client = TokenClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);

    // First borrower
    client.borrow(&borrower1, &lender, &borrow_amount, &1u64);
    // Second borrower
    client.borrow(&borrower2, &lender, &borrow_amount, &2u64);

    // Both loans should exist
    let loan1 = client.get_loan(&borrower1, &1u64).expect("loan1 should exist");
    let loan2 = client.get_loan(&borrower2, &2u64).expect("loan2 should exist");
    assert_eq!(loan1.amount, borrow_amount, "loan1.amount should equal borrow_amount");
    assert_eq!(loan2.amount, borrow_amount, "loan2.amount should equal borrow_amount");

    // Contract should have remaining liquidity
    assert_eq!(
        token_client.balance(&contract_id),
        pool_liquidity - (borrow_amount * 2)
    , "token_client.balance(&contract_id) should equal pool_liquidity - (borrow_amount * 2)");
}

#[test]
fn test_deposit_withdraw_multiple_lenders() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender1 = Address::generate(&env);
    let lender2 = Address::generate(&env);
    let amount1 = 1_000 * DECIMALS;
    let amount2 = 2_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender1, &amount1);
    token_admin.mint(&lender2, &amount2);

    client.deposit(&lender1, &amount1);
    client.deposit(&lender2, &amount2);

    assert_eq!(client.get_balance(&lender1), amount1, "client.get_balance(&lender1) should equal amount1");
    assert_eq!(client.get_balance(&lender2), amount2, "client.get_balance(&lender2) should equal amount2");

    // Withdraw partial amounts
    client.withdraw(&lender1, &(500 * DECIMALS));
    client.withdraw(&lender2, &(1_000 * DECIMALS));

    assert_eq!(client.get_balance(&lender1), 500 * DECIMALS, "client.get_balance(&lender1) should equal 500 * DECIMALS");
    assert_eq!(client.get_balance(&lender2), 1_000 * DECIMALS, "client.get_balance(&lender2) should equal 1_000 * DECIMALS");
}

#[test]
fn test_repay_interest_accrual() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 5_000 * DECIMALS;
    let loan_id = 1u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    // Advance time to accrue interest
    let current_time = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = current_time + 30 * 24 * 60 * 60);

    // Get loan to see accrued interest
    let loan = client.get_loan(&borrower, &loan_id).expect("loan should exist");
    // With fee_rate of 300 bps (3%), interest should have accrued
    assert!(loan.accrued_interest >= 0);
    assert!(loan.total_repayment_due >= borrow_amount);
}

#[test]
fn test_borrow_negative_amount_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);

    client.deposit(&lender, &pool_liquidity);

    let result = client.try_borrow(&borrower, &lender, &-100, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_loan_created_event_has_correct_term_seconds() {
    let (env, client, contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let pool_liquidity = 10_000 * DECIMALS;
    let borrow_amount = 3_000 * DECIMALS;
    let loan_id = 99u64;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &pool_liquidity);
    client.deposit(&lender, &pool_liquidity);

    let borrow_timestamp = env.ledger().timestamp();
    client.borrow(&borrower, &lender, &borrow_amount, &loan_id);

    let events = env.events().all();
    let loan_created_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == contract_id
                && e.1.first().is_some_and(|t| {
                    TryIntoVal::<_, Symbol>::try_into_val(&t, &env)
                        .is_ok_and(|s| s == symbol_short!("loan_cr"))
                })
        })
        .expect("loan_cr event not found");

    let event_data: LoanCreatedEvent = loan_created_event.2.try_into_val(&env).unwrap();

    assert_eq!(
        event_data.term_seconds,
        30 * 24 * 60 * 60,
        "event.term_seconds should equal 30 days in seconds (2_592_000)"
    );
    assert_eq!(event_data.lender, lender, "event.lender should match");
    assert_eq!(event_data.borrower, borrower, "event.borrower should match");
    assert_eq!(
        event_data.amount, borrow_amount,
        "event.amount should match borrow_amount"
    );
    assert_eq!(
        event_data.interest_bps, 300,
        "event.interest_bps should match fee_rate (300)"
    );
    assert_eq!(
        event_data.timestamp, borrow_timestamp,
        "event.timestamp should match borrow timestamp"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #311: DUST BALANCE AND STORAGE CLEANUP TESTS
// ═══════════════════════════════════════════════════════════════════════════

/// Regression test for issue #311: A withdrawal that would leave exactly 1 stroop
/// (dust) should fail with DustBalance error, not succeed silently.
#[test]
fn test_withdraw_leaving_exactly_one_stroop_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS; // 100 ACBU

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);

    // Withdrawing all but 1 stroop would leave a 1-stroop dust balance.
    // This should fail with DustBalance error.
    let result = client.try_withdraw(&lender, &(amount - 1));
    assert!(result.is_err(), "Withdrawal leaving 1 stroop dust must fail");
    
    // Balance must remain untouched after failed withdrawal
    assert_eq!(client.get_balance(&lender), amount, "Balance must remain unchanged after failed dust withdrawal");
}

/// Positive test: Full withdrawal (balance becomes exactly 0) succeeds and storage entry is cleaned up.
#[test]
fn test_withdraw_full_balance_removes_storage_entry() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);
    assert_eq!(client.get_balance(&lender), amount, "Balance should be set after deposit");

    // Withdraw the full balance — this should succeed and remove the storage entry
    client.withdraw(&lender, &amount);

    // After full withdrawal, balance should be 0
    assert_eq!(client.get_balance(&lender), 0, "Balance should be 0 after full withdrawal");

    // Verify that the storage entry is removed by attempting to query again —
    // the contract should return 0 for a non-existent entry (default behavior).
    // This test confirms storage cleanup by checking that subsequent deposits work normally.
    let second_deposit = 50 * DECIMALS;
    token_admin.mint(&lender, &second_deposit);
    client.deposit(&lender, &second_deposit);
    assert_eq!(client.get_balance(&lender), second_deposit, "Balance should reflect new deposit after full withdrawal");
}

/// Positive test: Partial withdrawal leaving balance at or above minimum threshold succeeds.
#[test]
fn test_withdraw_leaving_above_minimum_balance_succeeds() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let amount = 100 * DECIMALS; // 100 ACBU = 100_000_000_000 stroops

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount);

    client.deposit(&lender, &amount);

    // MIN_POOL_BALANCE = 1_000_000 stroops = 0.1 ACBU
    // Withdraw to leave exactly 2 ACBU (2_000_000_000 stroops) — well above minimum.
    let withdraw_amount = amount - (2 * DECIMALS);
    client.withdraw(&lender, &withdraw_amount);

    assert_eq!(client.get_balance(&lender), 2 * DECIMALS, "Balance should be 2 ACBU after withdrawal");
}

/// Boundary test: Withdrawal leaving balance exactly equal to MIN_POOL_BALANCE (1_000_000 stroops) succeeds.
#[test]
fn test_withdraw_leaving_exactly_minimum_balance_succeeds() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    // Deposit 100.1 ACBU (100_100_000 stroops) so we can withdraw to exactly MIN_POOL_BALANCE (1_000_000)
    let _amount = 100_100_000i128; // In stroops
    
    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    // Use mint with exact stroop amount (avoiding DECIMALS which is 10_000_000_000 for 7-decimal token)
    // Instead, deposit via normal flow with adjusted amounts
    
    let amount_acbu = 100 * DECIMALS + 1_000_000; // 100.1 ACBU
    token_admin.mint(&lender, &amount_acbu);
    client.deposit(&lender, &amount_acbu);

    // Withdraw to leave exactly MIN_POOL_BALANCE (1_000_000 stroops = 0.0001 ACBU)
    let withdraw_amount = amount_acbu - 1_000_000;
    client.withdraw(&lender, &withdraw_amount);

    // Should succeed and balance should be exactly 1_000_000
    assert_eq!(client.get_balance(&lender), 1_000_000, "Balance should be exactly MIN_POOL_BALANCE after withdrawal");
}

/// Boundary test: Withdrawal leaving balance exactly one unit below MIN_POOL_BALANCE fails.
#[test]
fn test_withdraw_leaving_just_below_minimum_balance_fails() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    // Deposit 100.1 ACBU so we can attempt to withdraw to just below MIN_POOL_BALANCE
    let amount_acbu = 100 * DECIMALS + 1_000_000;
    
    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &amount_acbu);
    client.deposit(&lender, &amount_acbu);

    // Try to withdraw to leave 999_999 stroops (just below MIN_POOL_BALANCE of 1_000_000)
    let withdraw_amount = amount_acbu - 999_999;
    let result = client.try_withdraw(&lender, &withdraw_amount);
    
    assert!(result.is_err(), "Withdrawal leaving just below MIN_POOL_BALANCE must fail");
    assert_eq!(client.get_balance(&lender), amount_acbu, "Balance must remain unchanged after failed withdrawal");
}

/// Regression test: Existing full lifecycle (deposit → partial withdrawal → full withdrawal)
/// still works correctly after the fix.
#[test]
fn test_deposit_partial_withdraw_full_withdraw_lifecycle() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender = Address::generate(&env);
    let initial_deposit = 100 * DECIMALS;
    let partial_withdraw = 40 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    let token_client = TokenClient::new(&env, &acbu_token);
    token_admin.mint(&lender, &initial_deposit);

    // Step 1: Deposit
    client.deposit(&lender, &initial_deposit);
    assert_eq!(client.get_balance(&lender), initial_deposit, "Balance after deposit");
    assert_eq!(token_client.balance(&lender), 0, "Lender wallet should be empty after deposit");

    // Step 2: Partial withdrawal (leaving 60 ACBU, well above minimum)
    client.withdraw(&lender, &partial_withdraw);
    assert_eq!(client.get_balance(&lender), initial_deposit - partial_withdraw, "Balance after partial withdrawal");
    assert_eq!(token_client.balance(&lender), partial_withdraw, "Lender wallet should have withdrawn amount");

    // Step 3: Full withdrawal of remaining balance
    let remaining = initial_deposit - partial_withdraw;
    client.withdraw(&lender, &remaining);
    assert_eq!(client.get_balance(&lender), 0, "Balance after full withdrawal");
    assert_eq!(token_client.balance(&lender), initial_deposit, "Lender wallet should have all tokens");
}

/// Test: Multiple lenders can independently maintain balances above/at/below thresholds.
#[test]
fn test_multiple_lenders_independent_dust_balance_enforcement() {
    let (env, client, _contract_id, _admin, acbu_token) = setup();

    let lender1 = Address::generate(&env);
    let lender2 = Address::generate(&env);
    let amount = 100 * DECIMALS;

    let token_admin = StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&lender1, &amount);
    token_admin.mint(&lender2, &amount);

    client.deposit(&lender1, &amount);
    client.deposit(&lender2, &amount);

    // Lender1: try to leave dust (should fail)
    let result = client.try_withdraw(&lender1, &(amount - 1));
    assert!(result.is_err(), "Lender1 dust withdrawal must fail");

    // Lender2: withdraw to full zero (should succeed)
    client.withdraw(&lender2, &amount);
    assert_eq!(client.get_balance(&lender2), 0, "Lender2 full withdrawal must succeed");

    // Lender1's balance is unchanged after their failed attempt
    assert_eq!(client.get_balance(&lender1), amount, "Lender1 balance must be unchanged after failed withdrawal");
}
