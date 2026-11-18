//! SC-025 — Tests for per-currency configurable emergency threshold and N-of-M
//! consensus requirement during emergency bypasses.
//!
//! Prior to this fix a single validator could bypass the UPDATE_INTERVAL timelock
//! by submitting a rate that deviated more than `EMERGENCY_THRESHOLD_BPS` (5 %) from
//! the stored rate. These tests verify:
//!
//!  1. A single validator cannot bypass the interval alone (needs N-of-M votes).
//!  2. The bypass fires correctly once `min_signatures` validators have cast votes.
//!  3. Per-currency thresholds override the global default.
//!  4. Stale votes are discarded and do not count towards consensus.
//!  5. Duplicate votes from the same validator are replaced (not double-counted).
//!  6. `set_emergency_threshold` and `get_emergency_threshold` behave correctly.
//!  7. `set_min_signatures` updates the quorum and clears stale votes.
//!  8. Normal (non-emergency) rate updates are unaffected.
//!  9. Per-currency vote buckets are independent.

#![cfg(test)]

use acbu_oracle::{OracleContract, OracleContractClient};
use shared::CurrencyCode;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Map, Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Standard update interval used by the oracle (6 h).
const UPDATE_INTERVAL: u64 = 21_600;
/// Emergency vote TTL (1 h).
const EMERGENCY_VOTE_TTL: u64 = 3_600;

fn make_ledger(timestamp: u64, seq: u32) -> LedgerInfo {
    LedgerInfo {
        timestamp,
        protocol_version: 20,
        sequence_number: seq,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    }
}

fn make_env() -> Env {
    let env = Env::default();
    env.ledger().set(make_ledger(1_000_000, 100));
    env
}

fn advance_time(env: &Env, delta: u64) {
    let now = env.ledger().timestamp();
    let seq = env.ledger().sequence();
    env.ledger().set(make_ledger(now + delta, seq + 1));
}

fn single_source(env: &Env, rate: i128) -> Vec<i128> {
    let mut v = Vec::new(env);
    v.push_back(rate);
    v
}

/// Initialise an oracle with N validators and min_signatures = `min_sigs`.
fn setup_with(
    n_validators: usize,
    min_sigs: u32,
) -> (
    Env,
    Address,
    Vec<Address>,
    CurrencyCode,
    OracleContractClient<'static>,
) {
    let env = make_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let mut validators = Vec::new(&env);
    for _ in 0..n_validators {
        validators.push_back(Address::generate(&env));
    }

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut weights: Map<CurrencyCode, i128> = Map::new(&env);
    weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &min_sigs, &currencies, &weights);

    (env, admin, validators, ngn, client)
}

/// Write an initial rate via a single validator source (no interval check needed
/// for the first ever write).
fn seed_rate(
    env: &Env,
    client: &OracleContractClient,
    validator: &Address,
    currency: &CurrencyCode,
    rate: i128,
) {
    client.update_rate(validator, currency, &rate, &single_source(env, rate), &0u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Single validator cannot bypass without N-of-M votes
// ─────────────────────────────────────────────────────────────────────────────

/// Without any prior `cast_emergency_vote` calls, submitting an emergency-magnitude
/// rate within the interval falls through to `UpdateIntervalNotMet` (#7008).
#[test]
#[should_panic(expected = "#7008")]
fn test_single_validator_cannot_bypass_alone_no_votes() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    // 10% deviation but zero votes cast — should fall through to interval check.
    let emergency_rate = 1_100_000i128;
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
}

/// With only 1 vote cast but min_sigs = 2, the bypass is not granted.
#[test]
#[should_panic(expected = "#7008")]
fn test_one_vote_insufficient_for_bypass() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_100_000i128;
    // Cast only 1 vote (v0).
    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    assert_eq!(client.get_emergency_vote_count(&ngn), 1u32);

    // Attempting the rate update without full consensus fails.
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
}

/// With min_signatures = 1, a single vote is sufficient to bypass (degenerate case).
#[test]
fn test_single_validator_can_bypass_with_min_1() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 1);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_100_000i128;
    // Cast one vote and immediately update.
    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
    assert_eq!(client.get_rate(&ngn), emergency_rate);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. N-of-M consensus grants the bypass
// ─────────────────────────────────────────────────────────────────────────────

