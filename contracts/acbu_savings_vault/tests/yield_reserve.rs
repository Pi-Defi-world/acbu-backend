// AC-007: yield is paid only from an explicitly funded reserve, never from
// other depositors' principal.

use acbu_savings_vault::{Error, SavingsVault, SavingsVaultClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, Env};

const YEAR: u64 = 31_536_000;
const PRINCIPAL: i128 = 10_000_000;
/// 10% APR on PRINCIPAL for one year.
const ONE_YEAR_YIELD: i128 = 1_000_000;

struct Ctx {
    env: Env,
    admin: Address,
    alice: Address,
    bob: Address,
    token: TokenClient<'static>,
    sac: StellarAssetClient<'static>,
    vault: SavingsVaultClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let vault = SavingsVaultClient::new(&env, &env.register_contract(None, SavingsVault));
    // No deposit fee, 10% APR.
    vault.initialize(&admin, &token_id, &0, &1_000);
    Ctx {
        admin,
        alice: Address::generate(&env),
        bob: Address::generate(&env),
        token: TokenClient::new(&env, &token_id),
        sac: StellarAssetClient::new(&env, &token_id),
        vault,
        env,
    }
}

impl Ctx {
    fn deposit(&self, user: &Address, amount: i128, term: u64) {
        self.sac.mint(user, &amount);
        self.vault.deposit(user, &amount, &term);
    }

    fn fund(&self, amount: i128) {
        self.sac.mint(&self.admin, &amount);
        self.vault.fund_yield_reserve(&self.admin, &amount);
    }

    fn advance(&self, secs: u64) {
        self.env.ledger().with_mut(|l| l.timestamp += secs);
    }
}

/// The core exploit: with no reserve, an early withdrawer used to be paid
/// yield out of another depositor's principal.
#[test]
fn unfunded_yield_never_touches_other_depositors_principal() {
    let ctx = setup();
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    ctx.deposit(&ctx.bob, PRINCIPAL, YEAR);
    ctx.advance(YEAR);

    let paid = ctx.vault.withdraw(&ctx.alice, &YEAR, &PRINCIPAL);
    assert_eq!(paid, PRINCIPAL, "only principal is paid without a reserve");
    assert_eq!(ctx.token.balance(&ctx.alice), PRINCIPAL);
    assert_eq!(ctx.vault.get_owed_yield(&ctx.alice), ONE_YEAR_YIELD);

    // Bob's principal is fully intact and withdrawable.
    assert_eq!(ctx.token.balance(&ctx.vault.address), PRINCIPAL);
    ctx.vault.withdraw(&ctx.bob, &YEAR, &PRINCIPAL);
    assert_eq!(ctx.token.balance(&ctx.bob), PRINCIPAL);
    assert_eq!(ctx.token.balance(&ctx.vault.address), 0);
}

#[test]
fn raw_transfers_to_vault_are_not_yield() {
    let ctx = setup();
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    // Tokens sent to the vault by plain transfer are indistinguishable from
    // principal, so they must not fund yield.
    ctx.sac.mint(&ctx.vault.address, &ONE_YEAR_YIELD);
    ctx.advance(YEAR);

    assert_eq!(ctx.vault.withdraw(&ctx.alice, &YEAR, &PRINCIPAL), PRINCIPAL);
    assert_eq!(ctx.vault.get_yield_reserve(), 0);
    assert_eq!(ctx.vault.get_owed_yield(&ctx.alice), ONE_YEAR_YIELD);
}

#[test]
fn funded_reserve_pays_full_yield() {
    let ctx = setup();
    ctx.fund(ONE_YEAR_YIELD);
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    assert_eq!(ctx.vault.get_total_principal(), PRINCIPAL);
    ctx.advance(YEAR);

    let paid = ctx.vault.withdraw(&ctx.alice, &YEAR, &PRINCIPAL);
    assert_eq!(paid, PRINCIPAL + ONE_YEAR_YIELD);
    assert_eq!(ctx.token.balance(&ctx.alice), PRINCIPAL + ONE_YEAR_YIELD);
    assert_eq!(ctx.vault.get_yield_reserve(), 0);
    assert_eq!(ctx.vault.get_total_principal(), 0);
    assert_eq!(ctx.vault.get_owed_yield(&ctx.alice), 0);
}

