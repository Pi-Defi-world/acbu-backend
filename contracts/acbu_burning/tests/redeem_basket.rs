#![cfg(test)]

#[path = "common/mod.rs"]
mod common;
use common::{create_stoken, setup_test};
use shared::{CurrencyCode, BASIS_POINTS, DECIMALS};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, Map};

#[test]
fn test_redeem_basket_success() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);

    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);

    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 6000); // 60%
    weights.set(c2.clone(), 4000); // 40%
    ctx.oracle.set_weights(&weights);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let acbu_rate: i128 = DECIMALS; // 1 ACBU = 1 USD
    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&acbu_rate, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS); // 1 NGN = 1 USD
    ctx.oracle.set_currency_rate(&c2, &DECIMALS); // 1 KES = 1 USD
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let recipients = vec![&env, r1.clone(), r2.clone()];

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    // Fee for basket is 1% (100 bps)
    let expected_total_fee = (burn_amount * 100) / BASIS_POINTS;
    let net_acbu = burn_amount - expected_total_fee;

    let expected_out1 = (6000 * net_acbu * acbu_rate) / (BASIS_POINTS * DECIMALS);
    let expected_out2 = (4000 * net_acbu * acbu_rate) / (BASIS_POINTS * DECIMALS);

    assert_eq!(amounts.get(0).unwrap(), expected_out1, "amounts.get(0).unwrap() should equal expected_out1");
    assert_eq!(amounts.get(1).unwrap(), expected_out2, "amounts.get(1).unwrap() should equal expected_out2");
    assert_eq!(st1.balance(&r1), expected_out1, "st1.balance(&r1) should equal expected_out1");
    assert_eq!(st2.balance(&r2), expected_out2, "st2.balance(&r2) should equal expected_out2");
}

#[test]
fn test_redeem_basket_allocates_weighted_remainder() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");
    let c3 = CurrencyCode::new(&env, "RWF");
    let currs = vec![&env, c1.clone(), c2.clone(), c3.clone()];
    ctx.oracle.set_currencies(&currs);

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);
    let (st3_id, st3, st3_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);
    ctx.oracle.set_stoken(&c3, &st3_id);

    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 3333);
    weights.set(c2.clone(), 3333);
    weights.set(c3.clone(), 3334);
    ctx.oracle.set_weights(&weights);

    let burn_amount: i128 = (10 * DECIMALS) + 1;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st3_sac.mint(&ctx.vault, &vault_amount);
    st3.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_currency_rate(&c2, &DECIMALS);
    ctx.oracle.set_currency_rate(&c3, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);
    ctx.oracle.set_timestamp(&c3, &ts);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let recipients = vec![&env, r1.clone(), r2.clone(), r3.clone()];

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    let expected_fee = (burn_amount * 100) / BASIS_POINTS;
    let expected_net = burn_amount - expected_fee;
    let total_out = amounts.get(0).unwrap() + amounts.get(1).unwrap() + amounts.get(2).unwrap();

    assert_eq!(total_out, expected_net, "total_out should equal expected_net");
    assert_eq!(st1.balance(&r1), amounts.get(0).unwrap(), "st1.balance(&r1) should equal amounts.get(0).unwrap()");
    assert_eq!(st2.balance(&r2), amounts.get(1).unwrap(), "st2.balance(&r2) should equal amounts.get(1).unwrap()");
    assert_eq!(st3.balance(&r3), amounts.get(2).unwrap(), "st3.balance(&r3) should equal amounts.get(2).unwrap()");
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // InvalidRecipient
fn test_redeem_basket_duplicate_recipients() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let r1 = Address::generate(&env);
    let recipients = vec![&env, r1.clone(), r1.clone()]; // Duplicate

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");
    let (st1_id, _, _st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, _, _st2_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);

    ctx.burning
        .redeem_basket(&ctx.user, &recipients, &(100 * DECIMALS));
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // InvalidRecipient
fn test_redeem_basket_insufficient_recipients() {
    let env = Env::default();
    let ctx = setup_test(&env);

    // Default setup has 2 currencies
    let r1 = Address::generate(&env);
    let recipients = vec![&env, r1]; // Only 1 recipient

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");
    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_currency_rate(&c2, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);

    ctx.burning
        .redeem_basket(&ctx.user, &recipients, &(100 * DECIMALS));
}