/// Two validators cast votes → consensus reached → bypass fires.
#[test]
fn test_two_of_three_consensus_grants_bypass() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();
    let v1 = validators.get(1).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_200_000i128; // 20% deviation

    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    assert_eq!(client.get_emergency_vote_count(&ngn), 1u32, "should have 1 vote");

    client.cast_emergency_vote(&v1, &ngn, &emergency_rate);
    assert_eq!(client.get_emergency_vote_count(&ngn), 2u32, "should have 2 votes");

    // Bypass granted — only one validator needs to call update_rate to commit.
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
    assert_eq!(client.get_rate(&ngn), emergency_rate);

    // After the bypass, votes are consumed.
    assert_eq!(client.get_emergency_vote_count(&ngn), 0u32, "votes should be cleared after bypass");
}

/// Three-of-five: bypass fires only after the third vote.
#[test]
fn test_three_of_five_consensus_grants_bypass() {
    let (env, _admin, validators, ngn, client) = setup_with(5, 3);
    let v0 = validators.get(0).unwrap();
    let v1 = validators.get(1).unwrap();
    let v2 = validators.get(2).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_300_000i128; // 30% deviation

    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    client.cast_emergency_vote(&v1, &ngn, &emergency_rate);

    // 2 votes, need 3 — bypass not yet available.
    assert!(
        client
            .try_update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64)
            .is_err(),
        "2 votes insufficient for 3-of-5"
    );

    client.cast_emergency_vote(&v2, &ngn, &emergency_rate);

    // 3 votes — bypass fires.
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
    assert_eq!(client.get_rate(&ngn), emergency_rate);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Stale vote expiry
// ─────────────────────────────────────────────────────────────────────────────

/// Votes older than the vote TTL are not counted toward consensus.
#[test]
#[should_panic(expected = "#7008")]
fn test_expired_votes_do_not_count() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();
    let v1 = validators.get(1).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_200_000i128;

    // v0 casts a vote that will later expire.
    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    assert_eq!(client.get_emergency_vote_count(&ngn), 1u32);

    // More than 1 h passes — v0's vote expires.
    advance_time(&env, EMERGENCY_VOTE_TTL + 1);

    // v1 casts a vote, but v0's is stale → only 1 live vote → insufficient.
    client.cast_emergency_vote(&v1, &ngn, &emergency_rate);
    assert_eq!(client.get_emergency_vote_count(&ngn), 1u32, "expired vote not counted");

    // Attempting bypass with only 1 live vote fails.
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Duplicate votes do not double-count
// ─────────────────────────────────────────────────────────────────────────────

/// The same validator calling `cast_emergency_vote` twice counts as 1 vote.
#[test]
fn test_duplicate_vote_does_not_increase_count() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_200_000i128;

    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    client.cast_emergency_vote(&v0, &ngn, &emergency_rate); // duplicate
    assert_eq!(
        client.get_emergency_vote_count(&ngn),
        1u32,
        "duplicate vote must not count twice"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Per-currency threshold configuration
// ─────────────────────────────────────────────────────────────────────────────

/// Default threshold is 500 bps (5%).
#[test]
fn test_default_threshold_is_500bps() {
    let (_env, _admin, _validators, ngn, client) = setup_with(3, 2);
    assert_eq!(client.get_emergency_threshold(&ngn), 500i128);
}

/// `set_emergency_threshold` persists and `get_emergency_threshold` reads it back.
#[test]
fn test_set_and_get_emergency_threshold() {
    let (_env, _admin, _validators, ngn, client) = setup_with(3, 2);
    client.set_emergency_threshold(&ngn, &1_000i128);
    assert_eq!(client.get_emergency_threshold(&ngn), 1_000i128);
}

/// Passing 0 to `set_emergency_threshold` resets to the global default (500 bps).
#[test]
fn test_set_threshold_zero_resets_to_default() {
    let (_env, _admin, _validators, ngn, client) = setup_with(3, 2);
    client.set_emergency_threshold(&ngn, &1_500i128);
    client.set_emergency_threshold(&ngn, &0i128);
    assert_eq!(client.get_emergency_threshold(&ngn), 500i128);
}

/// A stricter per-currency threshold (1000 bps / 10%) means a 6% deviation is
/// NOT an emergency — the update is blocked by the interval lock without votes.
#[test]
#[should_panic(expected = "#7008")]
fn test_stricter_threshold_blocks_6pct_deviation() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    client.set_emergency_threshold(&ngn, &1_000i128); // 10% threshold
    advance_time(&env, UPDATE_INTERVAL / 2);

    // 6% deviation — below 10% threshold → normal interval check fires.
    let rate_6pct = 1_060_000i128;
    client.update_rate(&v0, &ngn, &rate_6pct, &single_source(&env, rate_6pct), &0u64);
}

