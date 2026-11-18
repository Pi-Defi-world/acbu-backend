#![cfg(test)]

#[path = "common/mod.rs"]
mod common;
use common::{create_stoken, setup_test};
use shared::{CurrencyCode, BASIS_POINTS, DECIMALS};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn test_redeem_single_success() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");
    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let acbu_rate: i128 = DECIMALS;
    let ngn_rate: i128 = DECIMALS / 2;
    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&acbu_rate, &ts);
    ctx.oracle.set_currency_rate(&currency, &ngn_rate);
    ctx.oracle.set_timestamp(&currency, &ts);

    let recipient = Address::generate(&env);
    let out = ctx
        .burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency, &None);
    let net_acbu = burn_amount - expected_fee;
    let expected_out = (net_acbu * acbu_rate) / ngn_rate;

    assert_eq!(out, expected_out, "out should equal expected_out");
    assert_eq!(stoken_client.balance(&recipient), expected_out, "stoken_client.balance(&recipient) should equal expected_out");
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0, "ctx.acbu_token.balance(&ctx.user) should equal 0");
}

#[test]
fn test_redeem_single_fee_calculation() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");
    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&currency, &DECIMALS);
    ctx.oracle.set_timestamp(&currency, &ts);

    let recipient = Address::generate(&env);
    let out = ctx
        .burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency);

    // Verify fee: 2% of 100 * DECIMALS = 2 * DECIMALS
    let expected_out = 98 * DECIMALS;
    assert_eq!(out, expected_out, "out should equal expected_out");
    assert_eq!(stoken_client.balance(&recipient), expected_out, "stoken_client.balance(&recipient) should equal expected_out");
}

#[test]
fn test_redeem_single_self_redeem() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");
    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&currency, &DECIMALS);
    ctx.oracle.set_timestamp(&currency, &ts);

    // User redeems to themselves
    let out = ctx
        .burning
        .redeem_single(&ctx.user, &ctx.user, &burn_amount, &currency);
    assert!(out > 0);
    assert_eq!(stoken_client.balance(&ctx.user), out, "stoken_client.balance(&ctx.user) should equal out");
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // InvalidAmount
fn test_redeem_single_zero_amount() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let currency = CurrencyCode::new(&env, "NGN");
    let recipient = Address::generate(&env);

    let (stoken_id, _, _stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_timestamp(&currency, &ts);

    ctx.burning
        .redeem_single(&ctx.user, &recipient, &0, &currency);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // InvalidAmount
fn test_redeem_single_below_min_amount() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let currency = CurrencyCode::new(&env, "NGN");
    let recipient = Address::generate(&env);

    let (_stoken_id, _, _) = create_stoken(&env, &ctx.admin);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_timestamp(&currency, &ts);

    let invalid_amount = 5_000_000; // Below MIN_BURN_AMOUNT (10_000_000)
    ctx.burning
        .redeem_single(&ctx.user, &recipient, &invalid_amount, &currency);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // InvalidRate
fn test_redeem_single_zero_rate() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let currency = CurrencyCode::new(&env, "NGN");
    let recipient = Address::generate(&env);

    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&currency, &0); // Zero rate triggers InvalidRate
    ctx.oracle.set_timestamp(&currency, &ts);

    ctx.burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // InsufficientReserves
fn test_redeem_single_insufficient_reserves() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let currency = CurrencyCode::new(&env, "NGN");
    let recipient = Address::generate(&env);

    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_timestamp(&currency, &ts);

    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    ctx.reserve_tracker.set_reserve_ok(&false);

    ctx.burning
        .redeem_single(&ctx.user, &recipient, &(100 * DECIMALS), &currency);
}

#[test]
fn test_redeem_single_multiple_calls() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");
    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &(2 * burn_amount));

    let vault_amount: i128 = 1000 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&currency, &DECIMALS);
    ctx.oracle.set_timestamp(&currency, &ts);

    let recipient = Address::generate(&env);

    // First redemption
    let out1 = ctx
        .burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency);
    assert!(out1 > 0);

    // Second redemption
    let out2 = ctx
        .burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency);
    assert!(out2 > 0);

    // Total stoken received
    assert_eq!(stoken_client.balance(&recipient), out1 + out2, "stoken_client.balance(&recipient) should equal out1 + out2");

    // User balance should be 0
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0, "ctx.acbu_token.balance(&ctx.user) should equal 0");
}

#[test]
fn test_redeem_single_exact_min_amount() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");
    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    let min_amount: i128 = 10 * DECIMALS; // MIN_BURN_AMOUNT
    ctx.acbu_token.mint(&ctx.user, &min_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&currency, &DECIMALS);
    ctx.oracle.set_timestamp(&currency, &ts);

    let recipient = Address::generate(&env);
    let out = ctx
        .burning
        .redeem_single(&ctx.user, &recipient, &min_amount, &currency);

    assert!(out > 0);
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0, "ctx.acbu_token.balance(&ctx.user) should equal 0");
}

#[test]
fn test_redeem_single_large_amount() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");
    let (stoken_id, stoken_client, stoken_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&currency, &stoken_id);

    // Large amount to test for overflow safety
    let burn_amount: i128 = 1_000_000 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 2_000_000 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken_client.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&currency, &DECIMALS);
    ctx.oracle.set_timestamp(&currency, &ts);

    let recipient = Address::generate(&env);
    let out = ctx
        .burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency);

    assert!(out > 0);
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0, "ctx.acbu_token.balance(&ctx.user) should equal 0");
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_redeem_single_stale_acbu_rate() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");

    // Advance ledger past staleness threshold (UPDATE_INTERVAL_SECONDS = 21,600)
    env.ledger().with_mut(|l| l.timestamp = 100_000);

    // ACBU rate timestamp is stale (0) → first oracle staleness check fails
    ctx.oracle.set_acbu_rate(&DECIMALS, &0);

    let recipient = Address::generate(&env);
    ctx.burning
        .redeem_single(&ctx.user, &recipient, &(100 * DECIMALS), &currency);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_redeem_single_stale_currency_rate() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency = CurrencyCode::new(&env, "NGN");

    // Advance ledger past staleness threshold
    env.ledger().with_mut(|l| l.timestamp = 100_000);

    // ACBU rate is fresh (matches ledger) so first check passes
    ctx.oracle.set_acbu_rate(&DECIMALS, &100_000);

    // Currency rate timestamp is unset → defaults to 0 in mock → stale
    let recipient = Address::generate(&env);
    ctx.burning
        .redeem_single(&ctx.user, &recipient, &(100 * DECIMALS), &currency);
}
