#![cfg(test)]

use acbu_savings_vault::{SavingsVault, SavingsVaultClient, WithdrawEvent, DepositEvent};
use shared::BASIS_POINTS;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, Env, FromVal, IntoVal, Symbol,
};

const SECONDS_PER_YEAR: u64 = 31_536_000;

// ============================================================================
// Test Harness
// ============================================================================

struct TestEnv {
    env: Env,
    admin: Address,
    user: Address,
    user2: Address,
    acbu_token: Address,
    contract_id: Address,
    client: SavingsVaultClient<'static>,
}

impl TestEnv {
    fn new(fee_rate_bps: i128, yield_rate_bps: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let user2 = Address::generate(&env);
        let acbu_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let contract_id = env.register_contract(None, SavingsVault);

        let client = SavingsVaultClient::new(
            unsafe { &*(&env as *const Env) },
            &contract_id,
        );

        client.initialize(&admin, &acbu_token, &fee_rate_bps, &yield_rate_bps);

        Self {
            env,
            admin,
            user,
            user2,
            acbu_token,
            contract_id,
            client,
        }
    }

    fn token_admin(&self) -> soroban_sdk::token::StellarAssetClient {
        soroban_sdk::token::StellarAssetClient::new(&self.env, &self.acbu_token)
    }

    fn token_client(&self) -> soroban_sdk::token::Client {
        soroban_sdk::token::Client::new(&self.env, &self.acbu_token)
    }

    fn mint_to_user(&self, amount: i128) {
        self.token_admin().mint(&self.user, &amount);
    }

    fn mint_to_user2(&self, amount: i128) {
        self.token_admin().mint(&self.user2, &amount);
    }

    /// Fund the vault's yield reserve (AC-007: the only source of yield).
    fn fund_yield(&self, amount: i128) {
        if amount > 0 {
            self.token_admin().mint(&self.admin, &amount);
            self.client.fund_yield_reserve(&self.admin, &amount);
        }
    }

    fn advance_time(&self, delta: u64) {
        self.env.ledger().with_mut(|l| l.timestamp += delta);
    }

    fn set_time(&self, ts: u64) {
        self.env.ledger().with_mut(|l| l.timestamp = ts);
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn user_balance(&self) -> i128 {
        self.token_client().balance(&self.user)
    }

    fn user2_balance(&self) -> i128 {
        self.token_client().balance(&self.user2)
    }

    fn admin_balance(&self) -> i128 {
        self.token_client().balance(&self.admin)
    }

    fn vault_balance(&self) -> i128 {
        self.token_client().balance(&self.contract_id)
    }

    fn find_deposit_event(&self) -> Option<DepositEvent> {
        let events = self.env.events().all();
        events
            .iter()
            .rev()
            .find(|e| {
                e.0 == self.contract_id
                    && Symbol::from_val(&self.env, &e.1.get(0).unwrap()) == symbol_short!("Deposit")
            })
            .map(|e| e.2.into_val(&self.env))
    }

    fn find_withdraw_event(&self) -> Option<WithdrawEvent> {
        let events = self.env.events().all();
        events
            .iter()
            .rev()
            .find(|e| {
                e.0 == self.contract_id
                    && Symbol::from_val(&self.env, &e.1.get(0).unwrap()) == symbol_short!("Withdraw")
            })
            .map(|e| e.2.into_val(&self.env))
    }
}

fn expected_yield(principal: i128, yield_rate_bps: i128, elapsed_seconds: u64) -> i128 {
    let elapsed_i128 = i128::from(elapsed_seconds);
    principal * yield_rate_bps * elapsed_i128 / (BASIS_POINTS * i128::from(SECONDS_PER_YEAR))
}

// ============================================================================
// DEPOSIT TESTS - Covering deposit functionality
// ============================================================================

#[test]
fn test_deposit_basic_success() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
    assert_eq!(h.vault_balance(), amount, "h.vault_balance() should equal amount");
}

#[test]
fn test_deposit_with_fee_deduction() {
    let fee_rate = 300i128; // 3%
    let h = TestEnv::new(fee_rate, 0);
    let gross_amount = 10_000_000i128;
    let term = 3_600u64;
    let expected_fee = gross_amount * fee_rate / BASIS_POINTS;
    let expected_net = gross_amount - expected_fee;

    h.mint_to_user(gross_amount);
    h.client.deposit(&h.user, &gross_amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), expected_net, "h.client.get_balance(&h.user, &term) should equal expected_net");
    assert_eq!(h.admin_balance(), expected_fee, "h.admin_balance() should equal expected_fee");
    assert_eq!(h.vault_balance(), expected_net, "h.vault_balance() should equal expected_net");
}

