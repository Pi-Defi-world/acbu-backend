#![cfg(test)]

//! AC-003: `update_rate` must enforce the `min_signatures` validator quorum.
//! A single validator's call only records a submission; the stored rate changes
//! only once `min_signatures` distinct validators have submitted, and the
//! committed value is the median of their submissions.

use acbu_oracle::{OracleContract, OracleContractClient};
use shared::CurrencyCode;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Map, Vec,
};

const UPDATE_INTERVAL: u64 = 21_600;
const SUBMISSION_TTL: u64 = 3_600;

/// 3-of-5 oracle with a single NGN basket entry.
fn setup() -> (Env, OracleContractClient<'static>, Vec<Address>, CurrencyCode) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
        l.sequence_number = 100;
    });

    let admin = Address::generate(&env);
    let mut validators = Vec::new(&env);
    for _ in 0..5 {
        validators.push_back(Address::generate(&env));
    }

    let ngn = CurrencyCode::new(&env, "NGN");
    let mut currencies = Vec::new(&env);
    currencies.push_back(ngn.clone());
    let mut weights = Map::new(&env);
    weights.set(ngn.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &contract_id);
    client.initialize(&admin, &validators, &3u32, &currencies, &weights);

    (env, client, validators, ngn)
}

fn submit(env: &Env, client: &OracleContractClient, v: &Address, c: &CurrencyCode, rate: i128) {
    let mut sources = Vec::new(env);
    sources.push_back(rate);
    client.update_rate(v, c, &rate, &sources, &env.ledger().timestamp());
}

#[test]
fn test_single_validator_cannot_commit_rate() {
    let (env, client, validators, ngn) = setup();
    let v0 = validators.get(0).unwrap();

    submit(&env, &client, &v0, &ngn, 1_000_000);
    assert!(
        client.try_get_rate(&ngn).is_err(),
        "one submission of a 3-of-5 quorum must not commit a rate"
    );
}

#[test]
fn test_rogue_validator_cannot_move_committed_rate() {
    let (env, client, validators, ngn) = setup();
    for i in 0..3 {
        submit(&env, &client, &validators.get(i).unwrap(), &ngn, 1_000_000);
    }
    assert_eq!(client.get_rate(&ngn), 1_000_000);

    env.ledger()
        .with_mut(|l| l.timestamp += UPDATE_INTERVAL + 1);

    // A single rogue validator submits a 50x rate after the interval.
    submit(&env, &client, &validators.get(4).unwrap(), &ngn, 50_000_000);
    assert_eq!(
        client.get_rate(&ngn),
        1_000_000,
        "a single validator must not be able to change the rate"
    );
}

#[test]
fn test_committed_rate_is_median_of_submissions() {
    let (env, client, validators, ngn) = setup();

    // One rogue submission is outvoted by the two honest ones.
    submit(&env, &client, &validators.get(0).unwrap(), &ngn, 50_000_000);
    submit(&env, &client, &validators.get(1).unwrap(), &ngn, 1_000_000);
    submit(&env, &client, &validators.get(2).unwrap(), &ngn, 1_010_000);

    assert_eq!(client.get_rate(&ngn), 1_010_000, "median of 3 submissions");
}

#[test]
fn test_resubmission_does_not_count_twice() {
    let (env, client, validators, ngn) = setup();
    let v0 = validators.get(0).unwrap();
    let v1 = validators.get(1).unwrap();

    submit(&env, &client, &v0, &ngn, 1_000_000);
    submit(&env, &client, &v0, &ngn, 1_000_000);
    submit(&env, &client, &v1, &ngn, 1_000_000);
    assert!(
        client.try_get_rate(&ngn).is_err(),
        "the same validator submitting twice is still one signature"
    );

    submit(&env, &client, &validators.get(2).unwrap(), &ngn, 1_000_000);
    assert_eq!(client.get_rate(&ngn), 1_000_000);
}

#[test]
fn test_expired_submissions_do_not_count() {
    let (env, client, validators, ngn) = setup();

    submit(&env, &client, &validators.get(0).unwrap(), &ngn, 1_000_000);
    env.ledger().with_mut(|l| l.timestamp += SUBMISSION_TTL + 1);
    submit(&env, &client, &validators.get(1).unwrap(), &ngn, 1_000_000);
    submit(&env, &client, &validators.get(2).unwrap(), &ngn, 1_000_000);
    assert!(
        client.try_get_rate(&ngn).is_err(),
        "an expired submission must not complete the quorum"
    );

    submit(&env, &client, &validators.get(3).unwrap(), &ngn, 1_000_000);
    assert_eq!(client.get_rate(&ngn), 1_000_000);
}

#[test]
fn test_round_resets_after_commit() {
    let (env, client, validators, ngn) = setup();
    for i in 0..3 {
        submit(&env, &client, &validators.get(i).unwrap(), &ngn, 1_000_000);
    }
    env.ledger()
        .with_mut(|l| l.timestamp += UPDATE_INTERVAL + 1);

    // Submissions from the committed round must not carry over.
    submit(&env, &client, &validators.get(0).unwrap(), &ngn, 1_020_000);
    submit(&env, &client, &validators.get(1).unwrap(), &ngn, 1_020_000);
    assert_eq!(client.get_rate(&ngn), 1_000_000, "2 of 3 in the new round");

    submit(&env, &client, &validators.get(2).unwrap(), &ngn, 1_020_000);
    assert_eq!(client.get_rate(&ngn), 1_020_000);
}
