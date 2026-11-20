#![cfg(test)]

use acbu_minting::{FiatSettlementProof, MintingContract, MintingContractClient};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use shared::{CurrencyCode, DECIMALS};
use soroban_env_host::budget::AsBudget;
use soroban_sdk::testutils::StellarAssetContract;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::xdr::{
    AlphaNum4, AssetCode4, LedgerEntry, LedgerEntryData, LedgerEntryExt, LedgerKey,
    LedgerKeyTrustLine, ScAddress, TrustLineAsset, TrustLineEntry, TrustLineEntryExt,
    TrustLineFlags,
};
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String as SorobanString};
use std::rc::Rc;

// --- Mocks (reuse from test.rs) ---

mod oracle_mock {
    use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Vec};

    use shared::CurrencyCode;
    use super::DECIMALS;

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn get_acbu_usd_rate(_env: Env) -> i128 {
            DECIMALS
        }

        pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }

        pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
            let mut v = Vec::new(&env);
            v.push_back(CurrencyCode::new(&env, "NGN"));
            v
        }

        pub fn get_basket_weight(_env: Env, _c: CurrencyCode) -> i128 {
            10_000
        }

        pub fn get_rate(_env: Env, _c: CurrencyCode) -> i128 {
            DECIMALS
        }

        pub fn get_rate_with_timestamp(env: Env, _c: CurrencyCode) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }

        pub fn get_s_token_address(env: Env, _c: CurrencyCode) -> Address {
            env.storage()
                .instance()
                .get(&symbol_short!("STK"))
                .expect("seed_stoken not called in test")
        }

        pub fn seed_stoken(env: Env, stoken: Address) {
            env.storage().instance().set(&symbol_short!("STK"), &stoken);
        }
    }
}

mod reserve_mock {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockReserveTracker;

    #[contractimpl]
    impl MockReserveTracker {
        pub fn is_reserve_sufficient(_env: Env, _supply: i128) -> bool {
            true
        }
    }
}

fn oracle_mock_client<'a>(env: &'a Env, oracle: &'a Address) -> oracle_mock::MockOracleClient<'a> {
    oracle_mock::MockOracleClient::new(env, oracle)
}

fn setup_test(
    env: &Env,
) -> (
    Address,
    Address,
    Address,
    Address,
    Address,
    MintingContractClient,
) {
    let admin = Address::generate(env);
    let oracle = env.register_contract(None, oracle_mock::MockOracle);
    let reserve_tracker = env.register_contract(None, reserve_mock::MockReserveTracker);

    let contract_id = env.register_contract(None, MintingContract);
    let acbu_sac = env.register_stellar_asset_contract_v2(contract_id.clone());
    let acbu_token = acbu_sac.address();

    let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc_token = usdc_sac.address();

    let client = MintingContractClient::new(env, &contract_id);

    // C-058 recipients are ed25519 accounts; SAC mint needs their trustline.
    establish_trustline(env, &account(env), &acbu_sac);
    establish_trustline(env, &account(env), &usdc_sac);

    (
        admin,
        oracle,
        reserve_tracker,
        acbu_token,
        usdc_token,
        client,
    )
}

/// C-058 requires ed25519-account recipients, but the SAC rejects mints to
/// accounts without a trustline (host `TrustlineMissingError`). Test-only:
/// create the trustline directly in host storage.
fn establish_trustline(env: &Env, holder: &Address, sac: &StellarAssetContract) {
    let holder_account = match ScAddress::from(holder.clone()) {
        ScAddress::Account(id) => id,
        _ => panic!("holder must be an account address"),
    };
    let issuer_account = match ScAddress::from(sac.issuer().address()) {
        ScAddress::Account(id) => id,
        _ => panic!("issuer must be an account address"),
    };
    let asset = TrustLineAsset::CreditAlphanum4(AlphaNum4 {
        asset_code: AssetCode4([b'a', b'a', b'a', 0]),
        issuer: issuer_account,
    });
    let key = Rc::new(LedgerKey::Trustline(LedgerKeyTrustLine {
        account_id: holder_account.clone(),
        asset: asset.clone(),
    }));
    let entry = Rc::new(LedgerEntry {
        last_modified_ledger_seq: 0,
        data: LedgerEntryData::Trustline(TrustLineEntry {
            account_id: holder_account,
            asset,
            balance: 0,
            limit: i64::MAX,
            flags: TrustLineFlags::AuthorizedFlag as u32,
            ext: TrustLineEntryExt::V0,
        }),
        ext: LedgerEntryExt::V0,
    });
    env.host()
        .with_mut_storage(|storage| {
            storage.put(&key, &entry, None, AsBudget::as_budget(env.host()))
        })
        .unwrap();
}