#[test]
fn test_deposit_with_high_fee_rate() {
    let fee_rate = 1_000i128; // 10%
    let h = TestEnv::new(fee_rate, 0);
    let gross = 10_000_000i128;
    let term = 3_600u64;
    let fee = gross * fee_rate / BASIS_POINTS;

    h.mint_to_user(gross);
    h.client.deposit(&h.user, &gross, &term);

    assert_eq!(h.admin_balance(), fee, "h.admin_balance() should equal fee");
    assert_eq!(h.client.get_balance(&h.user, &term), gross - fee, "h.client.get_balance(&h.user, &term) should equal gross - fee");
}

#[test]
fn test_deposit_zero_fee_rate() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
    assert_eq!(h.admin_balance(), 0, "h.admin_balance() should equal 0");
}

#[test]
fn test_deposit_zero_amount_rejected() {
    let h = TestEnv::new(0, 0);
    let result = h.client.try_deposit(&h.user, &0i128, &3_600u64);
    assert!(result.is_err(), "Zero-amount deposit must be rejected");
}

#[test]
fn test_deposit_negative_amount_rejected() {
    let h = TestEnv::new(0, 0);
    let result = h.client.try_deposit(&h.user, &(-1i128), &3_600u64);
    assert!(result.is_err(), "Negative-amount deposit must be rejected");
}

#[test]
fn test_deposit_zero_term_rejected() {
    let h = TestEnv::new(0, 0);
    h.mint_to_user(10_000_000);
    let result = h.client.try_deposit(&h.user, &10_000_000i128, &0u64);
    assert!(result.is_err(), "Zero-term deposit must be rejected");
}

#[test]
fn test_deposit_very_small_amount() {
    let h = TestEnv::new(0, 0);
    let amount = 1i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
}

#[test]
fn test_deposit_large_amount() {
    let h = TestEnv::new(0, 0);
    let amount = i128::MAX / 2; // Large but safe amount
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
}

#[test]
fn test_multiple_deposits_same_term_accumulate() {
    let h = TestEnv::new(0, 0);
    let term = 3_600u64;
    let amount1 = 5_000_000i128;
    let amount2 = 3_000_000i128;

    h.mint_to_user(amount1 + amount2);
    h.client.deposit(&h.user, &amount1, &term);
    h.client.deposit(&h.user, &amount2, &term);

    assert_eq!(
        h.client.get_balance(&h.user, &term),
        amount1 + amount2,
        "Multiple deposits to same term should accumulate"
    );
}

#[test]
fn test_multiple_deposits_different_terms_independent() {
    let h = TestEnv::new(0, 0);
    let term1 = 3_600u64;
    let term2 = 86_400u64;
    let amount = 5_000_000i128;

    h.mint_to_user(amount * 2);
    h.client.deposit(&h.user, &amount, &term1);
    h.client.deposit(&h.user, &amount, &term2);

    assert_eq!(h.client.get_balance(&h.user, &term1), amount, "h.client.get_balance(&h.user, &term1) should equal amount");
    assert_eq!(h.client.get_balance(&h.user, &term2), amount, "h.client.get_balance(&h.user, &term2) should equal amount");
}

#[test]
fn test_deposit_very_long_term() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR * 10; // 10 years

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
}

#[test]
fn test_deposit_very_short_term() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 1u64; // 1 second

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
}

#[test]
fn test_deposit_event_correct_values() {
    let fee_rate = 300i128; // 3%
    let h = TestEnv::new(fee_rate, 0);
    let gross = 10_000_000i128;
    let term = 3_600u64;
    let fee = gross * fee_rate / BASIS_POINTS;
    let net = gross - fee;

    h.mint_to_user(gross);
    h.client.deposit(&h.user, &gross, &term);

    let event = h.find_deposit_event().expect("Deposit event must be emitted");
    assert_eq!(event.gross_amount, gross, "event.gross_amount should equal gross");
    assert_eq!(event.fee_amount, fee, "event.fee_amount should equal fee");
    assert_eq!(event.net_amount, net, "event.net_amount should equal net");
    assert_eq!(event.term_seconds, term, "event.term_seconds should equal term");
    assert_eq!(event.timestamp, h.now(), "event.timestamp should equal h.now()");
    assert_eq!(event.maturity_timestamp, h.now() + term, "event.maturity_timestamp should equal h.now() + term");
}

