#![cfg(test)]

use acbu_escrow::{Escrow, EscrowClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal,
};

#[test]
fn test_happy_path_create_fund_release() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let escrow_id = 1u64;
    let amount = 25_000_000i128;

    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    env.mock_all_auths();
    token_admin.mint(&payer, &amount);

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token);
    client.create(&payer, &payee, &amount, &escrow_id);


    // payer authorizes release
    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "release",
            args: (escrow_id, payer.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.release(&escrow_id, &payer);

    let token = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token.balance(&payee), amount, "token.balance(&payee) should equal amount");

    // after release the escrow must no longer exist
    let result = client.try_release(&escrow_id, &payer);
    assert!(result.is_err(), "Release of consumed escrow must fail");
}

#[test]
fn test_admin_refund_on_dispute() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let escrow_id = 7u64;
    let amount = 25_000_000i128;

    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    env.mock_all_auths();
    token_admin.mint(&payer, &amount);

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token);
    client.create(&payer, &payee, &amount, &escrow_id);


    // admin authorizes refund (dispute resolution)
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "refund",
            args: (escrow_id, payer.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.refund(&escrow_id, &payer);

    let token = soroban_sdk::token::Client::new(&env, &acbu_token);
    assert_eq!(token.balance(&payer), amount, "token.balance(&payer) should equal amount");

    // after refund the escrow must no longer exist
    let result = client.try_refund(&escrow_id, &payer);
    assert!(result.is_err(), "Refund of consumed escrow must fail");
}

#[test]
fn test_adversarial_release_by_non_payer_fails() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let attacker = Address::generate(&env);
    let escrow_id = 42u64;
    let amount = 10_000_000i128;

    let acbu_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &acbu_token);
    env.mock_all_auths();
    token_admin.mint(&payer, &amount);

    let contract_id = env.register_contract(None, Escrow);
    let client = EscrowClient::new(&env, &contract_id);

    client.initialize(&admin, &acbu_token);
    client.create(&payer, &payee, &amount, &escrow_id);


    // attacker tries to call release without payer auth
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "release",
            args: (escrow_id, payer.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_release(&escrow_id, &payer);
    assert!(result.is_err(), "Release without payer auth must fail");
}
