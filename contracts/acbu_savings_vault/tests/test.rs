#![cfg(test)]

use acbu_savings_vault::DepositEvent;
use acbu_savings_vault::{SavingsVault, SavingsVaultClient, WithdrawEvent};
use shared::DECIMALS;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, Env, FromVal, IntoVal, Symbol,
};

const SECONDS_PER_YEAR: u64 = 31_536_000;

#[test]
fn test_withdraw_after_term_has_correct_30day_yield() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    let fee_rate = 300; // 3%
    let yield_rate = 1_000; // 10% APR
    client.initialize(&admin, &acbu_token, &fee_rate, &yield_rate);

    let deposit_amount = DECIMALS;
    let term_seconds = 30 * 24 * 3600u64; // 2_592_000 seconds

    let expected_fee = 300_000i128;
    let net_deposit = deposit_amount - expected_fee;
    let expected_yield = 79_726i128;
    let expected_user_payout = net_deposit + expected_yield;

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &deposit_amount);
    token_admin.mint(&contract_id, &expected_yield);

    client.deposit(&user, &deposit_amount, &term_seconds);

    // Advance time past the lock term
    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + term_seconds);

    // Preview yield before withdraw
    assert_eq!(
        client.get_pending_yield(&user, &term_seconds),
        expected_yield
    , "client.get_pending_yield(&user, &term_seconds) should equal expected_yield");

    client.withdraw(&user, &term_seconds, &net_deposit);

    let token_client = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token_client.balance(&user), expected_user_payout, "token_client.balance(&user) should equal expected_user_payout");
    assert_eq!(token_client.balance(&admin), expected_fee, "token_client.balance(&admin) should equal expected_fee");

    let events = env.events().all();
    let withdraw_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == contract_id
                && Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("Withdraw")
        })
        .unwrap();
    let withdraw_event: WithdrawEvent = withdraw_event.2.into_val(&env);
    assert_eq!(withdraw_event.yield_amount, expected_yield, "withdraw_event.yield_amount should equal expected_yield"); // Acceptance check passes
}

#[test]
fn test_withdraw_after_one_year_has_positive_yield_and_event_value() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    let fee_rate = 300; // 3%
    let yield_rate = 1_000; // 10% APR
    client.initialize(&admin, &acbu_token, &fee_rate, &yield_rate);

    let deposit_amount = DECIMALS;
    let expected_fee = 300_000;
    // Base everything on net
    let net_deposit = 9_700_000;
    // Yield on net: 9_700_000 * 10% = 970_000
    let expected_yield = 970_000;
    let expected_user_payout = net_deposit + expected_yield;
    let term_seconds = 30 * 24 * 3600;

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &deposit_amount);
    token_admin.mint(&contract_id, &expected_yield);

    client.deposit(&user, &deposit_amount, &term_seconds);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + SECONDS_PER_YEAR);

    client.withdraw(&user, &term_seconds, &net_deposit);

    let token_client = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token_client.balance(&user), expected_user_payout, "token_client.balance(&user) should equal expected_user_payout");
    assert_eq!(token_client.balance(&admin), expected_fee, "token_client.balance(&admin) should equal expected_fee");

    let events = env.events().all();
    let mut found_withdraw = false;

    for event in events.iter() {
        if event.0 != contract_id {
            continue;
        }
        let topics = event.1;
        if !topics.is_empty()
            && Symbol::from_val(&env, &topics.get(0).unwrap()) == symbol_short!("Withdraw")
        {
            let withdraw_event: WithdrawEvent = event.2.into_val(&env);

            assert_eq!(withdraw_event.yield_amount, expected_yield, "withdraw_event.yield_amount should equal expected_yield");
            found_withdraw = true;
        }
    }

    assert!(found_withdraw);
}

#[test]
fn test_partial_withdraw_and_multiple_deposits_fifo_yield() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    let fee_rate = 0; // NEW: Use 0 fee to keep test simple, otherwise recalc all lots
    let yield_rate = 1_000; // 10% APR
    client.initialize(&admin, &acbu_token, &fee_rate, &yield_rate);

    let term_seconds = 30 * 24 * 3600;
    let lot_1 = 5_000_000;
    let lot_2 = 5_000_000;
    let withdraw_amount = 6_000_000;

    // FIFO expected yield unchanged because fee_rate = 0
    let expected_yield = 550_000;

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &(lot_1 + lot_2));
    token_admin.mint(&contract_id, &expected_yield);

    client.deposit(&user, &lot_1, &term_seconds);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + (SECONDS_PER_YEAR / 2));

    client.deposit(&user, &lot_2, &term_seconds);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + SECONDS_PER_YEAR);

    client.withdraw(&user, &term_seconds, &withdraw_amount);

    let token_client = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(
        token_client.balance(&user),
        withdraw_amount + expected_yield
    , "token_client.balance(&user) should equal withdraw_amount + expected_yield");
    assert_eq!(client.get_balance(&user, &term_seconds), 4_000_000, "client.get_balance(&user, &term_seconds) should equal 4_000_000");
}