/// AC-038: Initialize the minting contract, returning the operator ed25519
/// `SigningKey` that was registered as `operator_pub_key`.  Tests that call
/// `mint_from_fiat` must use `make_fiat_proof` with this key.
fn init_mint_client(
    env: &Env,
    client: &MintingContractClient,
    admin: &Address,
    oracle: &Address,
    reserve_tracker: &Address,
    acbu_token: &Address,
    usdc_token: &Address,
    vault: &Address,
    treasury: &Address,
    fee_rate: i128,
    fee_single: i128,
) -> SigningKey {
    let signing_key = SigningKey::generate(&mut OsRng);
    let pub_key_bytes = signing_key.verifying_key().to_bytes();
    let pub_key: BytesN<32> = BytesN::from_array(env, &pub_key_bytes);
    let config = acbu_minting::MintingConfig {
        admin: admin.clone(),
        oracle: oracle.clone(),
        reserve_tracker: reserve_tracker.clone(),
        acbu_token: acbu_token.clone(),
        usdc_token: usdc_token.clone(),
        vault: vault.clone(),
        treasury: treasury.clone(),
        fee_rate_bps: fee_rate,
        fee_single_bps: fee_single,
        // initialize rejects admin == operator (#5024); every test calls
        // set_operator right after init, so a placeholder is sufficient.
        operator: Address::generate(env),
        operator_pub_key: pub_key,
    };
    client.initialize(&config);
    signing_key
}

/// AC-038: Build a valid `FiatSettlementProof` for `mint_from_fiat` tests.
///
/// Replicates the commitment message encoding from `verify_fiat_settlement_proof`
/// in `acbu_minting/src/lib.rs`:
///   sha256( XDR(fintech_tx_id) ++ XDR(recipient) ++ XDR(fiat_amount)
///           ++ XDR(currency)   ++ XDR(ledger_timestamp) )
fn make_fiat_proof(
    env: &Env,
    signing_key: &SigningKey,
    fintech_tx_id: &SorobanString,
    recipient: &Address,
    fiat_amount: i128,
    currency: &CurrencyCode,
) -> FiatSettlementProof {
    let mut preimage = Bytes::new(env);
    preimage.append(&fintech_tx_id.to_xdr(env));
    preimage.append(&recipient.to_xdr(env));
    preimage.append(&fiat_amount.to_xdr(env));
    preimage.append(&currency.to_xdr(env));
    preimage.append(&env.ledger().timestamp().to_xdr(env));

    let digest = env.crypto().sha256(&preimage);
    let message_bytes: std::vec::Vec<u8> = digest.to_array().to_vec();

    let sig_bytes = signing_key.sign(&message_bytes).to_bytes();
    let pub_key_bytes = signing_key.verifying_key().to_bytes();

    FiatSettlementProof {
        pub_key: BytesN::from_array(env, &pub_key_bytes),
        signature: BytesN::from_array(env, &sig_bytes),
    }
}

/// Produce a dummy proof (zeroed sig) for tests that should panic *before*
/// proof verification is reached (e.g. wrong operator, empty tx_id).
fn dummy_proof(env: &Env) -> FiatSettlementProof {
    FiatSettlementProof {
        pub_key: BytesN::from_array(env, &[0u8; 32]),
        signature: BytesN::from_array(env, &[0u8; 64]),
    }
}

// --- Tests for mint_from_fiat: Access Control and Validation ---

/// C-058 requires recipients to be ed25519 accounts (`G...`), but
/// `Address::generate` yields contract addresses (`C...`) in SDK 21.
fn account(env: &Env) -> Address {
    Address::from_string(&SorobanString::from_str(
        env,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    ))
}