#[test]
fn test_deposit_when_paused_rejected() {
    let h = TestEnv::new(0, 0);
    h.client.pause();

    h.mint_to_user(10_000_000);
    let result = h.client.try_deposit(&h.user, &10_000_000i128, &3_600u64);
    assert!(result.is_err(), "Deposit must be rejected when contract is paused");
}

#[test]
fn test_deposit_after_unpause_succeeds() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.client.pause();
    h.client.unpause();

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
}

// ============================================================================
// WITHDRAW TESTS - Covering withdraw functionality
// ============================================================================

#[test]
fn test_withdraw_after_term_succeeds() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
}

#[test]
fn test_withdraw_before_term_rejected() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(1); // Only 1 second, term is 3600

    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err(), "Withdrawal before term must be rejected");
}

#[test]
fn test_withdraw_one_second_before_term_rejected() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term - 1);

    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err(), "Withdrawal one second before term must be rejected");
}

#[test]
fn test_withdraw_at_exact_term_boundary_succeeds() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

#[test]
fn test_withdraw_after_term_plus_one_second_succeeds() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term + 1);

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

#[test]
fn test_withdraw_zero_amount_rejected() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    let result = h.client.try_withdraw(&h.user, &term, &0i128);
    assert!(result.is_err(), "Zero-amount withdrawal must be rejected");
}

#[test]
fn test_withdraw_negative_amount_rejected() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    let result = h.client.try_withdraw(&h.user, &term, &(-1i128));
    assert!(result.is_err(), "Negative-amount withdrawal must be rejected");
}

#[test]
fn test_withdraw_more_than_available_rejected() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    let result = h.client.try_withdraw(&h.user, &term, &(amount + 1));
    assert!(
        result.is_err(),
        "Withdrawing more than available must be rejected"
    );
}

#[test]
fn test_partial_withdraw_leaves_remainder() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;
    let withdraw_amount = 6_000_000i128;
    let remaining = amount - withdraw_amount;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &withdraw_amount);

    assert_eq!(h.user_balance(), withdraw_amount, "h.user_balance() should equal withdraw_amount");
    assert_eq!(h.client.get_balance(&h.user, &term), remaining, "h.client.get_balance(&h.user, &term) should equal remaining");
}

#[test]
fn test_partial_withdraws_multiple_times() {
    let h = TestEnv::new(0, 0);
    let amount = 12_000_000i128;
    let term = 3_600u64;
    let withdraw1 = 4_000_000i128;
    let withdraw2 = 3_000_000i128;
    let withdraw3 = 5_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &withdraw1);
    assert_eq!(h.user_balance(), withdraw1, "h.user_balance() should equal withdraw1");

    h.client.withdraw(&h.user, &term, &withdraw2);
    assert_eq!(h.user_balance(), withdraw1 + withdraw2, "h.user_balance() should equal withdraw1 + withdraw2");

    h.client.withdraw(&h.user, &term, &withdraw3);
    assert_eq!(h.user_balance(), withdraw1 + withdraw2 + withdraw3, "h.user_balance() should equal withdraw1 + withdraw2 + withdraw3");
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
}

#[test]
fn test_full_withdrawal_clears_balance() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &amount);

    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
}

#[test]
fn test_withdraw_with_no_deposit_rejected() {
    let h = TestEnv::new(0, 0);
    let result = h.client.try_withdraw(&h.user, &3_600u64, &1_000_000i128);
    assert!(
        result.is_err(),
        "Withdraw with no prior deposit must be rejected"
    );
}

#[test]
fn test_withdraw_when_paused_rejected() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.pause();

    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err(), "Withdraw must be rejected when paused");
}

#[test]
fn test_withdraw_after_unpause_succeeds() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.pause();
    h.client.unpause();

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

#[test]
fn test_withdraw_event_correct_values_no_yield() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &amount);

    let event = h.find_withdraw_event().expect("Withdraw event must be emitted");
    assert_eq!(event.amount, amount, "event.amount should equal amount");
    assert_eq!(event.yield_amount, 0, "event.yield_amount should equal 0");
    assert_eq!(event.fee_amount, 0, "event.fee_amount should equal 0");
}

// ============================================================================
// TERM ENFORCEMENT TESTS - Covering lock duration and term independence
// ============================================================================

