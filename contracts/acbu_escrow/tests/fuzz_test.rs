#![cfg(test)]

use acbu_escrow::{Escrow, EscrowClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

fn mint_tokens(env: &Env, token: &Address, to: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// Property: amount boundary enforcement
//
// The contract requires amount >= MIN_ESCROW_AMOUNT (10_000_000 stroops).
// Any amount below that must be rejected; any amount at or above it must succeed
// (up to the payer's funded balance so the token transfer does not fail).
// ---------------------------------------------------------------------------
proptest! {
    #[test]
    fn prop_create_rejects_below_minimum(
        amount in -1_000_000_000i128..10_000_000i128,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        // Fund enough so the token transfer would not be the rejection cause.
        if amount > 0 {
            mint_tokens(&env, &token, &payer, amount);
        }

        let result = client.try_create(&payer, &payee, &amount, &1u64);
        assert!(
            result.is_err(),
            "create should reject amount={amount} below MIN_ESCROW_AMOUNT"
        );
    }

    #[test]
    fn prop_create_accepts_valid_amounts(
        amount in 10_000_000i128..1_000_000_000_000i128,
        escrow_id in 0u64..u64::MAX,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        mint_tokens(&env, &token, &payer, amount);

        let result = client.try_create(&payer, &payee, &amount, &escrow_id);
        assert!(
            result.is_ok(),
            "create should accept amount={amount}, escrow_id={escrow_id}"
        );
    }

    // -----------------------------------------------------------------------
    // Property: self-escrow is always rejected regardless of amount
    // -----------------------------------------------------------------------
    #[test]
    fn prop_self_escrow_always_rejected(
        amount in 10_000_000i128..1_000_000_000_000i128,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);

        mint_tokens(&env, &token, &payer, amount);

        let result = client.try_create(&payer, &payer, &amount, &42u64);
        assert!(
            result.is_err(),
            "self-escrow must be rejected regardless of amount={amount}"
        );
    }

    // -----------------------------------------------------------------------
    // Property: duplicate escrow ID per payer is always rejected
    // -----------------------------------------------------------------------
    #[test]
    fn prop_duplicate_escrow_id_rejected(
        amount in 10_000_000i128..100_000_000i128,
        escrow_id in 1u64..1_000_000u64,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        // Fund enough for two creates.
        mint_tokens(&env, &token, &payer, amount * 2);

        // First create must succeed.
        client.create(&payer, &payee, &amount, &escrow_id);

        // Second create with the same (payer, escrow_id) must fail.
        let result = client.try_create(&payer, &payee, &amount, &escrow_id);
        assert!(
            result.is_err(),
            "duplicate escrow_id={escrow_id} for same payer must be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Property: release moves exactly `amount` tokens to payee and empties
    //           the payer's initial balance from the contract.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_release_transfers_exact_amount(
        amount in 10_000_000i128..500_000_000i128,
        escrow_id in 1u64..1_000_000u64,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token_client = soroban_sdk::token::Client::new(&env, &token);

        mint_tokens(&env, &token, &payer, amount);
        client.create(&payer, &payee, &amount, &escrow_id);

        let payee_before = token_client.balance(&payee);
        client.release(&escrow_id, &payer);

        let payee_after = token_client.balance(&payee);
        assert_eq!(
            payee_after - payee_before,
            amount,
            "release must transfer exactly amount={amount} to payee"
        );
    }

    // -----------------------------------------------------------------------
    // Property: refund returns exactly `amount` tokens to payer
    // -----------------------------------------------------------------------
    #[test]
    fn prop_refund_returns_exact_amount(
        amount in 10_000_000i128..500_000_000i128,
        escrow_id in 1u64..1_000_000u64,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token_client = soroban_sdk::token::Client::new(&env, &token);

        mint_tokens(&env, &token, &payer, amount);
        client.create(&payer, &payee, &amount, &escrow_id);

        let payer_before = token_client.balance(&payer);
        // Admin forces the refund (before expiry, only admin can refund).
        client.refund(&escrow_id, &payer);

        let payer_after = token_client.balance(&payer);
        assert_eq!(
            payer_after - payer_before,
            amount,
            "refund must return exactly amount={amount} to payer"
        );
    }

    // -----------------------------------------------------------------------
    // Property: after release or refund the escrow record no longer exists
    // -----------------------------------------------------------------------
    #[test]
    fn prop_escrow_removed_after_settlement(
        amount in 10_000_000i128..500_000_000i128,
        escrow_id in 1u64..1_000_000u64,
        release in proptest::bool::ANY,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        mint_tokens(&env, &token, &payer, amount);
        client.create(&payer, &payee, &amount, &escrow_id);

        if release {
            client.release(&escrow_id, &payer);
        } else {
            client.refund(&escrow_id, &payer);
        }

        // Any subsequent release or refund must fail because the record is gone.
        assert!(
            client.try_release(&escrow_id, &payer).is_err(),
            "release after settlement must fail"
        );
        assert!(
            client.try_refund(&escrow_id, &payer).is_err(),
            "refund after settlement must fail"
        );
    }

    // -----------------------------------------------------------------------
    // Property: different payers sharing an escrow ID never interfere
    // -----------------------------------------------------------------------
    #[test]
    fn prop_independent_payers_same_escrow_id(
        amount_a in 10_000_000i128..200_000_000i128,
        amount_b in 10_000_000i128..200_000_000i128,
        escrow_id in 1u64..1_000_000u64,
    ) {
        let env = Env::default();
        let (client, _admin, token) = setup(&env);
        let payer_a = Address::generate(&env);
        let payer_b = Address::generate(&env);
        let payee = Address::generate(&env);
        let token_client = soroban_sdk::token::Client::new(&env, &token);

        mint_tokens(&env, &token, &payer_a, amount_a);
        mint_tokens(&env, &token, &payer_b, amount_b);

        client.create(&payer_a, &payee, &amount_a, &escrow_id);
        client.create(&payer_b, &payee, &amount_b, &escrow_id);

        client.release(&escrow_id, &payer_a);
        client.release(&escrow_id, &payer_b);

        let payee_balance = token_client.balance(&payee);
        assert_eq!(
            payee_balance,
            amount_a + amount_b,
            "payee balance must equal sum of both escrow amounts"
        );
    }
}
