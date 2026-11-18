#![cfg(test)]

use acbu_oracle::{OracleContract, OracleContractClient};
use shared::CurrencyCode;
use soroban_sdk::{
    testutils::{budget::Budget, Address as _, Ledger},
    Address, Env, Map, Vec,
};

const MAX_MEDIAN_UPDATE_CPU: u64 = 15_000_000;
const MAX_MEDIAN_UPDATE_MEM: u64 = 4_000_000;

fn setup_oracle(env: &Env) -> (OracleContractClient<'static>, Address, CurrencyCode) {
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000_000;
        ledger.sequence_number = 100;
    });

    let admin = Address::generate(env);
    let validator = Address::generate(env);
    let validator2 = Address::generate(env);
    let validator3 = Address::generate(env);

    let mut validators = Vec::new(env);
    validators.push_back(validator.clone());
    validators.push_back(validator2);
    validators.push_back(validator3);

    let currency = CurrencyCode::new(env, "NGN");
    let mut currencies = Vec::new(env);
    currencies.push_back(currency.clone());

    let mut basket_weights = Map::new(env);
    basket_weights.set(currency.clone(), 10_000i128);

    let contract_id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(env, &contract_id);
    client.initialize(&admin, &validators, &2u32, &currencies, &basket_weights);

    (client, validator, currency)
}

fn source_rates(env: &Env) -> Vec<i128> {
    let mut sources = Vec::new(env);
    for rate in [
        990_000, 1_010_000, 1_000_000, 1_020_000, 980_000, 1_015_000, 985_000, 1_005_000, 995_000,
        1_025_000, 975_000,
    ] {
        sources.push_back(rate);
    }
    sources
}

#[test]
fn gas_update_rate_median_quorum_sources_stays_under_budget() {
    let env = Env::default();
    let (client, validator, currency) = setup_oracle(&env);
    let sources = source_rates(&env);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    client.update_rate(
        &validator,
        &currency,
        &1_000_000,
        &sources,
        &env.ledger().timestamp(),
    );

    assert_eq!(
        client.get_rate(&currency),
        1_000_000,
        "gas scenario must exercise and persist the median-derived rate"
    );

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(cpu > 0, "budget tracker did not record CPU usage");
    assert!(mem > 0, "budget tracker did not record memory usage");

    eprintln!(
        "oracle median update budget: cpu={cpu}/{MAX_MEDIAN_UPDATE_CPU}, mem={mem}/{MAX_MEDIAN_UPDATE_MEM}"
    );

    assert!(
        cpu <= MAX_MEDIAN_UPDATE_CPU,
        "oracle median update CPU budget regression: consumed {cpu}, limit {MAX_MEDIAN_UPDATE_CPU}"
    );
    assert!(
        mem <= MAX_MEDIAN_UPDATE_MEM,
        "oracle median update memory budget regression: consumed {mem}, limit {MAX_MEDIAN_UPDATE_MEM}"
    );
}
