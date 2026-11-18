#![cfg(test)]

use acbu_escrow::{Escrow, EscrowClient, EscrowError};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke, Ledger as _},
    Address, Env, IntoVal,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup(env: &Env) -> (Address, Address, Address, EscrowClient) {
    let admin = Address::generate(env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &acbu_token);

    (admin, acbu_token, contract_id, client)
}

fn mint(env: &Env, token: &Address, recipient: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(recipient, &amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #3002)")]
fn test_create_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, _token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    client.create(&payer, &payee, &0i128, &1u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #3017)")]
fn test_create_self_escrow_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let amount = 10_000_000i128;

    mint(&env, &acbu_token, &payer, amount);
    client.create(&payer, &payer, &amount, &2u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #3003)")]
fn test_release_missing_escrow_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, _token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);

    client.release(&7u64, &payer);
}

// ── Create edge cases ─────────────────────────────────────────────────────────

#[test]
fn test_create_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, _token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let result = client.try_create(&payer, &payee, &0i128, &1u64);
    assert_eq!(
        result,
        Err(Ok(EscrowError::InvalidAmount)),
        "create with zero amount must return InvalidAmount"
    );
}

#[test]
fn test_create_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, _token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let result = client.try_create(&payer, &payee, &(-1i128), &1u64);
    assert_eq!(
        result,
        Err(Ok(EscrowError::InvalidAmount)),
        "create with negative amount must return InvalidAmount"
    );
}

#[test]
fn test_create_when_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;

    mint(&env, &acbu_token, &payer, amount);
    client.pause();

    let result = client.try_create(&payer, &payee, &amount, &1u64);
    assert_eq!(
        result,
        Err(Ok(EscrowError::Paused)),
        "create must be rejected while contract is paused"
    );
}

#[test]
fn test_release_when_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 10u64;

    mint(&env, &acbu_token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);

    client.pause();

    let result = client.try_release(&escrow_id, &payer);
    assert_eq!(
        result,
        Err(Ok(EscrowError::Paused)),
        "release must be rejected while contract is paused"
    );
}

#[test]
fn test_duplicate_create_same_payer_same_id_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 99u64;

    mint(&env, &acbu_token, &payer, amount * 2);

    client.create(&payer, &payee, &amount, &escrow_id);

    let result = client.try_create(&payer, &payee, &amount, &escrow_id);
    assert_eq!(
        result,
        Err(Ok(EscrowError::EscrowExists)),
        "duplicate (payer, escrow_id) must return EscrowExists"
    );
}

#[test]
fn test_same_payer_different_ids_are_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;

    mint(&env, &acbu_token, &payer, amount * 2);

    client.create(&payer, &payee, &amount, &1u64);
    client.create(&payer, &payee, &amount, &2u64);

    let token = soroban_sdk::token::Client::new(&env, &acbu_token);

    client.release(&1u64, &payer);
    assert_eq!(token.balance(&payee), amount, "token.balance(&payee) should equal amount");

    client.release(&2u64, &payer);
    assert_eq!(token.balance(&payee), amount * 2, "token.balance(&payee) should equal amount * 2");
}

// ── Non-admin refund must fail ────────────────────────────────────────────────

#[test]
fn test_non_admin_cannot_call_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, contract_id, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let attacker = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 5u64;

    mint(&env, &acbu_token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);

    // Provide only the attacker's auth — refund() requires admin auth.
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "refund",
            args: (escrow_id, payer.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_refund(&escrow_id, &payer);
    assert!(
        result.is_err(),
        "refund must fail when called without admin auth"
    );
}

// ── Unpause restores create and release ───────────────────────────────────────

#[test]
fn test_unpause_restores_create_and_release() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 77u64;

    mint(&env, &acbu_token, &payer, amount);

    client.pause();
    assert!(
        client.try_create(&payer, &payee, &amount, &escrow_id).is_err(),
        "create must fail while paused"
    );

    client.unpause();
    client.create(&payer, &payee, &amount, &escrow_id);
    client.release(&escrow_id, &payer);

    let token = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token.balance(&payee), amount, "token.balance(&payee) should equal amount");
}

// ── Payer receives full amount after refund ───────────────────────────────────

#[test]
fn test_payer_receives_full_amount_after_admin_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 20_000_000i128;
    let escrow_id = 33u64;

    mint(&env, &acbu_token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);

    let token = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token.balance(&payer), 0, "payer balance must be 0 after create");

    client.refund(&escrow_id, &payer);
    assert_eq!(
        token.balance(&payer),
        amount,
        "payer must receive full amount back after admin refund"
    );
}

// ── Two different payers same escrow_id are fully independent ─────────────────

#[test]
fn test_two_payers_same_escrow_id_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer_a = Address::generate(&env);
    let payer_b = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount_a = 40_000_000i128;
    let amount_b = 60_000_000i128;
    let escrow_id = 42u64;

    mint(&env, &acbu_token, &payer_a, amount_a);
    mint(&env, &acbu_token, &payer_b, amount_b);

    client.create(&payer_a, &payee, &amount_a, &escrow_id);
    client.create(&payer_b, &payee, &amount_b, &escrow_id);

    client.release(&escrow_id, &payer_a);
    client.release(&escrow_id, &payer_b);

    let token = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(
        token.balance(&payee),
        amount_a + amount_b,
        "payee must receive funds from both independent escrows"
    );
}

#[test]
fn test_escrow_expiration_and_self_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, acbu_token, _cid, client) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 99u64;

    mint(&env, &acbu_token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);

    // Advance ledger timestamp to 30 days + 1 second
    let current_time = env.ledger().timestamp();
    env.ledger().set_timestamp(current_time + 30 * 86_400 + 1);

    // Release should fail with Expired
    let release_res = client.try_release(&escrow_id, &payer);
    assert_eq!(
        release_res,
        Err(Ok(EscrowError::Expired)),
        "Expired escrow must not be releasable"
    );

    // Payer can self-refund after expiry
    let token = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token.balance(&payer), 0, "token.balance(&payer) should equal 0");

    // Refund can be executed now
    client.refund(&escrow_id, &payer);
    assert_eq!(token.balance(&payer), amount, "token.balance(&payer) should equal amount");
}