/// Issue #30 regression test: a user who deposits and tries to withdraw before the
/// term elapses must be rejected with an error.
#[test]
fn test_early_withdrawal_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token, &300, &1_000);

    let deposit_amount = DECIMALS;

    let net_deposit = 9_700_000;
    let term_seconds: u64 = 30 * 24 * 3600; // 30 days

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &deposit_amount);
    client.deposit(&user, &deposit_amount, &term_seconds);

    // Try to withdraw with only 1 second elapsed — term is 30 days away
    env.ledger().with_mut(|l| l.timestamp = 1_000_001);

    let result = client.try_withdraw(&user, &term_seconds, &net_deposit);
    assert!(
        result.is_err(),
        "Withdrawal before term elapsed must be rejected"
    );
    // Balance must still be intact

    assert_eq!(client.get_balance(&user, &term_seconds), net_deposit, "client.get_balance(&user, &term_seconds) should equal net_deposit");
}

/// Verify that withdrawal succeeds at exactly the term boundary (timestamp + term_seconds).
#[test]
fn test_withdraw_at_exact_term_boundary_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    let fee_rate = 0i128;
    let yield_rate = 0i128;
    client.initialize(&admin, &acbu_token, &fee_rate, &yield_rate);

    let deposit_amount = DECIMALS;
    let term_seconds: u64 = 60 * 60; // 1 hour

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &deposit_amount);
    client.deposit(&user, &deposit_amount, &term_seconds);

    // Advance to exactly term boundary
    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + term_seconds);

    client.withdraw(&user, &term_seconds, &deposit_amount);

    let token_client = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token_client.balance(&user), deposit_amount, "token_client.balance(&user) should equal deposit_amount");
    assert_eq!(client.get_balance(&user, &term_seconds), 0, "client.get_balance(&user, &term_seconds) should equal 0");
}

#[test]
fn test_withdraw_only_uses_lots_that_reached_their_own_term() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);
    client.initialize(&admin, &acbu_token, &0i128, &0i128);

    let short_term: u64 = 60;
    let long_term: u64 = 3_600;
    let short_amount = 5_000_000i128;
    let long_amount = 7_000_000i128;

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &(short_amount + long_amount));

    client.deposit(&user, &short_amount, &short_term);
    client.deposit(&user, &long_amount, &long_term);

    // Only the short-term lot is mature.
    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + short_term);

    // Short-term withdrawal succeeds.
    client.withdraw(&user, &short_term, &short_amount);
    assert_eq!(client.get_balance(&user, &short_term), 0, "client.get_balance(&user, &short_term) should equal 0");

    // Long-term withdrawal still fails because its own term has not elapsed.
    let early_long = client.try_withdraw(&user, &long_term, &long_amount);
    assert!(early_long.is_err());
    assert_eq!(client.get_balance(&user, &long_term), long_amount, "client.get_balance(&user, &long_term) should equal long_amount");
}

#[test]
fn test_deposit_fee_reflected_in_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    let fee_rate = 300; // 3%
    let yield_rate = 0;
    client.initialize(&admin, &acbu_token, &fee_rate, &yield_rate);

    let gross_deposit = DECIMALS;
    let expected_fee = 300_000i128;
    let expected_net = 9_700_000i128;
    let term_seconds = 3600u64;

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &gross_deposit);

    let returned_balance = client.deposit(&user, &gross_deposit, &term_seconds);
    assert_eq!(returned_balance, expected_net, "returned_balance should equal expected_net");

    assert_eq!(client.get_balance(&user, &term_seconds), expected_net, "client.get_balance(&user, &term_seconds) should equal expected_net");

    let token_client = soroban_sdk::token::Client::new(&env, &acbu_token);

    assert_eq!(token_client.balance(&admin), expected_fee, "token_client.balance(&admin) should equal expected_fee");
}

