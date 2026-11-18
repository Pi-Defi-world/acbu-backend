// Integration tests for C-051: savings vault lock + interest
//
// Acceptance check: withdraw before term fails.
//
// This suite uses Soroban's ledger time-manipulation harness to exercise:
//   1.  Withdraw before term → must fail (primary acceptance criterion)
//   2.  Withdraw at exact term boundary → must succeed
//   3.  Withdraw 1 second before term → must fail
//   4.  Interest accrues proportionally to elapsed time
//   5.  Zero yield rate → no interest paid
//   6.  Multiple terms are independent; early term unlock does not unlock a later term
//   7.  Paused contract rejects both deposit and withdraw
//   8.  Deposit with zero amount is rejected
//   9.  Deposit with zero term is rejected
//   10. Full withdrawal clears the stored lots
//   11. Partial withdrawal leaves correct remainder and accrues yield only on consumed lots
//   12. Two users are fully isolated — one user's lock does not affect the other
//   13. Re-deposit after full withdrawal works correctly
//   14. Fee is deducted from gross deposit; net amount is what earns yield
//   15. Withdraw event carries correct yield_amount (regression for C-051 acceptance check)
#![cfg(test)]

use acbu_savings_vault::{SavingsVault, SavingsVaultClient, WithdrawEvent};
use shared::BASIS_POINTS;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, Env, FromVal, IntoVal, Symbol,
};

// ── helpers ──────────────────────────────────────────────────────────────────

const SECONDS_PER_YEAR: u64 = 31_536_000;

/// Compute the expected yield using the same formula as the contract:
///   principal * yield_rate_bps * elapsed_seconds / (BASIS_POINTS * SECONDS_PER_YEAR)
fn expected_yield(principal: i128, yield_rate_bps: i128, elapsed_seconds: u64) -> i128 {
    let elapsed = i128::from(elapsed_seconds);
    principal * yield_rate_bps * elapsed / (BASIS_POINTS * i128::from(SECONDS_PER_YEAR))
}

struct Harness {
    env: Env,
    admin: Address,
    user: Address,
    acbu_token: Address,
    contract_id: Address,
    client: SavingsVaultClient<'static>,
}

impl Harness {
    /// Build a fresh harness with the given fee and yield rates.
    fn new(fee_rate_bps: i128, yield_rate_bps: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let acbu_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let contract_id = env.register_contract(None, SavingsVault);

        // SAFETY: the Env lives for the duration of the test; the lifetime
        // annotation on SavingsVaultClient is conservative.
        let client = SavingsVaultClient::new(
            unsafe { &*(&env as *const Env) },
            &contract_id,
        );

        client.initialize(&admin, &acbu_token, &fee_rate_bps, &yield_rate_bps);

        Self {
            env,
            admin,
            user,
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

    fn mint_to_vault(&self, amount: i128) {
        self.token_admin().mint(&self.contract_id, &amount);
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

    fn admin_balance(&self) -> i128 {
        self.token_client().balance(&self.admin)
    }
}

// ── 1. Primary acceptance criterion: withdraw before term must fail ───────────

/// C-051 acceptance check: a deposit locked for 30 days cannot be withdrawn
/// 1 second after deposit.
#[test]
fn test_withdraw_before_term_fails() {
    let h = Harness::new(0, 0);
    let term: u64 = 30 * 24 * 3600; // 30 days
    let amount = 10_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    // Advance only 1 second — far before the 30-day lock expires.
    h.advance_time(1);

    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(
        result.is_err(),
        "Withdrawal before term must be rejected (C-051 acceptance check)"
    );

    // Principal must still be intact.
    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
}

// ── 2. Withdraw at exact term boundary succeeds ───────────────────────────────

#[test]
fn test_withdraw_at_exact_term_boundary_succeeds() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600; // 1 hour
    let amount = 5_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    // Advance to exactly the term boundary.
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
}

// ── 3. Withdraw 1 second before term boundary fails ───────────────────────────

#[test]
fn test_withdraw_one_second_before_term_fails() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600;
    let amount = 5_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);

    // Advance to term - 1 second.
    h.advance_time(term - 1);

    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(
        result.is_err(),
        "Withdrawal 1 second before term must be rejected"
    );
}

// ── 4. Interest accrues proportionally to elapsed time ───────────────────────

/// Deposit for 30 days at 10% APR; advance exactly 30 days; verify yield.
#[test]
fn test_interest_accrues_proportionally_to_elapsed_time() {
    let yield_rate_bps = 1_000i128; // 10% APR
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = 30 * 24 * 3600;
    let principal = 10_000_000i128;

    h.mint_to_user(principal);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &principal, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(principal, yield_rate_bps, elapsed);
    h.mint_to_vault(exp_yield); // vault needs balance to pay yield

    assert_eq!(h.client.get_pending_yield(&h.user, &term), exp_yield, "h.client.get_pending_yield(&h.user, &term) should equal exp_yield");

    h.client.withdraw(&h.user, &term, &principal);
    assert_eq!(h.user_balance(), principal + exp_yield, "h.user_balance() should equal principal + exp_yield");
}

