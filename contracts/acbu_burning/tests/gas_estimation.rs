#![cfg(test)]

#[path = "common/mod.rs"]
mod common;

use common::{create_stoken, setup_test};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{
    testutils::{budget::Budget, Address as _},
    Address, Env, Map, Vec,
};

const MAX_BASKET_REDEEM_CPU: u64 = 80_000_000;
const MAX_BASKET_REDEEM_MEM: u64 = 10_000_000;

#[test]
fn gas_redeem_basket_five_currency_path_stays_under_budget() {
    let env = Env::default();
    let ctx = setup_test(&env);

    let currency_codes = ["NGN", "KES", "RWF", "GHS", "ZAR"];
    let mut currencies: Vec<CurrencyCode> = Vec::new(&env);
    let mut weights: Map<CurrencyCode, i128> = Map::new(&env);
    let mut recipients = Vec::new(&env);

    for code in currency_codes {
        let currency = CurrencyCode::new(&env, code);
        currencies.push_back(currency.clone());
        weights.set(currency.clone(), 2_000i128);
        recipients.push_back(Address::generate(&env));

        let (stoken_id, stoken, stoken_sac) = create_stoken(&env, &ctx.admin);
        ctx.oracle.set_stoken(&currency, &stoken_id);
        ctx.oracle.set_currency_rate(&currency, &DECIMALS);
        ctx.oracle
            .set_timestamp(&currency, &env.ledger().timestamp());

        let vault_amount = 1_000 * DECIMALS;
        stoken_sac.mint(&ctx.vault, &vault_amount);
        stoken.approve(&ctx.vault, &ctx.burning_id, &vault_amount, &500u32);
    }

    ctx.oracle.set_currencies(&currencies);
    ctx.oracle.set_weights(&weights);
    ctx.oracle
        .set_acbu_rate(&DECIMALS, &env.ledger().timestamp());

    let burn_amount = 100 * DECIMALS;
    ctx.acbu_token.mint(&ctx.user, &burn_amount);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let amounts = ctx
        .burning
        .redeem_basket(&ctx.user, &recipients, &burn_amount);

    assert_eq!(amounts.len(), currency_codes.len() as u32, "amounts.len() should equal currency_codes.len() as u32");
    for i in 0..amounts.len() {
        assert_eq!(
            amounts.get(i).unwrap(),
            198_000_000,
            "gas scenario must execute each five-currency basket transfer leg"
        );
    }

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(cpu > 0, "budget tracker did not record CPU usage");
    assert!(mem > 0, "budget tracker did not record memory usage");

    eprintln!(
        "basket redeem budget: cpu={cpu}/{MAX_BASKET_REDEEM_CPU}, mem={mem}/{MAX_BASKET_REDEEM_MEM}"
    );

    assert!(
        cpu <= MAX_BASKET_REDEEM_CPU,
        "basket redeem CPU budget regression: consumed {cpu}, limit {MAX_BASKET_REDEEM_CPU}"
    );
    assert!(
        mem <= MAX_BASKET_REDEEM_MEM,
        "basket redeem memory budget regression: consumed {mem}, limit {MAX_BASKET_REDEEM_MEM}"
    );
}
