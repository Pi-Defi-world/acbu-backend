#![cfg(test)]

use shared::{check_oracle_freshness, check_oracle_ledger_freshness, STALE_RATE_MAX_LEDGERS};
use soroban_sdk::testutils::Ledger;
use soroban_sdk::Env;

#[test]
fn test_fresh_at_exact_boundary() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 21_600);
    assert!(check_oracle_freshness(&env, 0, 21_600));
}

#[test]
fn test_stale_one_second_past_boundary() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 21_601);
    assert!(!check_oracle_freshness(&env, 0, 21_600));
}

#[test]
fn test_overflow_safe() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = u64::MAX);
    assert!(!check_oracle_freshness(&env, u64::MAX, 21_600));
}

// ── AC-027: ledger-based freshness ──────────────────────────────────────────

#[test]
fn test_ledger_fresh_at_exact_boundary() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.sequence_number = 100 + STALE_RATE_MAX_LEDGERS);
    assert!(check_oracle_ledger_freshness(&env, 100, STALE_RATE_MAX_LEDGERS));
}

#[test]
fn test_ledger_stale_one_ledger_past_boundary() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.sequence_number = 100 + STALE_RATE_MAX_LEDGERS + 1);
    assert!(!check_oracle_ledger_freshness(&env, 100, STALE_RATE_MAX_LEDGERS));
}

#[test]
fn test_ledger_stale_even_when_clock_is_fresh() {
    // Wall clock has not moved, but the network has closed many ledgers: the
    // timestamp check alone would call this rate fresh.
    let env = Env::default();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000;
        l.sequence_number = 100 + STALE_RATE_MAX_LEDGERS + 1;
    });
    assert!(check_oracle_freshness(&env, 1_000, 21_600));
    assert!(!check_oracle_ledger_freshness(&env, 100, STALE_RATE_MAX_LEDGERS));
}

#[test]
fn test_ledger_ahead_of_current_is_fresh() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.sequence_number = 10);
    assert!(check_oracle_ledger_freshness(&env, 50, STALE_RATE_MAX_LEDGERS));
}
