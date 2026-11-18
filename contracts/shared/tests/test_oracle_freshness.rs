#![cfg(test)]

use shared::check_oracle_freshness;
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
