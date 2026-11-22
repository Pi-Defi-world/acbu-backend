#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, Vec};
use shared::ContractError;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn fixed_bytesn(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0; 32])
}

/// Compute sha256(wallet.to_xdr())[0..16] as a little-endian u128.
/// This mirrors the logic in ZkVerifier::verify() so tests can build a
/// correctly-bound public_inputs vector without duplicating the contract code.
fn wallet_hash(env: &Env, wallet: &Address) -> u128 {
    let xdr: Bytes = wallet.clone().to_xdr(env);
    let digest: BytesN<32> = env.crypto().sha256(&xdr);
    let bytes = digest.to_array();
    let mut h: u128 = 0u128;
    for i in 0..16u32 {
        h |= (bytes[i as usize] as u128) << (i * 8);
    }
    h
}

/// Build a valid 6-element public_inputs Vec bound to `wallet`.
///
/// Index layout (mirrors zk/circuits/kyc_verifier/src/main.nr):
///   [0] min_tier            (1)
///   [1] country_code        (566 = NG)
///   [2] requested_amount    (100_000_000)
///   [3] daily_cap           (1_000_000_000)
///   [4] already_used        (0)
///   [5] wallet_address_hash (sha256(wallet_xdr)[0..16] as u128)
fn valid_public_inputs(env: &Env, wallet: &Address) -> Vec<u128> {
    Vec::from_array(
        env,
        [1u128, 566u128, 100_000_000u128, 1_000_000_000u128, 0u128, wallet_hash(env, wallet)],
    )
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    assert_eq!(client.admin(), admin);
    assert!(!client.paused());
}

#[test]
#[should_panic(expected = "ContractError::Unauthorized")]
fn test_initialize_already_initialized_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);
    client.initialize(&Address::random(&env)); // Should panic
}

// ---------------------------------------------------------------------------
// Pause / unpause
// ---------------------------------------------------------------------------

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, contract_id, admin)
}

#[test]
fn verification_records_named_inputs_and_policy() {
    let (env, contract_id, _) = setup();
    let client = ZkVerifierClient::new(&env, &contract_id);

    client.initialize(&Address::random(&env));
    client.pause(); // Unauthorized
}

// ---------------------------------------------------------------------------
// Commitment registry
// ---------------------------------------------------------------------------

#[test]
fn test_register_commitment() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    let commitment = fixed_bytesn(&env);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    admin.set_auth(false);

    assert!(client.is_attested(&commitment));
}

#[test]
#[should_panic(expected = "ContractError::CommitmentAlreadyAttested")]
fn test_register_commitment_already_attested_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    let commitment = fixed_bytesn(&env);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    client.register_commitment(&commitment); // Should panic
    admin.set_auth(false);
}

// ---------------------------------------------------------------------------
// verify() — happy path
// ---------------------------------------------------------------------------

#[test]
fn test_verify() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    let wallet = Address::random(&env);
    let nullifier = fixed_bytesn(&env);
    let commitment = fixed_bytesn(&env);

    // 6 public inputs including the wallet binding (AZ-032).
    let public_inputs = valid_public_inputs(&env, &wallet);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    admin.set_auth(false);

    wallet.set_auth(true);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);
    wallet.set_auth(false);

    assert!(client.is_verified(&wallet));
    assert!(client.is_nullifier_spent(&inputs.commitment, &inputs.nullifier));

    let event = env
        .events()
        .all()
        .iter()
        .find(|event| {
            event.0 == contract_id
                && Symbol::from_val(&env, &event.1.get(0).unwrap()) == symbol_short!("verified")
        })
        .expect("verified event must be emitted");
    let event: VerifiedEvent = event.2.into_val(&env);
    assert_eq!(event.user, wallet);
    assert_eq!(event.nullifier, inputs.nullifier);
    assert_eq!(event.policy, record.policy);
}

// ---------------------------------------------------------------------------
// verify() — error cases
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn verification_rejects_unattested_commitment() {
    let (env, contract_id, _) = setup();
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    let wallet = Address::random(&env);
    let nullifier = fixed_bytesn(&env);
    let commitment = fixed_bytesn(&env);
    // Only 5 inputs — missing wallet_address_hash.
    let public_inputs = Vec::from_array(&env, [0u128; 5]);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    admin.set_auth(false);

    wallet.set_auth(true);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs); // Should panic
    wallet.set_auth(false);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn verification_rejects_reused_scoped_nullifier() {
    let (env, contract_id, _) = setup();
    let client = ZkVerifierClient::new(&env, &contract_id);

    client.initialize(&Address::random(&env));

    let wallet = Address::random(&env);
    let nullifier = fixed_bytesn(&env);
    let commitment = fixed_bytesn(&env);
    let public_inputs = valid_public_inputs(&env, &wallet);

    wallet.set_auth(true);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs); // Should panic
    wallet.set_auth(false);
}