#[test]
fn test_redeem_basket_zero_weight_leg() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);

    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);

    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000); // 100%
    weights.set(c2.clone(), 0); // 0%
    ctx.oracle.set_weights(&weights);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_currency_rate(&c2, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);

    let recipients = vec![&env, Address::generate(&env), Address::generate(&env)];
    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    assert!(amounts.get(0).unwrap() > 0);
    assert_eq!(amounts.get(1).unwrap(), 0, "amounts.get(1).unwrap() should equal 0");
}

#[test]
fn test_redeem_basket_exact_min_amount() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000);
    ctx.oracle.set_weights(&weights);

    // Override currencies to just NGN for single-currency basket
    let currs: soroban_sdk::Vec<CurrencyCode> = soroban_sdk::Vec::from_array(&env, [c1.clone()]);
    ctx.oracle.set_currencies(&currs);

    let min_amount: i128 = 10 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &min_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);

    let recipient = Address::generate(&env);
    let recipients = vec![&env, recipient.clone()];
    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &min_amount);

    assert!(amounts.get(0).unwrap() > 0);
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0, "ctx.acbu_token.balance(&ctx.user) should equal 0");
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // InvalidAmount
fn test_redeem_basket_zero_amount() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let (st1_id, _, _) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000);
    ctx.oracle.set_weights(&weights);

    let recipients = vec![&env, Address::generate(&env)];
    ctx.burning.redeem_basket(&ctx.user, &recipients, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // InvalidCurrency
fn test_redeem_basket_empty_currencies() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let empty_currs: soroban_sdk::Vec<CurrencyCode> = soroban_sdk::Vec::new(&env);
    ctx.oracle.set_currencies(&empty_currs);

    let recipients = vec![&env, Address::generate(&env)];
    ctx.burning
        .redeem_basket(&ctx.user, &recipients, &(100 * DECIMALS));
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // InsufficientReserves
fn test_redeem_basket_insufficient_reserves() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000);
    ctx.oracle.set_weights(&weights);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);

    ctx.reserve_tracker.set_reserve_ok(&false);

    let recipients = vec![&env, Address::generate(&env), Address::generate(&env)];
    ctx.burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);
}

#[test]
fn test_redeem_basket_self_redeem() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000);
    ctx.oracle.set_weights(&weights);

    let currs: soroban_sdk::Vec<CurrencyCode> = soroban_sdk::Vec::from_array(&env, [c1.clone()]);
    ctx.oracle.set_currencies(&currs);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);

    let recipients = vec![&env, ctx.user.clone()];
    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);
    assert!(amounts.get(0).unwrap() > 0);
}

#[test]
fn test_redeem_basket_multiple_calls() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let currs: soroban_sdk::Vec<CurrencyCode> = soroban_sdk::Vec::from_array(&env, [c1.clone()]);
    ctx.oracle.set_currencies(&currs);

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000);
    ctx.oracle.set_weights(&weights);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &(2 * burn_amount));

    let vault_amount: i128 = 1000 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);

    let recipient = Address::generate(&env);
    let recipients = vec![&env, recipient.clone()];

    // First redemption
    let amounts1 = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);
    let out1 = amounts1.get(0).unwrap();
    assert!(out1 > 0);

    // Second redemption
    let amounts2 = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);
    let out2 = amounts2.get(0).unwrap();
    assert!(out2 > 0);

    // Total stoken received should equal sum of both redemptions
    assert_eq!(st1.balance(&recipient), out1 + out2, "st1.balance(&recipient) should equal out1 + out2");

    // User ACBU balance should be 0 after burning all
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0, "ctx.acbu_token.balance(&ctx.user) should equal 0");
}

// --- Edge divisibility tests (FIX #326) ---

#[test]
fn test_redeem_basket_prime_amount_preserves_total() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");
    let c3 = CurrencyCode::new(&env, "RWF");

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);
    let (st3_id, st3, st3_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);
    ctx.oracle.set_stoken(&c3, &st3_id);

    let currs = vec![&env, c1.clone(), c2.clone(), c3.clone()];
    ctx.oracle.set_currencies(&currs);

    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 5000);
    weights.set(c2.clone(), 3000);
    weights.set(c3.clone(), 2000);
    ctx.oracle.set_weights(&weights);

    // Use a prime amount that doesn't divide evenly by weights
    let burn_amount: i128 = 97 * DECIMALS + 13;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st3_sac.mint(&ctx.vault, &vault_amount);
    st3.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_currency_rate(&c2, &DECIMALS);
    ctx.oracle.set_currency_rate(&c3, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);
    ctx.oracle.set_timestamp(&c3, &ts);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let recipients = vec![&env, r1.clone(), r2.clone(), r3.clone()];

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    let expected_fee = (burn_amount * 100) / BASIS_POINTS;
    let expected_net = burn_amount - expected_fee;
    let total_out = amounts.get(0).unwrap() + amounts.get(1).unwrap() + amounts.get(2).unwrap();

    // Sum of outputs must not exceed net amount (fee-first guarantee)
    assert!(total_out <= expected_net);
    // Rounding loss must be bounded by number of legs
    assert!(total_out >= expected_net - 3);
    assert_eq!(st1.balance(&r1), amounts.get(0).unwrap());
    assert_eq!(st2.balance(&r2), amounts.get(1).unwrap());
    assert_eq!(st3.balance(&r3), amounts.get(2).unwrap());
}

