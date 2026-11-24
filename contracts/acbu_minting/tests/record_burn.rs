// AC-005: the burning contract reports burns via `record_burn` so the minting
// supply tracker follows the real token supply instead of only ever growing.

use acbu_minting::{MintingConfig, MintingContract, MintingContractClient, MintingError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, Error};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn set_total_supply(env: Env, supply: i128) {
        env.storage()
            .instance()
            .set(&symbol_short!("SUPPLY"), &supply);
    }

    pub fn get_total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("SUPPLY"))
            .unwrap_or(0)
    }
}

struct Ctx {
    env: Env,
    client: MintingContractClient<'static>,
    token: MockTokenClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    let token = MockTokenClient::new(&env, &env.register_contract(None, MockToken));
    let id = env.register_contract(None, MintingContract);
    let client = MintingContractClient::new(&env, &id);
    client.initialize(&MintingConfig {
        admin: Address::generate(&env),
        oracle: Address::generate(&env),
        reserve_tracker: Address::generate(&env),
        acbu_token: token.address.clone(),
        usdc_token: Address::generate(&env),
        vault: Address::generate(&env),
        treasury: Address::generate(&env),
        fee_rate_bps: 30,
        fee_single_bps: 100,
        operator: Address::generate(&env),
        operator_pub_key: BytesN::from_array(&env, &[0u8; 32]),
    });
    Ctx { env, client, token }
}

/// Seed the tracked supply through the admin reconciliation path.
fn seed_supply(ctx: &Ctx, supply: i128) {
    ctx.token.set_total_supply(&supply);
    ctx.client.sync_supply(&supply);
}

fn err(e: MintingError) -> Error {
    Error::from_contract_error(e as u32)
}

#[test]
fn record_burn_decrements_tracked_supply() {
    let ctx = setup();
    ctx.client
        .set_burning_contract(&Address::generate(&ctx.env));
    seed_supply(&ctx, 1_000);

    ctx.client.record_burn(&400);
    assert_eq!(ctx.client.get_total_supply(), 600);
    ctx.client.record_burn(&600);
    assert_eq!(ctx.client.get_total_supply(), 0);
}

#[test]
fn record_burn_frees_supply_cap_headroom() {
    let ctx = setup();
    ctx.client
        .set_burning_contract(&Address::generate(&ctx.env));
    ctx.client.set_max_supply(&1_000);
    seed_supply(&ctx, 1_000);

    ctx.client.record_burn(&250);
    assert!(ctx.client.get_total_supply() + 250 <= ctx.client.get_max_supply());
}

#[test]
fn record_burn_saturates_at_zero() {
    let ctx = setup();
    ctx.client
        .set_burning_contract(&Address::generate(&ctx.env));
    seed_supply(&ctx, 100);

    ctx.client.record_burn(&500);
    assert_eq!(ctx.client.get_total_supply(), 0);
}

#[test]
fn record_burn_requires_linked_burning_contract() {
    let ctx = setup();
    assert_eq!(ctx.client.get_burning_contract(), None);
    assert_eq!(
        ctx.client.try_record_burn(&1),
        Err(Ok(err(MintingError::BurningContractNotSet)))
    );
}

#[test]
fn record_burn_rejects_non_positive_amount() {
    let ctx = setup();
    ctx.client
        .set_burning_contract(&Address::generate(&ctx.env));
    let invalid = Err(Ok(err(MintingError::InvalidBurnAmount)));
    assert_eq!(ctx.client.try_record_burn(&0), invalid);
    assert_eq!(ctx.client.try_record_burn(&-1), invalid);
}

#[test]
fn record_burn_requires_burning_contract_auth() {
    let ctx = setup();
    let burning = Address::generate(&ctx.env);
    ctx.client.set_burning_contract(&burning);
    assert_eq!(ctx.client.get_burning_contract(), Some(burning));
    seed_supply(&ctx, 1_000);

    ctx.env.set_auths(&[]);
    assert!(ctx.client.try_record_burn(&400).is_err());
    assert_eq!(ctx.client.get_total_supply(), 1_000);
}

#[test]
fn record_burn_works_while_paused() {
    let ctx = setup();
    ctx.client
        .set_burning_contract(&Address::generate(&ctx.env));
    seed_supply(&ctx, 1_000);
    ctx.client.pause();

    ctx.client.record_burn(&400);
    assert_eq!(ctx.client.get_total_supply(), 600);
}
