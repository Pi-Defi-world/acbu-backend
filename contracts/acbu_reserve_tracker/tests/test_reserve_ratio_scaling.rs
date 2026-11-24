#![cfg(test)]

//! AC-002: `is_reserve_sufficient` must value ACBU supply in the same 7-decimal
//! USD units as reserve `value_usd`. Supply and the oracle ACBU/USD rate are both
//! 7-decimal, so the product is divided by `DECIMALS` (10^7), not 10^8.

use acbu_reserve_tracker::{ReserveTrackerContract, ReserveTrackerContractClient};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, Address, Env, Map,
};

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    /// 1 ACBU = 1 USD (7 decimals, as returned by the real oracle).
    pub fn get_acbu_usd_rate(_env: Env) -> i128 {
        DECIMALS
    }

    pub fn get_rate_with_timestamp(env: Env, currency: CurrencyCode) -> (i128, u64) {
        let rates: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("rates"))
            .unwrap_or(Map::new(&env));
        (rates.get(currency).unwrap_or(0), env.ledger().timestamp())
    }

    pub fn set_rate(env: Env, currency: CurrencyCode, rate: i128) {
        let mut rates: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("rates"))
            .unwrap_or(Map::new(&env));
        rates.set(currency, rate);
        env.storage()
            .instance()
            .set(&symbol_short!("rates"), &rates);
    }
}

#[test]
fn test_reserve_ratio_uses_seven_decimal_acbu_value() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle);
    let token = Address::generate(&env);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(&env, &contract_id);
    client.initialize(&admin, &oracle, &token, &10_000i128); // 100% min ratio

    // 10 USD of reserves: amount * rate / DECIMALS == 10 * DECIMALS.
    let ngn = CurrencyCode::new(&env, "NGN");
    oracle_client.set_rate(&ngn, &(100 * DECIMALS));
    client.update_reserve(&admin, &ngn, &(DECIMALS / 10), &(10 * DECIMALS));

    // 10 ACBU at 1 USD = 10 USD → exactly 100% backed.
    assert!(client.is_reserve_sufficient(&(10 * DECIMALS)));

    // 11 ACBU at 1 USD = 11 USD > 10 USD reserves → undercollateralized.
    // With the old 10^8 divisor this valued at 1.1 USD and wrongly passed.
    assert!(!client.is_reserve_sufficient(&(11 * DECIMALS)));

    // 100 ACBU = 100 USD → 10% backed; must fail.
    assert!(!client.is_reserve_sufficient(&(100 * DECIMALS)));
}
