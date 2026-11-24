#![cfg(test)]
// AC-005: every burn is reported to the minting contract so its tracked
// total supply follows the token instead of only ever growing.

#[path = "common/mod.rs"]
mod common;
use acbu_minting::{MintingConfig, MintingContract, MintingContractClient};
use common::{create_stoken, setup_test, TestContext};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{vec, Address, Env, IntoVal, Map};

/// Deploy the real minting contract over the test ACBU token and link it to
/// the burning contract in both directions.
fn link_minting(ctx: &TestContext) -> MintingContractClient<'static> {
    let env = &ctx.env;
    let minting = MintingContractClient::new(env, &env.register_contract(None, MintingContract));
    minting.initialize(&MintingConfig {
        admin: ctx.admin.clone(),
        oracle: ctx.oracle_id.clone(),
        reserve_tracker: ctx.reserve_tracker_id.clone(),
        acbu_token: ctx.acbu_token_id.clone(),
        usdc_token: Address::generate(env),
        vault: ctx.vault.clone(),
        treasury: Address::generate(env),
        fee_rate_bps: 30,
        fee_single_bps: 100,
        operator: Address::generate(env),
    });
    minting.set_burning_contract(&ctx.burning_id);
    ctx.burning.set_minting_contract(&minting.address);
    minting
}

/// Mint `amount` ACBU to the user and bring the minting tracker in line.
fn fund_user(ctx: &TestContext, minting: &MintingContractClient, amount: i128) {
    ctx.acbu_token.mint(&ctx.user, &amount);
    minting.sync_supply(&ctx.acbu_token.get_total_supply());
}

fn seed_single(ctx: &TestContext, currency: &CurrencyCode) {
    let env = &ctx.env;
    let (stoken_id, stoken, stoken_sac) = create_stoken(env, &ctx.admin);
    ctx.oracle.set_stoken(currency, &stoken_id);
    let vault_amount: i128 = 500 * DECIMALS;
    stoken_sac.mint(&ctx.vault, &vault_amount);
    stoken.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &200u32);
    let ts = env.ledger().timestamp();
    ctx.oracle.set_acbu_rate(&DECIMALS, &ts);
    ctx.oracle.set_currency_rate(currency, &DECIMALS);
    ctx.oracle.set_timestamp(currency, &ts);
}

#[test]
fn redeem_single_decrements_minting_supply() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let minting = link_minting(&ctx);
    let currency = CurrencyCode::new(&env, "NGN");
    seed_single(&ctx, &currency);

    fund_user(&ctx, &minting, 150 * DECIMALS);
    assert_eq!(minting.get_total_supply(), 150 * DECIMALS);

    let burn_amount = 100 * DECIMALS;
    ctx.burning
        .redeem_single(&ctx.user, &Address::generate(&env), &burn_amount, &currency, &None);

    assert_eq!(minting.get_total_supply(), 50 * DECIMALS);
    assert_eq!(minting.get_total_supply(), ctx.acbu_token.get_total_supply());
}

#[test]
fn redeem_basket_decrements_minting_supply() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let minting = link_minting(&ctx);

    let c1 = CurrencyCode::new(&env, "NGN");
    let c2 = CurrencyCode::new(&env, "KES");
    ctx.oracle
        .set_currencies(&vec![&env, c1.clone(), c2.clone()]);
    let mut weights = Map::new(&env);
    weights.set(c1.clone(), 5000);
    weights.set(c2.clone(), 5000);
    ctx.oracle.set_weights(&weights);
    seed_single(&ctx, &c1);
    seed_single(&ctx, &c2);

    fund_user(&ctx, &minting, 100 * DECIMALS);
    let recipients = vec![&env, Address::generate(&env), Address::generate(&env)];
    ctx.burning
        .redeem_basket(&ctx.user, &recipients, &(40 * DECIMALS), &None);

    assert_eq!(minting.get_total_supply(), 60 * DECIMALS);
    assert_eq!(minting.get_total_supply(), ctx.acbu_token.get_total_supply());
}

/// Only the user signs: the burning contract authorises `record_burn` as the
/// direct invoker, with no mocked auth for it.
#[test]
fn burn_notification_needs_no_extra_signature() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let minting = link_minting(&ctx);
    let currency = CurrencyCode::new(&env, "NGN");
    seed_single(&ctx, &currency);
    fund_user(&ctx, &minting, 100 * DECIMALS);

    let recipient = Address::generate(&env);
    let burn_amount = 100 * DECIMALS;
    let none: Option<i128> = None;
    env.mock_auths(&[MockAuth {
        address: &ctx.user,
        invoke: &MockAuthInvoke {
            contract: &ctx.burning_id,
            fn_name: "redeem_single",
            args: (ctx.user.clone(), recipient.clone(), burn_amount, currency.clone(), none)
                .into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &ctx.acbu_token_id,
                fn_name: "burn",
                args: (ctx.user.clone(), burn_amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    ctx.burning
        .redeem_single(&ctx.user, &recipient, &burn_amount, &currency, &none);

    assert_eq!(minting.get_total_supply(), 0);
}

#[test]
fn unlinked_minting_is_not_notified() {
    let env = Env::default();
    let ctx = setup_test(&env);
    assert_eq!(ctx.burning.get_minting_contract(), None);
    let currency = CurrencyCode::new(&env, "NGN");
    seed_single(&ctx, &currency);
    ctx.acbu_token.mint(&ctx.user, &(100 * DECIMALS));

    // No minting contract linked: redemption still succeeds.
    ctx.burning.redeem_single(
        &ctx.user,
        &Address::generate(&env),
        &(100 * DECIMALS),
        &currency,
        &None,
    );
    assert_eq!(ctx.acbu_token.get_total_supply(), 0);
}

/// A burning contract linked to a minting contract that has not linked it
/// back cannot redeem — the misconfiguration surfaces instead of drifting.
#[test]
fn one_sided_link_reverts_redemption() {
    let env = Env::default();
    let ctx = setup_test(&env);
    let minting = link_minting(&ctx);
    minting.set_burning_contract(&Address::generate(&env));
    let currency = CurrencyCode::new(&env, "NGN");
    seed_single(&ctx, &currency);
    fund_user(&ctx, &minting, 100 * DECIMALS);

    let recipient = Address::generate(&env);
    let burn_amount = 100 * DECIMALS;
    let none: Option<i128> = None;
    env.mock_auths(&[MockAuth {
        address: &ctx.user,
        invoke: &MockAuthInvoke {
            contract: &ctx.burning_id,
            fn_name: "redeem_single",
            args: (ctx.user.clone(), recipient.clone(), burn_amount, currency.clone(), none)
                .into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &ctx.acbu_token_id,
                fn_name: "burn",
                args: (ctx.user.clone(), burn_amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    assert!(ctx
        .burning
        .try_redeem_single(&ctx.user, &recipient, &burn_amount, &currency, &none)
        .is_err());
    assert_eq!(minting.get_total_supply(), 100 * DECIMALS);
}