/// A permissive per-currency threshold (200 bps / 2%) means a 3% deviation triggers
/// the emergency vote path. Without sufficient votes, bypass is not granted.
#[test]
#[should_panic(expected = "#7008")]
fn test_permissive_threshold_needs_votes_for_3pct_deviation() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    client.set_emergency_threshold(&ngn, &200i128); // 2% threshold
    advance_time(&env, UPDATE_INTERVAL / 2);

    // 3% deviation (300 bps) exceeds the 2% threshold — emergency path — but no votes.
    let rate_3pct = 1_030_000i128;
    client.update_rate(&v0, &ngn, &rate_3pct, &single_source(&env, rate_3pct), &0u64);
}

/// With a permissive threshold (2%), N-of-M votes on a 3% move allow the bypass.
#[test]
fn test_permissive_threshold_2_votes_allow_3pct_bypass() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();
    let v1 = validators.get(1).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    client.set_emergency_threshold(&ngn, &200i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let rate_3pct = 1_030_000i128;
    client.cast_emergency_vote(&v0, &ngn, &rate_3pct);
    client.cast_emergency_vote(&v1, &ngn, &rate_3pct);

    client.update_rate(&v0, &ngn, &rate_3pct, &single_source(&env, rate_3pct), &0u64);
    assert_eq!(client.get_rate(&ngn), rate_3pct);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. set_min_signatures
// ─────────────────────────────────────────────────────────────────────────────

/// After `set_min_signatures`, the new quorum is respected and pending votes
/// accumulated under the old quorum are cleared.
#[test]
fn test_set_min_signatures_clears_pending_votes() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 3);
    let v0 = validators.get(0).unwrap();
    let v1 = validators.get(1).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emergency_rate = 1_200_000i128;

    // Two votes cast under quorum = 3.
    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    client.cast_emergency_vote(&v1, &ngn, &emergency_rate);
    assert_eq!(client.get_emergency_vote_count(&ngn), 2u32);

    // Admin lowers quorum to 2 — pending votes must be cleared.
    client.set_min_signatures(&2u32);
    assert_eq!(client.get_min_signatures(), 2u32);
    assert_eq!(client.get_emergency_vote_count(&ngn), 0u32, "set_min_signatures must clear pending votes");

    // v0 needs to re-cast (still 1 vote), bypass not available yet.
    client.cast_emergency_vote(&v0, &ngn, &emergency_rate);
    assert!(
        client
            .try_update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64)
            .is_err(),
        "1 vote not enough for quorum 2"
    );

    // v1 re-casts — now 2 votes, consensus with new quorum = 2.
    client.cast_emergency_vote(&v1, &ngn, &emergency_rate);
    client.update_rate(&v0, &ngn, &emergency_rate, &single_source(&env, emergency_rate), &0u64);
    assert_eq!(client.get_rate(&ngn), emergency_rate);
}

/// `set_min_signatures` with 0 panics with InvalidMinSignatures (#7002).
#[test]
#[should_panic(expected = "#7002")]
fn test_set_min_signatures_zero_panics() {
    let (_env, _admin, _validators, _ngn, client) = setup_with(3, 2);
    client.set_min_signatures(&0u32);
}

/// `set_min_signatures` exceeding the validator count panics with #7002.
#[test]
#[should_panic(expected = "#7002")]
fn test_set_min_signatures_exceeds_count_panics() {
    let (_env, _admin, validators, _ngn, client) = setup_with(3, 2);
    client.set_min_signatures(&(validators.len() + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Normal updates are unaffected
// ─────────────────────────────────────────────────────────────────────────────

/// After the full update interval, any rate change works without votes.
#[test]
fn test_normal_update_after_interval_succeeds() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL + 1);

    let new_rate = 1_010_000i128; // 1% move
    client.update_rate(&v0, &ngn, &new_rate, &single_source(&env, new_rate), &0u64);
    assert_eq!(client.get_rate(&ngn), new_rate);
}

/// A large move (>5%) after the interval passes is not an emergency — no votes needed.
#[test]
fn test_large_move_after_interval_is_normal() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL + 1);

    let new_rate = 1_200_000i128; // 20% move — interval already passed
    client.update_rate(&v0, &ngn, &new_rate, &single_source(&env, new_rate), &0u64);
    assert_eq!(client.get_rate(&ngn), new_rate);
}