#[test]
#[should_panic(expected = "ContractError::NullifierAlreadySpent")]
fn test_verify_nullifier_reused_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);
    let wallet = Address::generate(&env);
    let inputs = inputs(&env, 1, 2);
    client.register_commitment(&inputs.commitment);
    client.verify(&wallet, &inputs);

    let admin = Address::random(&env);
    client.initialize(&admin);

    let wallet1 = Address::random(&env);
    let nullifier = fixed_bytesn(&env);
    let commitment1 = fixed_bytesn(&env);
    let public_inputs1 = valid_public_inputs(&env, &wallet1);

    admin.set_auth(true);
    client.register_commitment(&commitment1);
    admin.set_auth(false);

    wallet1.set_auth(true);
    client.verify(&wallet1, &nullifier, &commitment1, &public_inputs1);
    wallet1.set_auth(false);

    // Try to use the same nullifier for a different wallet + commitment.
    let wallet2 = Address::random(&env);
    let commitment2 = BytesN::from_array(&env, &[1; 32]);
    let public_inputs2 = valid_public_inputs(&env, &wallet2);

    admin.set_auth(true);
    client.register_commitment(&commitment2);
    admin.set_auth(false);

    wallet2.set_auth(true);
    client.verify(&wallet2, &nullifier, &commitment2, &public_inputs2); // Should panic
    wallet2.set_auth(false);
}

/// AZ-032: Proof must be bound to the submitting wallet.
///
/// If the wallet_address_hash in public_inputs[5] was generated for a
/// *different* address than the one signing the transaction, the contract
/// must reject the call with ProofCallerMismatch.
///
/// This prevents an attacker from taking a proof generated by user A and
/// re-submitting it to mark their own address (user B) as verified.
#[test]
#[should_panic(expected = "ContractError::ProofCallerMismatch")]
fn test_verify_wrong_caller_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkVerifier);
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    // Proof was generated (and wallet_address_hash computed) for `original_wallet`.
    let original_wallet = Address::random(&env);
    // Attacker submits the proof under their own address `attacker`.
    let attacker = Address::random(&env);

    let nullifier = fixed_bytesn(&env);
    let commitment = fixed_bytesn(&env);

    // public_inputs[5] is bound to original_wallet, not attacker.
    let public_inputs_bound_to_original = valid_public_inputs(&env, &original_wallet);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    admin.set_auth(false);

    // Attacker signs the tx (require_auth passes) but the hash in public_inputs
    // doesn't match the attacker's address — must be rejected.
    attacker.set_auth(true);
    client.verify(&attacker, &nullifier, &commitment, &public_inputs_bound_to_original);
    attacker.set_auth(false);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

#[test]
fn admin_can_revoke_verification() {
    let (env, contract_id, _) = setup();
    let client = ZkVerifierClient::new(&env, &contract_id);

    let admin = Address::random(&env);
    client.initialize(&admin);

    let wallet = Address::random(&env);
    let nullifier = fixed_bytesn(&env);
    let commitment = fixed_bytesn(&env);
    let public_inputs = valid_public_inputs(&env, &wallet);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    admin.set_auth(false);

    wallet.set_auth(true);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);
    wallet.set_auth(false);

    assert!(client.is_verified(&wallet));

    let unverified_wallet = Address::random(&env);
    assert!(!client.is_verified(&unverified_wallet));
}

#[test]
fn pause_blocks_verification_until_unpaused() {
    let (env, contract_id, _) = setup();
    let client = ZkVerifierClient::new(&env, &contract_id);
    let wallet = Address::generate(&env);
    let inputs = inputs(&env, 1, 2);
    client.register_commitment(&inputs.commitment);
    client.pause();

    let admin = Address::random(&env);
    client.initialize(&admin);

    let wallet = Address::random(&env);
    let nullifier = fixed_bytesn(&env);
    let commitment = fixed_bytesn(&env);
    let public_inputs = valid_public_inputs(&env, &wallet);

    admin.set_auth(true);
    client.register_commitment(&commitment);
    admin.set_auth(false);

    wallet.set_auth(true);
    client.verify(&wallet, &nullifier, &commitment, &public_inputs);
    wallet.set_auth(false);

    assert!(client.is_nullifier_spent(&commitment, &nullifier));

    let unspent_nullifier = BytesN::from_array(&env, &[1; 32]);
    assert!(!client.is_nullifier_spent(&commitment, &unspent_nullifier));
}