#[test]
fn test_mint_from_fiat_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let signing_key = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_001");
    let currency = CurrencyCode::new(&env, "NGN");
    let proof = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &recipient, fiat_amount, &currency);
    let acbu = client.mint_from_fiat(
        &operator,
        &recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof,
    );

    assert!(acbu > 0);
    let acbu_client = soroban_sdk::token::Client::new(&env, &acbu_token_id);
    assert_eq!(acbu_client.balance(&recipient), acbu, "acbu_client.balance(&recipient) should equal acbu");
    // AC-009 (#732): total supply must include the treasury fee mint.
    let expected_fee = shared::calculate_fee(50 * DECIMALS, 50).unwrap();
    assert!(expected_fee > 0, "fee must be positive for this scenario");
    assert_eq!(
        client.get_total_supply(),
        acbu + expected_fee,
        "client.get_total_supply() should include the treasury fee mint"
    );
    // The treasury received the fee as newly minted ACBU.
    assert_eq!(
        acbu_client.balance(&admin),
        expected_fee,
        "acbu_client.balance(&admin) should equal expected_fee"
    );
}

#[test]
#[should_panic(expected = "#5007")]
fn test_mint_from_fiat_unauthorized_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let attacker = Address::generate(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let _ = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_001");

    // Attacker tries to call mint_from_fiat — panics at #5007 before proof check.
    client.mint_from_fiat(
        &attacker,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
        &dummy_proof(&env),
    );
}

#[test]
#[should_panic(expected = "#5007")]
fn test_mint_from_fiat_recipient_self_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let _ = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_001");

    // Recipient tries to call as themselves — panics at #5007 before proof check.
    client.mint_from_fiat(
        &recipient,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
        &dummy_proof(&env),
    );
}

#[test]
#[should_panic(expected = "#5014")]
fn test_mint_from_fiat_empty_tx_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let _ = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "");

    // Call with empty fintech_tx_id — panics at #5014 before proof check.
    client.mint_from_fiat(
        &operator,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
        &dummy_proof(&env),
    );
}

#[test]
#[should_panic(expected = "#5008")]
fn test_mint_from_fiat_duplicate_tx_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(500 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let signing_key = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_duplicate");
    let currency = CurrencyCode::new(&env, "NGN");

    // First call succeeds.
    let proof1 = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &recipient, fiat_amount, &currency);
    client.mint_from_fiat(
        &operator,
        &recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof1,
    );

    // Second call with same tx_id should fail with #5008.
    let proof2 = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &recipient, fiat_amount, &currency);
    client.mint_from_fiat(
        &operator,
        &recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof2,
    );
}

#[test]
#[should_panic(expected = "#5003")]
fn test_mint_from_fiat_below_min_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let signing_key = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    // Mint amount is too small (less than MIN_MINT_AMOUNT); panics at #5003
    // after proof verification passes.
    let fiat_amount = 1;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_small");
    let currency = CurrencyCode::new(&env, "NGN");
    let proof = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &recipient, fiat_amount, &currency);
    client.mint_from_fiat(
        &operator,
        &recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof,
    );
}

#[test]
#[should_panic(expected = "#5003")]
fn test_mint_from_fiat_above_max_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100_000 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let signing_key = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    // Mint amount exceeds MAX_MINT_AMOUNT; panics at #5003 after proof passes.
    let fiat_amount = 1_000_000_000_000_000;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_large");
    let currency = CurrencyCode::new(&env, "NGN");
    let proof = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &recipient, fiat_amount, &currency);
    client.mint_from_fiat(
        &operator,
        &recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof,
    );
}

#[test]
fn test_mint_from_fiat_admin_not_default_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let signing_key = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    // Set custom operator (not admin)
    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_custom_op");
    let currency = CurrencyCode::new(&env, "NGN");
    let proof = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &recipient, fiat_amount, &currency);

    // Custom operator should succeed
    let acbu = client.mint_from_fiat(
        &operator,
        &recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof,
    );
    assert!(acbu > 0);
}

#[test]
#[should_panic(expected = "#5007")]
fn test_mint_from_fiat_admin_when_operator_set() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let recipient = account(&env);
    let mint_addr = client.address.clone();

    let stoken_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let stoken_sac = soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id);
    stoken_sac.mint(&mint_addr, &(100 * DECIMALS));
    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let _ = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    // Set custom operator (different from admin)
    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_admin_tries");

    // Admin tries to call but is not the operator anymore — panics at #5007.
    client.mint_from_fiat(
        &admin,
        &recipient,
        &CurrencyCode::new(&env, "NGN"),
        &fiat_amount,
        &fintech_tx_id,
        &dummy_proof(&env),
    );
}