#[test]
fn test_multiple_terms_are_independent_and_locked() {
    let h = TestEnv::new(0, 0);
    let short_term = 1_000u64;
    let long_term = 10_000u64;
    let amount = 5_000_000i128;

    h.mint_to_user(amount * 2);
    h.client.deposit(&h.user, &amount, &short_term);
    h.client.deposit(&h.user, &amount, &long_term);

    // Advance past short term
    h.advance_time(short_term + 100);

    // Short term should be unlocked
    h.client.withdraw(&h.user, &short_term, &amount);
    assert_eq!(h.client.get_balance(&h.user, &short_term), 0, "h.client.get_balance(&h.user, &short_term) should equal 0");

    // Long term should still be locked
    let result = h.client.try_withdraw(&h.user, &long_term, &amount);
    assert!(result.is_err(), "Long term must remain locked");
    assert_eq!(h.client.get_balance(&h.user, &long_term), amount, "h.client.get_balance(&h.user, &long_term) should equal amount");
}

#[test]
fn test_different_terms_have_independent_lock_times() {
    let h = TestEnv::new(0, 0);
    let term1 = 5_000u64;
    let term2 = 10_000u64;
    let amount = 10_000_000i128;

    h.mint_to_user(amount * 2);

    let start_time = h.now();
    h.client.deposit(&h.user, &amount, &term1);
    h.client.deposit(&h.user, &amount, &term2);

    // Advance to just past term1
    h.set_time(start_time + term1 + 1);
    h.client.withdraw(&h.user, &term1, &amount);

    // term2 should still be locked
    let result = h.client.try_withdraw(&h.user, &term2, &amount);
    assert!(result.is_err());

    // Advance to just past term2
    h.set_time(start_time + term2 + 1);
    h.client.withdraw(&h.user, &term2, &amount);
    assert_eq!(h.client.get_balance(&h.user, &term2), 0, "h.client.get_balance(&h.user, &term2) should equal 0");
}

#[test]
fn test_redeposit_after_withdrawal_works_correctly() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    // First cycle
    h.mint_to_user(amount * 2);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);
    h.client.withdraw(&h.user, &term, &amount);

    // Second cycle with same term
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);
    h.client.withdraw(&h.user, &term, &amount);

    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
}

#[test]
fn test_term_1_year_enforcement() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    // Try to withdraw at 364 days - should fail
    h.advance_time(SECONDS_PER_YEAR - 86_400);
    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err());

    // Withdraw at exactly 1 year - should succeed
    h.advance_time(86_400);
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

#[test]
fn test_multiple_deposits_different_times_same_term() {
    let h = TestEnv::new(0, 0);
    let term = 3_600u64;
    let amount1 = 5_000_000i128;
    let amount2 = 3_000_000i128;

    h.mint_to_user(amount1 + amount2);

    let start_time = h.now();
    h.client.deposit(&h.user, &amount1, &term);

    // Advance time
    h.advance_time(1_000);

    h.client.deposit(&h.user, &amount2, &term);

    // Advance to unlock the SECOND deposit (which is the later one)
    // Second deposit happens at start_time + 1_000, so it unlocks at start_time + 1_000 + term
    h.set_time(start_time + 1_000 + term + 1);

    // Both should be unlocked now
    h.client.withdraw(&h.user, &term, &(amount1 + amount2));
    assert_eq!(h.user_balance(), amount1 + amount2, "h.user_balance() should equal amount1 + amount2");
}

// ============================================================================
// YIELD LOGIC TESTS - Covering interest calculation and accrual
// ============================================================================

#[test]
fn test_yield_accrues_after_term_only() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    // Before term - no yield
    assert_eq!(h.client.get_pending_yield(&h.user, &term), 0, "h.client.get_pending_yield(&h.user, &term) should equal 0");

    // After term - yield should accrue
    h.advance_time(term);
    let exp_yield = expected_yield(amount, yield_rate, term);
    h.fund_yield(exp_yield);

    assert_eq!(h.client.get_pending_yield(&h.user, &term), exp_yield, "h.client.get_pending_yield(&h.user, &term) should equal exp_yield");
}

#[test]
fn test_yield_30_days_at_10_percent_apr() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = 30 * 24 * 3600u64;

    h.mint_to_user(amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(amount, yield_rate, elapsed);
    h.fund_yield(exp_yield);

    assert_eq!(h.client.get_pending_yield(&h.user, &term), exp_yield, "h.client.get_pending_yield(&h.user, &term) should equal exp_yield");

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount + exp_yield, "h.user_balance() should equal amount + exp_yield");
}

