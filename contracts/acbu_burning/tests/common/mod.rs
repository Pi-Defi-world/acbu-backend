#![cfg(test)]

use acbu_burning::{BurningContract, BurningContractClient};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Map, Vec};

// --- Mocks ---

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_acbu_usd_rate(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("acbu_rt"))
            .unwrap_or(DECIMALS)
    }

    pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
        let rate = env
            .storage()
            .instance()
            .get(&symbol_short!("acbu_rt"))
            .unwrap_or(DECIMALS);
        let ts = env
            .storage()
            .instance()
            .get(&symbol_short!("acbu_ts"))
            .unwrap_or(env.ledger().timestamp());
        (rate, ts)
    }

    pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
        env.storage()
            .instance()
            .get(&symbol_short!("currs"))
            .unwrap_or_else(|| {
                let mut v = Vec::new(&env);
                v.push_back(CurrencyCode::new(&env, "NGN"));
                v.push_back(CurrencyCode::new(&env, "KES"));
                v
            })
    }

    pub fn get_basket_weight(env: Env, c: CurrencyCode) -> i128 {
        let weights: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("weights"))
            .unwrap_or_else(|| Map::new(&env));
        weights.get(c).unwrap_or(5000)
    }

    pub fn get_rate(env: Env, c: CurrencyCode) -> i128 {
        let rates: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("rates"))
            .unwrap_or_else(|| Map::new(&env));
        rates.get(c).unwrap_or(DECIMALS)
    }

    pub fn get_rate_with_timestamp(env: Env, c: CurrencyCode) -> (i128, u64) {
        let rates: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("rates"))
            .unwrap_or_else(|| Map::new(&env));
        let rate = rates.get(c.clone()).unwrap_or(DECIMALS);
        let ts_map: Map<CurrencyCode, u64> = env
            .storage()
            .instance()
            .get(&symbol_short!("rate_ts"))
            .unwrap_or_else(|| Map::new(&env));
        let ts = ts_map.get(c).unwrap_or(0); // Default to 0 for stale test
        (rate, ts)
    }

    pub fn get_s_token_address(env: Env, c: CurrencyCode) -> Address {
        let tokens: Map<CurrencyCode, Address> = env
            .storage()
            .instance()
            .get(&symbol_short!("tokens"))
            .unwrap_or_else(|| Map::new(&env));
        tokens.get(c).expect("stoken not seeded")
    }

    // Helper methods for testing
    pub fn set_acbu_rate(env: Env, rate: i128, timestamp: u64) {
        env.storage()
            .instance()
            .set(&symbol_short!("acbu_rt"), &rate);
        env.storage()
            .instance()
            .set(&symbol_short!("acbu_ts"), &timestamp);
    }

    pub fn set_currency_rate(env: Env, c: CurrencyCode, rate: i128) {
        let mut rates: Map<CurrencyCode, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("rates"))
            .unwrap_or_else(|| Map::new(&env));
        rates.set(c, rate);
        env.storage()
            .instance()
            .set(&symbol_short!("rates"), &rates);
    }

    pub fn set_stoken(env: Env, c: CurrencyCode, token: Address) {
        let mut tokens: Map<CurrencyCode, Address> = env
            .storage()
            .instance()
            .get(&symbol_short!("tokens"))
            .unwrap_or_else(|| Map::new(&env));
        tokens.set(c, token);
        env.storage()
            .instance()
            .set(&symbol_short!("tokens"), &tokens);
    }

    pub fn set_currencies(env: Env, currs: Vec<CurrencyCode>) {
        env.storage()
            .instance()
            .set(&symbol_short!("currs"), &currs);
    }

    pub fn set_weights(env: Env, weights: Map<CurrencyCode, i128>) {
        env.storage()
            .instance()
            .set(&symbol_short!("weights"), &weights);
    }

    pub fn set_timestamp(env: Env, c: CurrencyCode, ts: u64) {
        let mut ts_map: Map<CurrencyCode, u64> = env
            .storage()
            .instance()
            .get(&symbol_short!("rate_ts"))
            .unwrap_or_else(|| Map::new(&env));
        ts_map.set(c, ts);
        env.storage()
            .instance()
            .set(&symbol_short!("rate_ts"), &ts_map);
    }
}