///NEW: Update existing test to check DepositEvent fields
#[test]
fn test_deposit_event_has_fee_fields() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token, &300, &0);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &DECIMALS);

    client.deposit(&user, &DECIMALS, &3600);

    let events = env.events().all();
    let deposit_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == contract_id
                && Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("Deposit")
        })
        .unwrap();
    let deposit_event: DepositEvent = deposit_event.2.into_val(&env);

    assert_eq!(deposit_event.gross_amount, DECIMALS, "deposit_event.gross_amount should equal DECIMALS");
    assert_eq!(deposit_event.fee_amount, 300_000, "deposit_event.fee_amount should equal 300_000");
    assert_eq!(deposit_event.net_amount, 9_700_000, "deposit_event.net_amount should equal 9_700_000");
    assert_eq!(
        deposit_event.maturity_timestamp,
        deposit_event.timestamp + 3600
    , "deposit_event.maturity_timestamp should equal deposit_event.timestamp + 3600");
}

#[test]
fn test_update_acbu_token_by_admin_savings_vault() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);
    client.initialize(&admin, &acbu_token, &100, &500);

    let new_token = Address::generate(&env);
    client.update_acbu_token(&new_token);
}

/// Issue #225 regression: WithdrawEvent.yield_amount must not be zero when a
/// positive yield_rate is set and time has elapsed past the lock term.
#[test]
fn test_withdraw_event_yield_amount_nonzero_issue_225() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    let yield_rate_bps = 1_000i128; // 10% APR
    client.initialize(&admin, &acbu_token, &0i128, &yield_rate_bps);

    let principal = DECIMALS;
    let term_seconds = 30 * 24 * 3600u64;

    let elapsed = i128::from(term_seconds);
    let expected_yield =
        principal * yield_rate_bps * elapsed / (10_000 * i128::from(SECONDS_PER_YEAR));

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &principal);
    token_admin.mint(&contract_id, &expected_yield);

    client.deposit(&user, &principal, &term_seconds);
    env.ledger()
        .with_mut(|l| l.timestamp = 1_000_000 + term_seconds);

    client.withdraw(&user, &term_seconds, &principal);

    let events = env.events().all();
    let withdraw_ev = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == contract_id
                && Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("Withdraw")
        })
        .expect("Withdraw event must be emitted");

    let ev: WithdrawEvent = withdraw_ev.2.into_val(&env);
    assert!(
        ev.yield_amount > 0,
        "WithdrawEvent.yield_amount must be non-zero when yield_rate > 0 (issue #225 regression)"
    );
    assert_eq!(ev.yield_amount, expected_yield, "ev.yield_amount should equal expected_yield");
    assert_eq!(ev.fee_amount, 0, "ev.fee_amount should equal 0");
}

#[test]
fn test_deposit_fails_and_does_not_write_to_storage_when_balance_insufficient() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token, &300, &1000);

    let deposit_amount = DECIMALS;
    let term_seconds = 3600;

    // Do NOT mint any tokens to user, so user has 0 balance.
    // Calling deposit should fail (panic on transfer).
    let result = client.try_deposit(&user, &deposit_amount, &term_seconds);
    assert!(result.is_err());

    // Verify that NO deposit lot was recorded in storage for the user.
    assert_eq!(client.get_balance(&user, &term_seconds), 0, "client.get_balance(&user, &term_seconds) should equal 0");
}

/// Issue #336 regression test: get_user_lots with pagination prevents
/// exceeding Soroban's return value size limit when users have many deposit lots.
#[test]
fn test_get_user_lots_pagination() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, SavingsVault);
    let client = SavingsVaultClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token, &0i128, &0i128);

    let term_seconds = 3600u64;
    let num_lots = 150;

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    token_admin.mint(&user, &(num_lots as i128 * 1_000_000));

    for _ in 0..num_lots {
        client.deposit(&user, &1_000_000i128, &term_seconds);
    }

    let page1 = client.get_user_lots(&user, &term_seconds, &0u32, &100u32);
    assert_eq!(page1.len(), 100, "First page should return 100 lots");

    let page2 = client.get_user_lots(&user, &term_seconds, &100u32, &100u32);
    assert_eq!(page2.len(), 50, "Second page should return remaining 50 lots");

    let page3 = client.get_user_lots(&user, &term_seconds, &200u32, &100u32);
    assert_eq!(page3.len(), 0, "Offset beyond available lots should return empty");

    let page4 = client.get_user_lots(&user, &term_seconds, &0u32, &0u32);
    assert_eq!(page4.len(), 100, "Limit 0 should default to max 100");

    let page5 = client.get_user_lots(&user, &term_seconds, &0u32, &25u32);
    assert_eq!(page5.len(), 25, "Custom limit of 25 should return 25 lots");
}