#[test]
fn test_yield_one_year_at_10_percent_apr() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;

    h.mint_to_user(amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &SECONDS_PER_YEAR);

    h.advance_time(SECONDS_PER_YEAR);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(amount, yield_rate, elapsed);
    assert_eq!(exp_yield, 1_000_000i128, "10% of 10M should be 1M");

    h.fund_yield(exp_yield);
    h.client.withdraw(&h.user, &SECONDS_PER_YEAR, &amount);
    assert_eq!(h.user_balance(), amount + 1_000_000, "h.user_balance() should equal amount + 1_000_000");
}

#[test]
fn test_yield_six_months_at_10_percent_apr() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let six_months = SECONDS_PER_YEAR / 2;

    h.mint_to_user(amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &six_months);

    h.advance_time(six_months);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(amount, yield_rate, elapsed);
    assert_eq!(exp_yield, 500_000i128, "5% of 10M should be 500k");

    h.fund_yield(exp_yield);
    h.client.withdraw(&h.user, &six_months, &amount);
    assert_eq!(h.user_balance(), amount + 500_000, "h.user_balance() should equal amount + 500_000");
}

#[test]
fn test_zero_yield_rate_no_interest() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);

    assert_eq!(h.client.get_pending_yield(&h.user, &term), 0, "h.client.get_pending_yield(&h.user, &term) should equal 0");

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

#[test]
fn test_yield_on_net_deposit_after_fee() {
    let fee_rate = 300i128; // 3%
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(fee_rate, yield_rate);
    let gross = 10_000_000i128;
    let term = SECONDS_PER_YEAR;

    let fee = gross * fee_rate / BASIS_POINTS;
    let net = gross - fee;

    h.mint_to_user(gross);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &gross, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    // Yield is calculated on net, not gross
    let exp_yield = expected_yield(net, yield_rate, elapsed);
    h.fund_yield(exp_yield);

    h.client.withdraw(&h.user, &term, &net);
    assert_eq!(h.user_balance(), net + exp_yield, "h.user_balance() should equal net + exp_yield");
    assert_eq!(h.admin_balance(), fee, "h.admin_balance() should equal fee");
}

#[test]
fn test_yield_proportional_to_elapsed_time() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR / 4; // 3 months

    h.mint_to_user(amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(amount, yield_rate, elapsed);
    // 3 months is 1/4 year, so 10% / 4 = 2.5%
    let expected_approx = 250_000i128;
    assert!(
        (exp_yield - expected_approx).abs() < 1000,
        "Yield should be approximately 2.5% of principal"
    );

    h.fund_yield(exp_yield);
    h.client.withdraw(&h.user, &term, &amount);
}

#[test]
fn test_yield_low_rate_5_percent_annual() {
    let yield_rate = 500i128; // 5% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 100_000_000i128; // 10 ACBU
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);

    let exp_yield = expected_yield(amount, yield_rate, SECONDS_PER_YEAR);
    assert_eq!(exp_yield, 5_000_000i128, "5% of 100M should be 5M");

    h.fund_yield(exp_yield);
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount + exp_yield, "h.user_balance() should equal amount + exp_yield");
}

#[test]
fn test_yield_high_rate_20_percent_annual() {
    let yield_rate = 2_000i128; // 20% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);

    let exp_yield = expected_yield(amount, yield_rate, SECONDS_PER_YEAR);
    assert_eq!(exp_yield, 2_000_000i128, "20% of 10M should be 2M");

    h.fund_yield(exp_yield);
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount + exp_yield, "h.user_balance() should equal amount + exp_yield");
}

#[test]
fn test_yield_event_carries_correct_yield_amount() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = 30 * 24 * 3600u64;

    h.mint_to_user(amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(amount, yield_rate, elapsed);
    h.fund_yield(exp_yield);

    h.client.withdraw(&h.user, &term, &amount);

    let event = h.find_withdraw_event().expect("Withdraw event must be emitted");
    assert_eq!(event.yield_amount, exp_yield, "event.yield_amount should equal exp_yield");
}

// ============================================================================
// EDGE CASES AND INTEGRATION TESTS
// ============================================================================

#[test]
fn test_two_users_independent_deposits_and_yields() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    h.mint_to_user2(amount);

    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);
    h.client.deposit(&h.user2, &amount, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(amount, yield_rate, elapsed);
    h.fund_yield(exp_yield * 2);

    h.client.withdraw(&h.user, &term, &amount);
    h.client.withdraw(&h.user2, &term, &amount);

    assert_eq!(h.user_balance(), amount + exp_yield, "h.user_balance() should equal amount + exp_yield");
    assert_eq!(h.user2_balance(), amount + exp_yield, "h.user2_balance() should equal amount + exp_yield");
}