/// Deposit for 6 months at 10% APR; verify yield is half of annual.
#[test]
fn test_interest_at_six_months_is_half_annual() {
    let yield_rate_bps = 1_000i128; // 10% APR
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = SECONDS_PER_YEAR / 2;
    let principal = 10_000_000i128;

    h.mint_to_user(principal);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &principal, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(principal, yield_rate_bps, elapsed);
    h.mint_to_vault(exp_yield);

    h.client.withdraw(&h.user, &term, &principal);
    assert_eq!(h.user_balance(), principal + exp_yield, "h.user_balance() should equal principal + exp_yield");
}

// ── 5. Zero yield rate → no interest paid ────────────────────────────────────

#[test]
fn test_zero_yield_rate_pays_no_interest() {
    let h = Harness::new(0, 0); // 0% APR
    let term: u64 = SECONDS_PER_YEAR;
    let principal = 10_000_000i128;

    h.mint_to_user(principal);
    h.client.deposit(&h.user, &principal, &term);

    h.advance_time(term);

    assert_eq!(h.client.get_pending_yield(&h.user, &term), 0, "h.client.get_pending_yield(&h.user, &term) should equal 0");

    h.client.withdraw(&h.user, &term, &principal);
    assert_eq!(h.user_balance(), principal, "h.user_balance() should equal principal"); // exactly principal, no yield
}

// ── 6. Multiple terms are independent ────────────────────────────────────────

/// Deposit into a 1-hour term and a 1-day term.
/// After 1 hour only the short term is unlocked; the long term must still be locked.
#[test]
fn test_multiple_terms_are_independent() {
    let h = Harness::new(0, 0);
    let short_term: u64 = 3_600;       // 1 hour
    let long_term: u64 = 86_400;       // 1 day
    let short_amount = 3_000_000i128;
    let long_amount = 7_000_000i128;

    h.mint_to_user(short_amount + long_amount);
    h.client.deposit(&h.user, &short_amount, &short_term);
    h.client.deposit(&h.user, &long_amount, &long_term);

    // Advance to just past the short term.
    h.advance_time(short_term);

    // Short term is unlocked.
    h.client.withdraw(&h.user, &short_term, &short_amount);
    assert_eq!(h.client.get_balance(&h.user, &short_term), 0, "h.client.get_balance(&h.user, &short_term) should equal 0");

    // Long term is still locked.
    let result = h.client.try_withdraw(&h.user, &long_term, &long_amount);
    assert!(
        result.is_err(),
        "Long-term deposit must still be locked after short term elapses"
    );
    assert_eq!(h.client.get_balance(&h.user, &long_term), long_amount, "h.client.get_balance(&h.user, &long_term) should equal long_amount");
}

// ── 7. Paused contract rejects deposit and withdraw ──────────────────────────

#[test]
fn test_paused_contract_rejects_deposit() {
    let h = Harness::new(0, 0);
    h.client.pause();

    h.mint_to_user(10_000_000);
    let result = h.client.try_deposit(&h.user, &10_000_000i128, &3_600u64);
    assert!(result.is_err(), "Deposit must fail when contract is paused");
}

#[test]
fn test_paused_contract_rejects_withdraw() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600;
    let amount = 5_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.pause();

    let result = h.client.try_withdraw(&h.user, &term, &amount);
    assert!(result.is_err(), "Withdraw must fail when contract is paused");
}

#[test]
fn test_unpause_restores_withdraw() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600;
    let amount = 5_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.pause();
    h.client.unpause();

    // Should succeed after unpause.
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

// ── 8. Deposit with zero amount is rejected ───────────────────────────────────

#[test]
fn test_deposit_zero_amount_rejected() {
    let h = Harness::new(0, 0);
    let result = h.client.try_deposit(&h.user, &0i128, &3_600u64);
    assert!(result.is_err(), "Zero-amount deposit must be rejected");
}

// ── 9. Deposit with zero term is rejected ────────────────────────────────────

#[test]
fn test_deposit_zero_term_rejected() {
    let h = Harness::new(0, 0);
    h.mint_to_user(10_000_000);
    let result = h.client.try_deposit(&h.user, &10_000_000i128, &0u64);
    assert!(result.is_err(), "Zero-term deposit must be rejected");
}

// ── 10. Full withdrawal clears stored lots ────────────────────────────────────

#[test]
fn test_full_withdrawal_clears_lots() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600;
    let amount = 8_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    h.client.withdraw(&h.user, &term, &amount);

    // Balance must be zero after full withdrawal.
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "h.client.get_balance(&h.user, &term) should equal 0");
}