#[test]
fn partial_reserve_pays_what_it_can_and_records_the_rest() {
    let ctx = setup();
    ctx.fund(400_000);
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    ctx.advance(YEAR);

    let paid = ctx.vault.withdraw(&ctx.alice, &YEAR, &PRINCIPAL);
    assert_eq!(paid, PRINCIPAL + 400_000);
    assert_eq!(ctx.vault.get_owed_yield(&ctx.alice), 600_000);
    assert_eq!(ctx.vault.get_total_owed_yield(), 600_000);
    assert_eq!(ctx.vault.get_yield_reserve(), 0);
}

#[test]
fn owed_yield_is_claimable_once_funded() {
    let ctx = setup();
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    ctx.advance(YEAR);
    ctx.vault.withdraw(&ctx.alice, &YEAR, &PRINCIPAL);

    assert_eq!(ctx.vault.try_claim_yield(&ctx.alice), Err(Ok(Error::InsufficientYieldReserve.into())));

    ctx.fund(250_000);
    assert_eq!(ctx.vault.claim_yield(&ctx.alice), 250_000);
    assert_eq!(ctx.vault.get_owed_yield(&ctx.alice), 750_000);

    ctx.fund(1_000_000);
    assert_eq!(ctx.vault.claim_yield(&ctx.alice), 750_000);
    assert_eq!(ctx.vault.get_owed_yield(&ctx.alice), 0);
    assert_eq!(ctx.vault.get_total_owed_yield(), 0);
    assert_eq!(ctx.token.balance(&ctx.alice), PRINCIPAL + ONE_YEAR_YIELD);
    assert_eq!(ctx.vault.get_yield_reserve(), 250_000);

    assert_eq!(ctx.vault.try_claim_yield(&ctx.alice), Err(Ok(Error::NothingToClaim.into())));
}

#[test]
fn admin_can_only_withdraw_unowed_reserve() {
    let ctx = setup();
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    ctx.advance(YEAR);
    ctx.vault.withdraw(&ctx.alice, &YEAR, &PRINCIPAL); // 1_000_000 owed

    ctx.fund(1_500_000);
    let treasury = Address::generate(&ctx.env);
    assert_eq!(
        ctx.vault.try_withdraw_yield_reserve(&treasury, &500_001),
        Err(Ok(Error::InsufficientYieldReserve.into()))
    );
    ctx.vault.withdraw_yield_reserve(&treasury, &500_000);
    assert_eq!(ctx.token.balance(&treasury), 500_000);
    assert_eq!(ctx.vault.claim_yield(&ctx.alice), ONE_YEAR_YIELD);
}

#[test]
fn admin_cannot_withdraw_principal_as_reserve() {
    let ctx = setup();
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    assert_eq!(
        ctx.vault
            .try_withdraw_yield_reserve(&Address::generate(&ctx.env), &1),
        Err(Ok(Error::InsufficientYieldReserve.into()))
    );
    assert_eq!(ctx.token.balance(&ctx.vault.address), PRINCIPAL);
}

#[test]
fn fund_yield_reserve_rejects_non_positive_amount() {
    let ctx = setup();
    assert_eq!(ctx.vault.try_fund_yield_reserve(&ctx.admin, &0), Err(Ok(Error::InvalidAmount.into())));
}

/// Vault balance always covers principal + reserve after every operation.
#[test]
fn solvency_invariant_holds() {
    let ctx = setup();
    let check = || {
        assert!(
            ctx.token.balance(&ctx.vault.address)
                >= ctx.vault.get_total_principal() + ctx.vault.get_yield_reserve()
        );
    };
    ctx.fund(300_000);
    check();
    ctx.deposit(&ctx.alice, PRINCIPAL, YEAR);
    ctx.deposit(&ctx.bob, PRINCIPAL, 2 * YEAR);
    check();
    ctx.advance(YEAR);
    ctx.vault.withdraw(&ctx.alice, &YEAR, &(PRINCIPAL / 2));
    check();
    ctx.vault.withdraw(&ctx.alice, &YEAR, &(PRINCIPAL / 2));
    check();
    ctx.advance(YEAR);
    ctx.vault.withdraw(&ctx.bob, &(2 * YEAR), &PRINCIPAL);
    check();
    assert_eq!(ctx.vault.get_total_principal(), 0);
}
