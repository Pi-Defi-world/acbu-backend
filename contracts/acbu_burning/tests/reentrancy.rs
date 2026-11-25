#![cfg(test)]
// W11-CAR-010 / AC-008: redeem_single and redeem_basket share a single reentrancy
// guard key. Each path holds the guard across all external token calls so that:
//   • a reentrant call into the SAME function is rejected (self-reentrancy), and
//   • a reentrant call into the OTHER function is also rejected (cross-reentrancy).

#[path = "common/mod.rs"]
mod common;
use common::{create_stoken, setup_test, TestContext};
use shared::reentrancy_guard::{self, ReentrancyError};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, Error, Map};

const AMOUNT: i128 = 100 * DECIMALS;

fn seed(ctx: &TestContext, currency: &CurrencyCode) {
    let env = &ctx.env;
    let (stoken_id, stoken, stoken_sac) = create_stoken(env, &ctx.admin);
    ctx.oracle.set_stoken(currency, &stoken_id);
    let vault_amount: i128 = 1_000 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(currency, &DECIMALS);
    ctx.oracle.set_timestamp(currency, &ts);
}

/// Simulate an in-flight guarded call on the burning contract.
fn hold_guard(ctx: &TestContext) {
    ctx.env.as_contract(&ctx.burning_id, || {
        std::mem::forget(reentrancy_guard::acquire_guard(&ctx.env));
    });
}

fn guard_active(ctx: &TestContext) -> bool {
    ctx.env
        .as_contract(&ctx.burning_id, || reentrancy_guard::is_guard_active(&ctx.env))
}

fn reentrant() -> Error {
    Error::from_contract_error(ReentrancyError::ReentrantCall as u32)
}

// ── Self-reentrancy tests ────────────────────────────────────────────────────

#[test]
fn redeem_single_rejects_reentry() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let ngn = CurrencyCode::new(&env, "NGN");
    seed(&ctx, &ngn);
    ctx.acbu_token.mint(&ctx.user, &AMOUNT);
    hold_guard(&ctx);

    let res =
        ctx.burning
            .try_redeem_single(&ctx.user, &Address::generate(&env), &AMOUNT, &ngn, &None);
    assert_eq!(res, Err(Ok(reentrant())));
    assert_eq!(ctx.acbu_token.balance(&ctx.user), AMOUNT, "nothing burned");
}

#[test]
fn redeem_basket_rejects_reentry() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let (ngn, kes) = (CurrencyCode::new(&env, "NGN"), CurrencyCode::new(&env, "KES"));
    ctx.oracle
        .set_currencies(&vec![&env, ngn.clone(), kes.clone()]);
    let mut weights = Map::new(&env);
    weights.set(ngn.clone(), 5000);
    weights.set(kes.clone(), 5000);
    ctx.oracle.set_weights(&weights);
    seed(&ctx, &ngn);
    seed(&ctx, &kes);
    ctx.acbu_token.mint(&ctx.user, &AMOUNT);
    hold_guard(&ctx);

    let recipients = vec![&env, Address::generate(&env), Address::generate(&env)];
    let res = ctx
        .burning
        .try_redeem_basket(&ctx.user, &recipients, &AMOUNT, &None);
    assert_eq!(res, Err(Ok(reentrant())));
}

#[test]
fn redeem_basket_rejects_reentry_before_validation() {
    let env = Env::default();
    let ctx = setup_test(&env);
    hold_guard(&ctx);

    let recipients = soroban_sdk::Vec::new(&env);
    let res = ctx
        .burning
        .try_redeem_basket(&ctx.user, &recipients, &AMOUNT, &None);
    assert_eq!(res, Err(Ok(reentrant())));
}

// ── Cross-function reentrancy tests (W11-CAR-010) ───────────────────────────
//
// Both redeem_single and redeem_basket use the SAME reentrancy guard storage
// key. These tests prove that holding the guard from one path blocks entry
// into the other — i.e. a malicious token/oracle callback that tries to call
// the sibling redemption function while one is in flight is rejected.

/// Guard held by redeem_basket's critical section → redeem_single is blocked.
#[test]
fn redeem_single_blocked_while_basket_guard_held() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let ngn = CurrencyCode::new(&env, "NGN");
    seed(&ctx, &ngn);
    ctx.acbu_token.mint(&ctx.user, &AMOUNT);

    // Simulate redeem_basket holding the shared guard mid-execution.
    hold_guard(&ctx);

    let res =
        ctx.burning
            .try_redeem_single(&ctx.user, &Address::generate(&env), &AMOUNT, &ngn, &None);
    assert_eq!(
        res,
        Err(Ok(reentrant())),
        "redeem_single must be blocked while basket guard is held"
    );
    assert_eq!(ctx.acbu_token.balance(&ctx.user), AMOUNT, "nothing burned");
}

/// Guard held by redeem_single's critical section → redeem_basket is blocked.
#[test]
fn redeem_basket_blocked_while_single_guard_held() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let (ngn, kes) = (CurrencyCode::new(&env, "NGN"), CurrencyCode::new(&env, "KES"));
    ctx.oracle
        .set_currencies(&vec![&env, ngn.clone(), kes.clone()]);
    let mut weights = Map::new(&env);
    weights.set(ngn.clone(), 5000);
    weights.set(kes.clone(), 5000);
    ctx.oracle.set_weights(&weights);
    seed(&ctx, &ngn);
    seed(&ctx, &kes);
    ctx.acbu_token.mint(&ctx.user, &AMOUNT);

    // Simulate redeem_single holding the shared guard mid-execution.
    hold_guard(&ctx);

    let recipients = vec![&env, Address::generate(&env), Address::generate(&env)];
    let res = ctx
        .burning
        .try_redeem_basket(&ctx.user, &recipients, &AMOUNT, &None);
    assert_eq!(
        res,
        Err(Ok(reentrant())),
        "redeem_basket must be blocked while single guard is held"
    );
}

// ── Guard release tests ──────────────────────────────────────────────────────

#[test]
fn redeem_single_releases_guard() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let ngn = CurrencyCode::new(&env, "NGN");
    seed(&ctx, &ngn);
    ctx.acbu_token.mint(&ctx.user, &(2 * AMOUNT));

    for _ in 0..2 {
        ctx.burning
            .redeem_single(&ctx.user, &Address::generate(&env), &AMOUNT, &ngn, &None);
        assert!(!guard_active(&ctx), "guard released after redeem_single");
    }
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0);
}

/// Mirrors redeem_single_releases_guard: proves redeem_basket also releases
/// the shared guard on successful completion (W11-CAR-010).
#[test]
fn redeem_basket_releases_guard() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let ngn = CurrencyCode::new(&env, "NGN");
    ctx.oracle
        .set_currencies(&vec![&env, ngn.clone()]);
    let mut weights = Map::new(&env);
    weights.set(ngn.clone(), 10_000);
    ctx.oracle.set_weights(&weights);
    seed(&ctx, &ngn);
    ctx.acbu_token.mint(&ctx.user, &(2 * AMOUNT));

    for _ in 0..2 {
        let recipients = vec![&env, Address::generate(&env)];
        ctx.burning
            .redeem_basket(&ctx.user, &recipients, &AMOUNT, &None);
        assert!(!guard_active(&ctx), "guard released after redeem_basket");
    }
    assert_eq!(ctx.acbu_token.balance(&ctx.user), 0);
}