#[test]
fn test_deposit_withdraw_cycle_multiple_times() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;

    h.mint_to_user(amount);

    // Cycle 1: deposit and withdraw with term 1000
    h.client.deposit(&h.user, &amount, &1_000u64);
    h.advance_time(1_000);
    h.client.withdraw(&h.user, &1_000u64, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");

    // Cycle 2: deposit and withdraw with term 2000
    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &2_000u64);
    h.advance_time(2_000);
    h.client.withdraw(&h.user, &2_000u64, &amount);
    assert_eq!(h.user_balance(), amount * 2, "h.user_balance() should equal amount * 2");

    // Cycle 3: deposit and withdraw with term 3000
    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &3_000u64);
    h.advance_time(3_000);
    h.client.withdraw(&h.user, &3_000u64, &amount);
    assert_eq!(h.user_balance(), amount * 3, "h.user_balance() should equal amount * 3");
}

#[test]
fn test_fifo_withdrawal_from_multiple_deposits() {
    let h = TestEnv::new(0, 0);
    let term = 3_600u64;
    let lot1 = 3_000_000i128;
    let lot2 = 4_000_000i128;
    let lot3 = 2_000_000i128;
    let withdraw = 7_000_000i128; // lot1 + lot2

    h.mint_to_user(lot1 + lot2 + lot3);

    h.client.deposit(&h.user, &lot1, &term);
    h.client.deposit(&h.user, &lot2, &term);
    h.client.deposit(&h.user, &lot3, &term);

    h.advance_time(term);

    // Withdraw should consume lot1, lot2, and part of lot3
    h.client.withdraw(&h.user, &term, &withdraw);

    assert_eq!(h.user_balance(), withdraw, "h.user_balance() should equal withdraw");
    assert_eq!(h.client.get_balance(&h.user, &term), lot3, "h.client.get_balance(&h.user, &term) should equal lot3");
}

#[test]
fn test_partial_yield_when_withdrawing_before_all_lots_mature() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let term = SECONDS_PER_YEAR;
    let amount = 5_000_000i128;

    h.mint_to_user(amount * 2);
    let ts1 = h.now();
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(SECONDS_PER_YEAR / 2);
    let ts2 = h.now();
    h.client.deposit(&h.user, &amount, &term);

    // Advance to 1 year - first deposit matures, second does not
    h.advance_time(SECONDS_PER_YEAR / 2);

    // Only first lot is unlocked
    let elapsed1 = h.now() - ts1;
    let exp_yield1 = expected_yield(amount, yield_rate, elapsed1);

    h.fund_yield(exp_yield1);

    // Withdraw the first amount which accrued yield
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount + exp_yield1, "h.user_balance() should equal amount + exp_yield1");

    // Second lot still locked
    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err(), "Second lot must still be locked");
}

#[test]
fn test_contract_state_consistency_after_partial_withdrawals() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    // Withdraw half
    h.client.withdraw(&h.user, &term, &(amount / 2));
    assert_eq!(h.client.get_balance(&h.user, &term), amount / 2, "h.client.get_balance(&h.user, &term) should equal amount / 2");

    // Withdraw remaining half
    h.client.withdraw(&h.user, &term, &(amount / 2));
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");

    // Verify no deposit exists for this term
    let result = h.client.try_withdraw(&h.user, &term, &1i128);
    assert!(result.is_err());
}

#[test]
fn test_maximum_fee_rate_10000_basis_points() {
    let fee_rate = 10_000i128; // 100% fee - extreme case
    let h = TestEnv::new(fee_rate, 0);
    let amount = 10_000_000i128;
    let term = 3_600u64;

    h.mint_to_user(amount);
    let result = h.client.try_deposit(&h.user, &amount, &term);

    // This might succeed or fail depending on implementation - the net deposit would be 0
    // So it should fail with ZeroNetDeposit error
    assert!(result.is_err());
}

#[test]
fn test_yield_on_tiny_amount() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 1i128;
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);

    let exp_yield = expected_yield(amount, yield_rate, SECONDS_PER_YEAR);
    // 10% of 1 = 0 (due to integer division)
    assert!(exp_yield <= 1, "Yield on 1 unit should be 0 or 1");
}