#[contract]
pub struct MockReserveTracker;

#[contractimpl]
impl MockReserveTracker {
    pub fn is_reserve_sufficient(env: Env, _supply: i128) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("ok"))
            .unwrap_or(true)
    }

    pub fn set_reserve_ok(env: Env, ok: bool) {
        env.storage().instance().set(&symbol_short!("ok"), &ok);
    }
}

#[contract]
pub struct MockACBUToken;

#[contractimpl]
impl MockACBUToken {
    pub fn get_total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("supply"))
            .unwrap_or(0)
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let supply = Self::get_total_supply(env.clone());
        env.storage()
            .instance()
            .set(&symbol_short!("supply"), &(supply - amount));
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("bal"))
            .unwrap_or_else(|| Map::new(&env));
        let bal = balances.get(from.clone()).unwrap_or(0);
        balances.set(from, bal.saturating_sub(amount));
        env.storage()
            .instance()
            .set(&symbol_short!("bal"), &balances);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let supply = Self::get_total_supply(env.clone());
        env.storage()
            .instance()
            .set(&symbol_short!("supply"), &(supply + amount));

        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("bal"))
            .unwrap_or_else(|| Map::new(&env));
        let bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(to, bal + amount);
        env.storage()
            .instance()
            .set(&symbol_short!("bal"), &balances);
    }

    pub fn balance(env: Env, addr: Address) -> i128 {
        let balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&symbol_short!("bal"))
            .unwrap_or_else(|| Map::new(&env));
        balances.get(addr).unwrap_or(0)
    }
}

#[allow(dead_code)]
pub struct TestContext {
    pub env: Env,
    pub admin: Address,
    pub user: Address,
    pub vault: Address,
    pub oracle_id: Address,
    pub oracle: MockOracleClient<'static>,
    pub reserve_tracker_id: Address,
    pub reserve_tracker: MockReserveTrackerClient<'static>,
    pub acbu_token_id: Address,
    pub acbu_token: MockACBUTokenClient<'static>,
    pub burning_id: Address,
    pub burning: BurningContractClient<'static>,
}

pub fn setup_test(env: &Env) -> TestContext {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let user = Address::generate(env);
    let vault = Address::generate(env);

    let oracle_id = env.register_contract(None, MockOracle);
    let oracle = MockOracleClient::new(env, &oracle_id);

    let reserve_tracker_id = env.register_contract(None, MockReserveTracker);
    let reserve_tracker = MockReserveTrackerClient::new(env, &reserve_tracker_id);

    let acbu_token_id = env.register_contract(None, MockACBUToken);
    let acbu_token = MockACBUTokenClient::new(env, &acbu_token_id);

    let burning_id = env.register_contract(None, BurningContract);
    let burning = BurningContractClient::new(env, &burning_id);

    burning.initialize(
        &admin,
        &oracle_id,
        &reserve_tracker_id,
        &acbu_token_id,
        &Address::generate(env), // withdrawal processor
        &vault,
        &100, // basket fee 1%
        &200, // single fee 2%
    );

    TestContext {
        env: env.clone(),
        admin,
        user,
        vault,
        oracle_id,
        oracle,
        reserve_tracker_id,
        reserve_tracker,
        acbu_token_id,
        acbu_token,
        burning_id,
        burning,
    }
}

pub fn create_stoken(
    env: &Env,
    admin: &Address,
) -> (
    Address,
    soroban_sdk::token::Client<'static>,
    soroban_sdk::token::StellarAssetClient<'static>,
) {
    let id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let client = soroban_sdk::token::Client::new(env, &id);
    let sac = soroban_sdk::token::StellarAssetClient::new(env, &id);
    (id, client, sac)
}