#[test]
fn test_mint_from_usdc_routes_fee_to_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let user = account(&env);
    let treasury = Address::generate(&env);
    let vault = Address::generate(&env);

    let fee_rate = 300i128; // 3%
    let fee_single = 100i128;

    let _ = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &vault,
        &treasury,
        fee_rate,
        fee_single,
    );

    let usdc_sac = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_token_id);
    let usdc_client = soroban_sdk::token::Client::new(&env, &usdc_token_id);
    let acbu_client = soroban_sdk::token::Client::new(&env, &acbu_token_id);

    let mint_amount = 50 * DECIMALS;
    usdc_sac.mint(&user, &mint_amount);

    let expected_fee = shared::calculate_fee(mint_amount, fee_rate).unwrap(); // 15_000_000
    let expected_acbu = mint_amount - expected_fee; // 485_000_000

    let minted = client.mint_from_usdc(&user, &mint_amount, &user, &None);

    assert_eq!(minted, expected_acbu, "minted should equal expected_acbu");
    assert_eq!(acbu_client.balance(&user), expected_acbu, "user should receive acbu after fee");
    // Verify ACBU fee was routed to treasury
    assert_eq!(acbu_client.balance(&treasury), expected_fee, "treasury should receive the ACBU fee");
    // Verify contract retains total deposited USDC as reserve backing
    assert_eq!(usdc_client.balance(&client.address), mint_amount, "contract should hold total USDC as reserve backing");
}

#[test]
fn test_mint_from_basket_returns_net_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let user = account(&env);
    let vault = Address::generate(&env);
    let treasury = Address::generate(&env);

    let stoken_sac = env.register_stellar_asset_contract_v2(admin.clone());
    let stoken_id = stoken_sac.address();
    establish_trustline(&env, &user, &stoken_sac);
    soroban_sdk::token::StellarAssetClient::new(&env, &stoken_id).mint(&user, &(1_000 * DECIMALS));

    oracle_mock_client(&env, &oracle).seed_stoken(&stoken_id);

    let fee_rate = 300i128; // 3%
    let fee_single = 100i128;

    let _ = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &vault,
        &treasury,
        fee_rate,
        fee_single,
    );

    let acbu_client = soroban_sdk::token::Client::new(&env, &acbu_token_id);

    let acbu_amt = 100 * DECIMALS;
    let expected_fee = shared::calculate_fee(acbu_amt, fee_rate).unwrap(); // 3 * DECIMALS
    let expected_net = acbu_amt - expected_fee; // 97 * DECIMALS

    let proof_id = soroban_sdk::String::from_str(&env, "proof_basket_test");
    let returned_amount = client.mint_from_basket(&user, &user, &acbu_amt, &proof_id);

    // AC-018: mint_from_basket must return net_mint, NOT gross acbu_amt
    assert_eq!(returned_amount, expected_net, "mint_from_basket must return net_mint");
    assert_eq!(acbu_client.balance(&user), expected_net, "user must receive net_mint");
    assert_eq!(acbu_client.balance(&treasury), expected_fee, "treasury must receive fee");
}

#[test]
#[should_panic(expected = "#5023")]
fn test_mint_from_fiat_rejects_contract_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, oracle, reserve_tracker, acbu_token_id, usdc_token_id, client) = setup_test(&env);
    let operator = Address::generate(&env);
    let contract_recipient = Address::generate(&env);

    let signing_key = init_mint_client(
        &env,
        &client,
        &admin,
        &oracle,
        &reserve_tracker,
        &acbu_token_id,
        &usdc_token_id,
        &admin,
        &admin,
        50,
        100,
    );

    client.set_operator(&operator);

    let fiat_amount = 50 * DECIMALS;
    let fintech_tx_id = SorobanString::from_str(&env, "fintech_tx_contract_recip");
    let currency = CurrencyCode::new(&env, "NGN");
    // The recipient check happens before proof check (assert_recipient_is_account).
    // Build a valid proof anyway so the argument is present.
    let proof = make_fiat_proof(&env, &signing_key, &fintech_tx_id, &contract_recipient, fiat_amount, &currency);

    client.mint_from_fiat(
        &operator,
        &contract_recipient,
        &currency,
        &fiat_amount,
        &fintech_tx_id,
        &proof,
    );
}