// ── 11. Partial withdrawal leaves correct remainder ───────────────────────────

#[test]
fn test_partial_withdrawal_leaves_correct_remainder() {
    let yield_rate_bps = 1_000i128;
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = SECONDS_PER_YEAR;
    let principal = 10_000_000i128;
    let withdraw_amount = 4_000_000i128;
    let remaining = principal - withdraw_amount;

    h.mint_to_user(principal);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &principal, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    // Yield on the consumed portion only.
    let exp_yield = expected_yield(withdraw_amount, yield_rate_bps, elapsed);
    h.mint_to_vault(exp_yield);

    h.client.withdraw(&h.user, &term, &withdraw_amount);

    assert_eq!(h.user_balance(), withdraw_amount + exp_yield, "h.user_balance() should equal withdraw_amount + exp_yield");
    assert_eq!(h.client.get_balance(&h.user, &term), remaining, "h.client.get_balance(&h.user, &term) should equal remaining");
}

// ── 12. Two users are fully isolated ─────────────────────────────────────────

#[test]
fn test_two_users_are_isolated() {
    let h = Harness::new(0, 0);
    let user2 = Address::generate(&h.env);
    let term: u64 = 3_600;
    let amount = 5_000_000i128;

    h.token_admin().mint(&h.user, &amount);
    h.token_admin().mint(&user2, &amount);

    h.client.deposit(&h.user, &amount, &term);
    h.client.deposit(&user2, &amount, &term);

    h.advance_time(term);

    // user2 withdraws first.
    h.client.withdraw(&user2, &term, &amount);
    assert_eq!(
        soroban_sdk::token::Client::new(&h.env, &h.acbu_token).balance(&user2),
        amount
    , "soroban_sdk::token::Client::new(&h.env, &h.acbu_token).balance(&user2) should equal amount");

    // user1's balance is unaffected.
    assert_eq!(h.client.get_balance(&h.user, &term), amount, "h.client.get_balance(&h.user, &term) should equal amount");
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

// ── 13. Re-deposit after full withdrawal works correctly ──────────────────────

#[test]
fn test_redeposit_after_full_withdrawal() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600;
    let amount = 5_000_000i128;

    // First cycle.
    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");

    // Second cycle — re-deposit the same tokens.
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);
    h.client.withdraw(&h.user, &term, &amount);
    assert_eq!(h.user_balance(), amount, "h.user_balance() should equal amount");
}

// ── 14. Fee deducted from gross; net amount earns yield ───────────────────────

#[test]
fn test_fee_deducted_and_net_earns_yield() {
    let fee_rate_bps = 300i128;  // 3%
    let yield_rate_bps = 1_000i128; // 10% APR
    let h = Harness::new(fee_rate_bps, yield_rate_bps);
    let term: u64 = SECONDS_PER_YEAR;
    let gross = 10_000_000i128;
    let fee = gross * fee_rate_bps / BASIS_POINTS;
    let net = gross - fee;

    h.mint_to_user(gross);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &gross, &term);

    // Admin received the fee immediately.
    assert_eq!(h.admin_balance(), fee, "h.admin_balance() should equal fee");

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    // Yield is on net, not gross.
    let exp_yield = expected_yield(net, yield_rate_bps, elapsed);
    h.mint_to_vault(exp_yield);

    h.client.withdraw(&h.user, &term, &net);
    assert_eq!(h.user_balance(), net + exp_yield, "h.user_balance() should equal net + exp_yield");
}

// ── 15. WithdrawEvent carries correct yield_amount ────────────────────────────

/// Regression test for C-051 acceptance check: the WithdrawEvent emitted after
/// a successful withdrawal must carry the correct non-zero yield_amount.
#[test]
fn test_withdraw_event_carries_correct_yield_amount() {
    let yield_rate_bps = 1_000i128; // 10% APR
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = 30 * 24 * 3600; // 30 days
    let principal = 10_000_000i128;

    h.mint_to_user(principal);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &principal, &term);

    h.advance_time(term);
    let elapsed = h.now() - deposit_ts;

    let exp_yield = expected_yield(principal, yield_rate_bps, elapsed);
    h.mint_to_vault(exp_yield);

    h.client.withdraw(&h.user, &term, &principal);

    // Find the Withdraw event and assert yield_amount matches.
    let events = h.env.events().all();
    let withdraw_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == h.contract_id
                && Symbol::from_val(&h.env, &e.1.get(0).unwrap()) == symbol_short!("Withdraw")
        })
        .expect("Withdraw event must be emitted");

    let ev: WithdrawEvent = withdraw_event.2.into_val(&h.env);
    assert_eq!(
        ev.yield_amount, exp_yield,
        "WithdrawEvent.yield_amount must equal the computed yield (C-051 acceptance check)"
    );
    assert_eq!(ev.amount, principal, "ev.amount should equal principal");
    assert_eq!(ev.fee_amount, 0, "ev.fee_amount should equal 0"); // no withdraw fee
}

