#![cfg(test)]

use acbu_escrow::{Escrow, EscrowClient, EscrowError};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (EscrowClient<'_>, Address, Address) {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(env, &contract_id);
    client.initialize(&admin, &acbu_token);

    (client, admin, acbu_token)
}

fn mint(env: &Env, _admin: &Address, token: &Address, to: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
}

#[test]
fn create_locks_payer_funds() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;

    mint(&env, &admin, &token, &payer, amount);
    client.create(&payer, &payee, &amount, &1);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&payer), 0, "token_client.balance(&payer) should equal 0");
    assert_eq!(token_client.balance(&client.address), amount, "token_client.balance(&client.address) should equal amount");
}

#[test]
fn release_pays_payee_and_removes_escrow() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 15_000_000i128;
    let escrow_id = 7u64;

    mint(&env, &admin, &token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);
    client.release(&escrow_id, &payer);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&payee), amount, "token_client.balance(&payee) should equal amount");
    assert!(client.try_release(&escrow_id, &payer).is_err());
}

#[test]
fn refund_returns_funds_to_payer_and_removes_escrow() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 20_000_000i128;
    let escrow_id = 9u64;

    mint(&env, &admin, &token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);
    client.refund(&escrow_id, &payer);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&payer), amount, "token_client.balance(&payer) should equal amount");
    assert!(client.try_refund(&escrow_id, &payer).is_err());
}

#[test]
fn different_payers_can_reuse_same_escrow_id_without_collision() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer_a = Address::generate(&env);
    let payer_b = Address::generate(&env);
    let payee = Address::generate(&env);
    let escrow_id = 42u64;

    mint(&env, &admin, &token, &payer_a, 100_000_000);
    mint(&env, &admin, &token, &payer_b, 100_000_000);

    client.create(&payer_a, &payee, &70_000_000, &escrow_id);
    client.create(&payer_b, &payee, &30_000_000, &escrow_id);

    client.release(&escrow_id, &payer_a);
    client.release(&escrow_id, &payer_b);

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&payee), 100_000_000, "token_client.balance(&payee) should equal 100_000_000");
}

#[test]
fn same_payer_same_escrow_id_is_rejected_until_released() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let escrow_id = 11u64;

    mint(&env, &admin, &token, &payer, 100_000_000);
    client.create(&payer, &payee, &40_000_000, &escrow_id);
    assert!(client.try_create(&payer, &payee, &10_000_000, &escrow_id).is_err());

    client.release(&escrow_id, &payer);
    client.create(&payer, &payee, &10_000_000, &escrow_id);
}

#[test]
fn test_pause_without_initialize_returns_uninitialized_admin_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(&env, &contract_id);

    let result = client.try_pause();
    assert_eq!(result, Err(Ok(EscrowError::UninitializedAdmin)), "pause should fail before admin initialization");
}

#[test]
fn test_update_acbu_token_by_admin_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(&env, &contract_id);
    client.initialize(&admin, &acbu_token);

    let new_token = Address::generate(&env);
    client.update_acbu_token(&new_token);
}

#[test]
fn test_refund_fails_with_insufficient_contract_balance() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 9u64;

    mint(&env, &admin, &token, &payer, amount);
    client.create(&payer, &payee, &amount, &escrow_id);

    // Drain the contract balance of this token to simulate insolvency/insufficient funds.
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    token_client.transfer(&client.address, &admin, &amount);

    // Refund should fail with InsufficientBalance error.
    let result = client.try_refund(&escrow_id, &payer);
    assert_eq!(result, Err(Ok(EscrowError::InsufficientBalance)), "refund should fail when the contract balance is insufficient");
}

#[test]
fn test_self_escrow_is_rejected() {
    let env = Env::default();
    let (client, admin, token) = setup(&env);
    let payer = Address::generate(&env);
    let amount = 10_000_000i128;
    let escrow_id = 1u64;

    mint(&env, &admin, &token, &payer, amount);

    // Creating an escrow with payee == payer should fail with SelfEscrow error.
    let result = client.try_create(&payer, &payer, &amount, &escrow_id);
    assert_eq!(
        result,
        Err(Ok(EscrowError::SelfEscrow)),
        "self-escrow (payee == payer) should be rejected"
    );
}