/// First-ever rate write for a currency is never subject to emergency checks.
#[test]
fn test_first_rate_write_never_blocked() {
    let (env, _admin, validators, ngn, client) = setup_with(3, 2);
    let v0 = validators.get(0).unwrap();
    client.update_rate(&v0, &ngn, &999_999i128, &single_source(&env, 999_999i128), &0u64);
    assert_eq!(client.get_rate(&ngn), 999_999i128);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Per-currency vote buckets are independent
// ─────────────────────────────────────────────────────────────────────────────

/// Emergency votes for NGN must not pollute the KES vote count.
#[test]
fn test_votes_are_independent_per_currency() {
    let env = make_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let v0 = Address::generate(&env);
    let v1 = Address::generate(&env);
    let mut validators = Vec::new(&env);
    validators.push_back(v0.clone());
    validators.push_back(v1.clone());

    let ngn = CurrencyCode::new(&env, "NGN");
    let kes = CurrencyCode::new(&env, "KES");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    currencies.push_back(kes.clone());
    let mut weights: Map<CurrencyCode, i128> = Map::new(&env);
    weights.set(ngn.clone(), 5_000i128);
    weights.set(kes.clone(), 5_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &2u32, &currencies, &weights);

    seed_rate(&env, &client, &v0, &ngn, 1_000_000i128);
    seed_rate(&env, &client, &v0, &kes, 1_000_000i128);
    advance_time(&env, UPDATE_INTERVAL / 2);

    let emrg = 1_200_000i128;

    // NGN votes.
    client.cast_emergency_vote(&v0, &ngn, &emrg);
    client.cast_emergency_vote(&v1, &ngn, &emrg);

    // KES votes.
    client.cast_emergency_vote(&v0, &kes, &emrg);

    // NGN has 2 votes → bypass available.
    client.update_rate(&v0, &ngn, &emrg, &single_source(&env, emrg), &0u64);
    assert_eq!(client.get_rate(&ngn), emrg, "NGN should be updated");

    // KES still has only 1 vote — bypass not yet available.
    assert!(
        client
            .try_update_rate(&v0, &kes, &emrg, &single_source(&env, emrg), &0u64)
            .is_err(),
        "KES should still need another vote"
    );

    // Add second KES vote.
    client.cast_emergency_vote(&v1, &kes, &emrg);
    client.update_rate(&v0, &kes, &emrg, &single_source(&env, emrg), &0u64);
    assert_eq!(client.get_rate(&kes), emrg, "KES should be updated");
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Admin-only enforcement
// ─────────────────────────────────────────────────────────────────────────────

/// Non-admin callers must not be able to set the emergency threshold.
#[test]
#[should_panic]
fn test_set_emergency_threshold_requires_admin() {
    let (env, _admin, _validators, ngn, client) = setup_with(3, 2);
    let attacker = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &client.address,
            fn_name: "set_emergency_threshold",
            args: soroban_sdk::IntoVal::into_val(&(ngn.clone(), 1_000i128), &env),
            sub_invokes: &[],
        },
    }]);
    client.set_emergency_threshold(&ngn, &1_000i128);
}

/// Non-admin callers must not be able to call `set_min_signatures`.
#[test]
#[should_panic]
fn test_set_min_signatures_requires_admin() {
    let (env, _admin, _validators, _ngn, client) = setup_with(3, 2);
    let attacker = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &client.address,
            fn_name: "set_min_signatures",
            args: soroban_sdk::IntoVal::into_val(&(1u32,), &env),
            sub_invokes: &[],
        },
    }]);
    client.set_min_signatures(&1u32);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Unauthorised validator cannot cast emergency votes
// ─────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "#7007")]
fn test_unauthorized_validator_cannot_cast_vote() {
    let (env, _admin, _validators, ngn, client) = setup_with(3, 2);
    let rogue = Address::generate(&env);
    client.cast_emergency_vote(&rogue, &ngn, &1_100_000i128);
}
