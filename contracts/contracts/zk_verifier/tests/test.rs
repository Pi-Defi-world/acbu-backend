#![cfg(test)]

use soroban_sdk::{testutils::Address as _, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec};
use zk_verifier::{PolicyParams, ZkVerifier, ZkVerifierClient};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn fixed_bytesn(env: &Env, val: u8) -> BytesN<32> {
    BytesN::from_array(env, &[val; 32])
}

fn wallet_hash(env: &Env, wallet: &Address) -> u128 {
    let xdr: Bytes = wallet.clone().to_xdr(env);
    let digest: BytesN<32> = env.crypto().sha256(&xdr).into();
    let bytes = digest.to_array();
    let mut h: u128 = 0u128;
    for i in 0..16u32 {
        h |= (bytes[i as usize] as u128) << (i * 8);
    }
    h
}

fn valid_public_inputs(env: &Env, wallet: &Address) -> Vec<u128> {
    Vec::from_array(
        env,
        [
            1u128,                     // min_tier
            566u128,                   // country_code (NG)
            100_000_000u128,           // requested_amount
            1_000_000_000u128,         // daily_cap
            0u128,                     // already_used
            wallet_hash(env, wallet), // wallet_address_hash
        ],
    )
}

fn valid_public_inputs_with_risk(env: &Env, wallet: &Address, risk_score: u128) -> Vec<u128> {
    Vec::from_array(
        env,
        [
            1u128,                     // min_tier
            566u128,                   // country_code (NG)
            100_000_000u128,           // requested_amount
            1_000_000_000u128,         // daily_cap
            0u128,                     // already_used
            wallet_hash(env, wallet), // wallet_address_hash
            risk_score,                // risk_score (#1358)
        ],
    )
}

fn setup(env: &Env) -> (Address, ZkVerifierClient<'_>) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    // Configure default policy: min_tier = 1, country = 566, max_risk_score = 100
    client.set_policy(&1, &566, &100);
    (admin, client)
}

// ---------------------------------------------------------------------------
// Initialization & Admin
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    assert_eq!(client.admin(), admin);
    assert!(!client.paused());
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_already_initialized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    let another = Address::generate(&env);
    client.initialize(&another);
}

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    client.pause();
    assert!(client.paused());

    client.unpause();
    assert!(!client.paused());
}

// ---------------------------------------------------------------------------
// Commitment registry
// ---------------------------------------------------------------------------

#[test]
fn test_register_commitment() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    let commitment = fixed_bytesn(&env, 1);
    client.register_commitment(&commitment);

    assert!(client.is_attested(&commitment));
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn test_register_commitment_already_attested_panics() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    let commitment = fixed_bytesn(&env, 2);
    client.register_commitment(&commitment);
    client.register_commitment(&commitment);
}

// ---------------------------------------------------------------------------
// Verification happy path & nullifier registry (#1356)
// ---------------------------------------------------------------------------

#[test]
fn test_verify_happy_path() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    let wallet = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 10);
    let commitment = fixed_bytesn(&env, 11);
    let public_inputs = valid_public_inputs(&env, &wallet);

    client.register_commitment(&commitment);

    assert!(!client.is_verified(&wallet));
    assert!(!client.is_v(&wallet));
    assert!(!client.is_nullifier_used(&nullifier));
    assert!(!client.used(&nullifier));
    assert!(!client.is_nullifier_spent(&commitment, &nullifier));

    client.verify(&wallet, &nullifier, &commitment, &public_inputs);

    assert!(client.is_verified(&wallet));
    assert!(client.is_v(&wallet));
    assert!(client.is_nullifier_used(&nullifier));
    assert!(client.used(&nullifier));
    assert!(client.is_nullifier_spent(&commitment, &nullifier));

    let record = client.verification(&wallet).expect("record must exist");
    assert_eq!(record.nullifier, nullifier);
    assert_eq!(
        record.policy,
        PolicyParams {
            min_tier: 1,
            allowed_country: 566,
            max_risk_score: 100,
        }
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_persistent_nullifier_registry_rejects_replays() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    let wallet1 = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 20);
    let commitment1 = fixed_bytesn(&env, 21);
    let public_inputs1 = valid_public_inputs(&env, &wallet1);

    client.register_commitment(&commitment1);
    client.verify(&wallet1, &nullifier, &commitment1, &public_inputs1);

    // Attacker attempts to replay the same nullifier with a DIFFERENT commitment and wallet
    let wallet2 = Address::generate(&env);
    let commitment2 = fixed_bytesn(&env, 22);
    let public_inputs2 = valid_public_inputs(&env, &wallet2);

    client.register_commitment(&commitment2);
    // Must panic with NullifierAlreadySpent (#18) due to persistent nullifier registry (#1356)
    client.verify(&wallet2, &nullifier, &commitment2, &public_inputs2);
}

// ---------------------------------------------------------------------------
// On-chain KYC policy enforcement (#1358)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_verify_risk_score_exceeding_threshold_panics() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    // Set strict risk threshold of 50
    client.set_policy(&1, &566, &50);

    let wallet = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 30);
    let commitment = fixed_bytesn(&env, 31);
    // Prover supplies risk score 75 > 50
    let public_inputs = valid_public_inputs_with_risk(&env, &wallet, 75);

    client.register_commitment(&commitment);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);
}

#[test]
fn test_verify_risk_score_within_threshold_succeeds() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    // Set risk threshold to 60
    client.set_policy(&1, &566, &60);

    let wallet = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 40);
    let commitment = fixed_bytesn(&env, 41);
    // Prover supplies risk score 45 <= 60
    let public_inputs = valid_public_inputs_with_risk(&env, &wallet, 45);

    client.register_commitment(&commitment);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);

    assert!(client.is_verified(&wallet));
    assert!(client.is_v(&wallet));
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_verify_tier_below_policy_panics() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    // Policy requires min_tier = 2
    client.set_policy(&2, &566, &100);

    let wallet = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 50);
    let commitment = fixed_bytesn(&env, 51);
    // Prover has tier 1 < 2
    let public_inputs = valid_public_inputs(&env, &wallet);

    client.register_commitment(&commitment);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_verify_country_mismatch_panics() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    // Policy requires country 404 (Kenya)
    client.set_policy(&1, &404, &100);

    let wallet = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 60);
    let commitment = fixed_bytesn(&env, 61);
    // Prover provides country 566 (NG)
    let public_inputs = valid_public_inputs(&env, &wallet);

    client.register_commitment(&commitment);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_verify_caller_mismatch_panics() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    let original_wallet = Address::generate(&env);
    let attacker = Address::generate(&env);

    let nullifier = fixed_bytesn(&env, 70);
    let commitment = fixed_bytesn(&env, 71);
    let public_inputs = valid_public_inputs(&env, &original_wallet);

    client.register_commitment(&commitment);
    // Attacker submits proof bound to original_wallet
    client.verify(&attacker, &nullifier, &commitment, &public_inputs);
}

#[test]
fn test_admin_can_revoke_verification() {
    let env = Env::default();
    let (_admin, client) = setup(&env);

    let wallet = Address::generate(&env);
    let nullifier = fixed_bytesn(&env, 80);
    let commitment = fixed_bytesn(&env, 81);
    let public_inputs = valid_public_inputs(&env, &wallet);

    client.register_commitment(&commitment);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);

    assert!(client.is_verified(&wallet));
    assert!(client.revoke_verification(&wallet));
    assert!(!client.is_verified(&wallet));
    assert!(!client.revoke_verification(&wallet));
}