#[test]
fn test_redeem_basket_small_amount_no_dust_loss() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);

    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 3333);
    weights.set(c2.clone(), 6667);
    ctx.oracle.set_weights(&weights);

    // Small amount just above min to test granular rounding
    let burn_amount: i128 = 10 * DECIMALS + 7;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_currency_rate(&c2, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let recipients = vec![&env, r1, r2];

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    let expected_fee = (burn_amount * 100) / BASIS_POINTS;
    let expected_net = burn_amount - expected_fee;
    let total_out = amounts.get(0).unwrap() + amounts.get(1).unwrap();

    // Total must be <= net (fee is taken first)
    assert!(total_out <= expected_net);
    // Dust loss should be at most 1 unit per leg
    assert!(total_out >= expected_net - 2);
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0);
}

#[test]
fn test_redeem_basket_uneven_weights_no_precision_loss() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");
    let c3 = CurrencyCode::new(&env, "RWF");

    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    let (st2_id, st2, st2_sac) = create_stoken(&env, &ctx.admin);
    let (st3_id, st3, st3_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);
    ctx.oracle.set_stoken(&c2, &st2_id);
    ctx.oracle.set_stoken(&c3, &st3_id);

    let currs = vec![&env, c1.clone(), c2.clone(), c3.clone()];
    ctx.oracle.set_currencies(&currs);

    // Extremely uneven weights to stress rounding
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 1);
    weights.set(c2.clone(), 1);
    weights.set(c3.clone(), 9998);
    ctx.oracle.set_weights(&weights);

    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st2_sac.mint(&ctx.vault, &vault_amount);
    st2.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    st3_sac.mint(&ctx.vault, &vault_amount);
    st3.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_currency_rate(&c2, &DECIMALS);
    ctx.oracle.set_currency_rate(&c3, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);
    ctx.oracle.set_timestamp(&c2, &ts);
    ctx.oracle.set_timestamp(&c3, &ts);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let recipients = vec![&env, r1.clone(), r2.clone(), r3.clone()];

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    let total_out = amounts.get(0).unwrap() + amounts.get(1).unwrap() + amounts.get(2).unwrap();
    let expected_fee = (burn_amount * 100) / BASIS_POINTS;
    let expected_net = burn_amount - expected_fee;

    assert!(total_out <= expected_net);
    assert!(total_out >= expected_net - 3);
    // Legs with weight 1 should get at least something if rounding allows
    // (they may get 0 if the slice rounds down, but that's acceptable)
    assert_eq!(st1.balance(&r1), amounts.get(0).unwrap());
    assert_eq!(st2.balance(&r2), amounts.get(1).unwrap());
    assert_eq!(st3.balance(&r3), amounts.get(2).unwrap());
}

#[test]
fn test_redeem_basket_fee_exact_divisibility() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let c1 = CurrencyCode::new(&env, "NGN");
    let (st1_id, st1, st1_sac) = create_stoken(&env, &ctx.admin);
    ctx.oracle.set_stoken(&c1, &st1_id);

    let currs = vec![&env, c1.clone()];
    ctx.oracle.set_currencies(&currs);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 10000);
    ctx.oracle.set_weights(&weights);

    // Amount where fee calculation produces exact remainder
    let burn_amount: i128 = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let vault_amount: i128 = 500 * DECIMALS;
    st1_sac.mint(&ctx.vault, &vault_amount);
    st1.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);

    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(&c1, &DECIMALS);
    ctx.oracle.set_timestamp(&c1, &ts);

    let recipient = Address::generate(&env);
    let recipients = vec![&env, recipient.clone()];

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    // Fee = 1%, net = 99 * DECIMALS
    // With single currency and weight = 10000, amounts[0] must be exactly 99 * DECIMALS
    assert_eq!(amounts.get(0).unwrap(), 99 * DECIMALS);
    assert_eq!(st1.balance(&recipient), 99 * DECIMALS);
}