// ── 16. Withdraw more than deposited is rejected ──────────────────────────────

#[test]
fn test_withdraw_more_than_deposited_is_rejected() {
    let h = Harness::new(0, 0);
    let term: u64 = 3_600;
    let amount = 5_000_000i128;

    h.mint_to_user(amount);
    h.client.deposit(&h.user, &amount, &term);
    h.advance_time(term);

    let result = h.client.try_withdraw(&h.user, &term, &(amount + 1));
    assert!(
        result.is_err(),
        "Withdrawing more than deposited must be rejected"
    );
}

// ── 17. Withdraw with no deposit is rejected ──────────────────────────────────

#[test]
fn test_withdraw_with_no_deposit_is_rejected() {
    let h = Harness::new(0, 0);
    let result = h.client.try_withdraw(&h.user, &3_600u64, &1_000_000i128);
    assert!(
        result.is_err(),
        "Withdraw with no prior deposit must be rejected"
    );
}

// ── 18. Long lock period (1 year) accumulates correct annual yield ─────────────

#[test]
fn test_one_year_lock_accumulates_full_annual_yield() {
    let yield_rate_bps = 500i128; // 5% APR
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = SECONDS_PER_YEAR;
    let principal = 100_000_000i128; // 10 ACBU at 7 decimals

    h.mint_to_user(principal);
    let deposit_ts = h.now();
    h.client.deposit(&h.user, &principal, &term);

    h.advance_time(SECONDS_PER_YEAR);
    let elapsed = h.now() - deposit_ts;

    // 5% of 100_000_000 = 5_000_000
    let exp_yield = expected_yield(principal, yield_rate_bps, elapsed);
    assert_eq!(exp_yield, 5_000_000, "Annual yield must be exactly 5%");

    h.mint_to_vault(exp_yield);
    h.client.withdraw(&h.user, &term, &principal);
    assert_eq!(h.user_balance(), principal + exp_yield, "h.user_balance() should equal principal + exp_yield");
}

// ── 19. Deposit immediately after term expiry still earns yield ───────────────

/// Verify that a second deposit made after the first term has expired earns
/// its own independent yield and does not inherit the first lot's timestamp.
#[test]
fn test_second_deposit_after_first_term_earns_independent_yield() {
    let yield_rate_bps = 1_000i128;
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = 3_600; // 1 hour
    let amount = 5_000_000i128;

    h.mint_to_user(amount * 2);

    // ── Cycle 1 ──────────────────────────────────────────────────────────────
    let deposit1_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);
    let elapsed1 = h.now() - deposit1_ts;
    let exp_yield1 = expected_yield(amount, yield_rate_bps, elapsed1);
    h.mint_to_vault(exp_yield1);

    h.client.withdraw(&h.user, &term, &amount);
    // After cycle 1: user has (amount kept) + (amount returned) + yield1
    //   = amount + amount + yield1 = 10_000_000 + yield1
    assert_eq!(h.client.get_balance(&h.user, &term), 0, "lots must be cleared after full withdrawal");

    // ── Cycle 2 ──────────────────────────────────────────────────────────────
    let deposit2_ts = h.now();
    h.client.deposit(&h.user, &amount, &term);

    h.advance_time(term);
    let elapsed2 = h.now() - deposit2_ts;
    let exp_yield2 = expected_yield(amount, yield_rate_bps, elapsed2);
    h.mint_to_vault(exp_yield2);

    // Verify pending yield matches expectation before withdrawing.
    assert_eq!(
        h.client.get_pending_yield(&h.user, &term),
        exp_yield2,
        "second deposit must accrue its own independent yield"
    );

    h.client.withdraw(&h.user, &term, &amount);

    // Final balance: user started with amount*2, deposited amount twice, got
    // back amount twice, plus yield1 and yield2.
    // = amount*2 + yield1 + yield2
    assert_eq!(h.user_balance(), amount * 2 + exp_yield1 + exp_yield2, "h.user_balance() should equal amount * 2 + exp_yield1 + exp_yield2");
}

// ── 20. get_pending_yield returns 0 before term elapses ───────────────────────

#[test]
fn test_pending_yield_is_zero_before_term() {
    let yield_rate_bps = 1_000i128;
    let h = Harness::new(0, yield_rate_bps);
    let term: u64 = SECONDS_PER_YEAR;
    let principal = 10_000_000i128;

    h.mint_to_user(principal);
    h.client.deposit(&h.user, &principal, &term);

    // No time has passed — yield should be 0.
    assert_eq!(h.client.get_pending_yield(&h.user, &term), 0, "h.client.get_pending_yield(&h.user, &term) should equal 0");
}