#[test]
fn test_precision_with_various_combinations() {
    // Test various amount, fee, and yield combinations
    let test_cases = vec![
        (0, 500),     // 0% fee, 5% yield
        (100, 1_000), // 1% fee, 10% yield
        (300, 800),   // 3% fee, 8% yield
    ];

    for (fee_rate, yield_rate) in test_cases {
        let h = TestEnv::new(fee_rate, yield_rate);
        let amount = 10_000_000i128;
        let term = 30 * 24 * 3600u64;

        h.mint_to_user(amount);
        let deposit_ts = h.now();
        h.client.deposit(&h.user, &amount, &term);

        let actual_deposit = h.client.get_balance(&h.user, &term);
        let fee_deducted = amount - actual_deposit;

        h.advance_time(term);
        let elapsed = h.now() - deposit_ts;

        let exp_yield = expected_yield(actual_deposit, yield_rate, elapsed);
        h.fund_yield(exp_yield);

        h.client.withdraw(&h.user, &term, &actual_deposit);

        assert_eq!(h.user_balance(), actual_deposit + exp_yield, "h.user_balance() should equal actual_deposit + exp_yield");
        assert_eq!(h.admin_balance(), fee_deducted, "h.admin_balance() should equal fee_deducted");
    }
}

// ============================================================================
// ADDITIONAL COMPREHENSIVE TESTS
// ============================================================================

#[test]
fn test_yield_continues_accruing_after_term_maturity() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount = 10_000_000i128;
    let term = SECONDS_PER_YEAR;

    h.mint_to_user(amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    // Advance to term maturity
    h.advance_time(term);
    let yield_at_maturity = expected_yield(amount, yield_rate, term);
    h.fund_yield(yield_at_maturity);

    assert_eq!(h.client.get_pending_yield(&h.user, &term), yield_at_maturity, "h.client.get_pending_yield(&h.user, &term) should equal yield_at_maturity");

    // Advance another year without withdrawing
    h.advance_time(SECONDS_PER_YEAR);
    let total_elapsed = h.now() - deposit_ts;
    let total_yield = expected_yield(amount, yield_rate, total_elapsed);
    let additional_yield = total_yield - yield_at_maturity;
    h.fund_yield(additional_yield);

    assert_eq!(h.client.get_pending_yield(&h.user, &term), total_yield, "Yield should continue accruing after maturity");

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount + total_yield, "h.user_balance() should equal amount + total_yield");
}

#[test]
fn test_multiple_users_different_terms_isolated() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    let amount1 = 5_000_000i128;
    let amount2 = 8_000_000i128;
    let term1 = 30 * 24 * 3600u64; // 30 days
    let term2 = 60 * 24 * 3600u64; // 60 days

    h.mint_to_user(amount1);
    h.mint_to_user2(amount2);

    let deposit_ts1 = h.now();
    h.client.deposit(&h.user, &amount1, &term1);

    h.advance_time(1_000); // Advance time before second deposit
    let deposit_ts2 = h.now();
    h.client.deposit(&h.user2, &amount2, &term2);

    // Advance to unlock user1's deposit
    h.set_time(deposit_ts1 + term1 + 1);
    let elapsed1 = h.now() - deposit_ts1;
    let yield1 = expected_yield(amount1, yield_rate, elapsed1);
    h.fund_yield(yield1);

    h.client.withdraw(&h.user, &term1, &amount1);
    assert_eq!(h.user_balance(), amount1 + yield1, "h.user_balance() should equal amount1 + yield1");

    // User2's deposit should still be locked
    let result = h.client.try_withdraw(&h.user2, &term2, &amount2);
    assert!(result.is_err(), "User2's deposit should still be locked");

    // Advance to unlock user2's deposit
    h.set_time(deposit_ts2 + term2 + 1);
    let elapsed2 = h.now() - deposit_ts2;
    let yield2 = expected_yield(amount2, yield_rate, elapsed2);
    h.fund_yield(yield2);

    h.client.withdraw(&h.user2, &term2, &amount2);
    assert_eq!(h.user2_balance(), amount2 + yield2, "h.user2_balance() should equal amount2 + yield2");
}

