#![cfg(test)]

use shared::{calculate_amount_after_fee, calculate_fee, DECIMALS};
use soroban_sdk::{contract, contractimpl, Address, Env};

// Minimal consumer contract A that asks an oracle (mocked here) for a rate
#[contract]
pub struct ConsumerA;

#[contractimpl]
impl ConsumerA {
    pub fn compute_net_after_fee(_env: Env, amount: i128, fee_bps: i128) -> i128 {
        calculate_amount_after_fee(amount, fee_bps)
    }
}

// Minimal consumer contract B that uses the same shared helpers
#[contract]
pub struct ConsumerB;

#[contractimpl]
impl ConsumerB {
    pub fn compute_fee(_env: Env, amount: i128, fee_bps: i128) -> i128 {
        calculate_fee(amount, fee_bps)
    }
}

#[test]
fn integration_rounding_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy both consumer contracts
    let a_id = env.register_contract(None, ConsumerA);
    let b_id = env.register_contract(None, ConsumerB);

    let a_client = ConsumerAClient::new(&env, &a_id);
    let b_client = ConsumerBClient::new(&env, &b_id);

    // Amounts that include small remainders to exercise rounding: e.g., 100 * DECIMALS + 3
    let amounts = [1 * DECIMALS, 100 * DECIMALS + 3, 7 * DECIMALS + 1];
    let fee_bps = 123; // 1.23%

    for &amt in amounts.iter() {
        let fee = b_client.compute_fee(&amt, &fee_bps);
        let net = a_client.compute_net_after_fee(&amt, &fee_bps);
        // fee + net must equal original amount
        assert_eq!(fee + net, amt, "fee + net should equal amt");
        // fee must match shared helper directly
        assert_eq!(fee, calculate_fee(amt, fee_bps), "fee should equal calculate_fee(amt, fee_bps)");
    }
}