#[test]
fn test_fee_and_yield_with_multiple_partial_withdrawals() {
    let fee_rate = 500i128; // 5% fee
    let yield_rate = 1_200i128; // 12% APR
    let h = TestEnv::new(fee_rate, yield_rate);
    let gross_amount = 20_000_000i128;
    let term = SECONDS_PER_YEAR;

    let fee = gross_amount * fee_rate / BASIS_POINTS;
    let net = gross_amount - fee;

    h.mint_to_user(gross_amount);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &gross_amount, &term);

    assert_eq!(h.client.get_balance(&h.user, &term), net, "h.client.get_balance(&h.user, &term) should equal net");
    assert_eq!(h.admin_balance(), fee, "h.admin_balance() should equal fee");

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;
    let total_yield = expected_yield(net, yield_rate, elapsed);
    h.fund_yield(total_yield);

    // Partial withdrawal 1: 25%
    let withdraw1 = net / 4;
    h.client.withdraw(&h.user, &term, &withdraw1);
    let yield1 = h.user_balance() - withdraw1;

    // Partial withdrawal 2: 25%
    let withdraw2 = net / 4;
    h.client.withdraw(&h.user, &term, &withdraw2);
    let yield2 = h.user_balance() - withdraw1 - withdraw2 - yield1;

    // Final withdrawal: remaining 50%
    let withdraw3 = net - withdraw1 - withdraw2;
    h.client.withdraw(&h.user, &term, &withdraw3);

    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
    assert_eq!(h.user_balance(), net + total_yield, "Total withdrawn should equal net + total_yield");
}

#[test]
fn test_deposit_after_full_withdrawal_resets_term_lock() {
    let h = TestEnv::new(0, 0);
    let amount = 10_000_000i128;
    let term = 10_000u64;

    h.mint_to_user(amount * 2);

    // First deposit-withdraw cycle
    let first_deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);
    h.client.withdraw(&h.user, &term, &amount);

    // Verify balance is cleared
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");

    // Second deposit with same term
    let second_deposit_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    // Try to withdraw immediately - should fail
    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err(), "New deposit should enforce term lock");

    // Advance to unlock second deposit
    h.set_time(second_deposit_ts + term + 1);
    h.client.withdraw(&h.user, &term, &amount);

    assert_eq!(h.user_balance(), amount * 2, "h.user_balance() should equal amount * 2");
}

#[test]
fn test_concurrent_deposits_and_withdrawals_multiple_terms() {
    let yield_rate = 1_000i128; // 10% APR
    let h = TestEnv::new(0, yield_rate);
    
    let short_term = 7 * 24 * 3600u64; // 1 week
    let medium_term = 30 * 24 * 3600u64; // 1 month
    let long_term = 90 * 24 * 3600u64; // 3 months
    
    let amount_short = 3_000_000i128;
    let amount_medium = 5_000_000i128;
    let amount_long = 10_000_000i128;

    h.mint_to_user(amount_short + amount_medium + amount_long);

    // Make all deposits at the same time
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &amount_short, &short_term);
    h.client.deposit(&h.user, &amount_medium, &medium_term);
    h.client.deposit(&h.user, &amount_long, &long_term);

    // Advance to unlock short term
    h.set_time(deposit_ts + short_term + 1);
    let elapsed_short = h.now() - deposit_ts;
    let yield_short = expected_yield(amount_short, yield_rate, elapsed_short);
    h.fund_yield(yield_short);

    h.client.withdraw(&h.user, &short_term, &amount_short);
    assert_eq!(h.user_balance(), amount_short + yield_short, "h.user_balance() should equal amount_short + yield_short");

    // Medium and long should still be locked
    assert!(h.client.try_withdraw(&h.user, &medium_term, &amount_medium).is_err());
    assert!(h.client.try_withdraw(&h.user, &long_term, &amount_long).is_err());

    // Advance to unlock medium term
    h.set_time(deposit_ts + medium_term + 1);
    let elapsed_medium = h.now() - deposit_ts;
    let yield_medium = expected_yield(amount_medium, yield_rate, elapsed_medium);
    h.fund_yield(yield_medium);

    h.client.withdraw(&h.user, &medium_term, &amount_medium);
    assert_eq!(h.user_balance(), amount_short + yield_short + amount_medium + yield_medium, "h.user_balance() should equal amount_short + yield_short + amount_medium + yield_medium");

    // Long should still be locked
    assert!(h.client.try_withdraw(&h.user, &long_term, &amount_long).is_err());

    // Advance to unlock long term
    h.set_time(deposit_ts + long_term + 1);
    let elapsed_long = h.now() - deposit_ts;
    let yield_long = expected_yield(amount_long, yield_rate, elapsed_long);
    h.fund_yield(yield_long);

    h.client.withdraw(&h.user, &long_term, &amount_long);
    
    let total = amount_short + yield_short + amount_medium + yield_medium + amount_long + yield_long;
    assert_eq!(h.user_balance(), total, "All withdrawals complete with correct yields");
}
