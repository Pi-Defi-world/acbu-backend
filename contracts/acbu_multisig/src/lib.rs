#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype, crypto::Hash, Bytes, BytesN, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidThreshold = 3,
    InvalidSignerSet = 4,
    InsufficientSignatures = 5,
    DuplicateSigner = 6,
    UnknownSigner = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigConfig {
    pub signers: Vec<BytesN<32>>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
}

#[contract]
pub struct AcbuMultisig;

#[contractimpl]
impl AcbuMultisig {
    /// Initialize the multisig with an ordered set of Ed25519 signer keys and a threshold.
    pub fn initialize(env: Env, signers: Vec<BytesN<32>>, threshold: u32) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if signers.is_empty() || threshold == 0 || threshold > signers.len() {
            return Err(Error::InvalidThreshold);
        }
        for i in 0..signers.len() {
            for j in (i + 1)..signers.len() {
                if signers.get(i).unwrap() == signers.get(j).unwrap() {
                    return Err(Error::InvalidSignerSet);
                }
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::Config, &MultisigConfig { signers, threshold });
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<MultisigConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}

#[contractimpl]
impl CustomAccountInterface for AcbuMultisig {
    type Signature = Vec<Signature>;
    type Error = Error;

    /// Soroban custom account entry point. Verifies that at least `threshold`
    /// distinct configured signers produced valid Ed25519 signatures over
    /// `signature_payload`. Invoked by the host whenever another contract calls
    /// `require_auth()` on this multisig's address.
    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Signature>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;

        if signatures.len() < config.threshold {
            return Err(Error::InsufficientSignatures);
        }

        let payload_bytes: BytesN<32> = signature_payload.into();
        let payload = Bytes::from_array(&env, &payload_bytes.to_array());

        let mut verified: Vec<BytesN<32>> = Vec::new(&env);
        for sig in signatures.iter() {
            let mut known = false;
            for s in config.signers.iter() {
                if s == sig.public_key {
                    known = true;
                    break;
                }
            }
            if !known {
                return Err(Error::UnknownSigner);
            }
            for v in verified.iter() {
                if v == sig.public_key {
                    return Err(Error::DuplicateSigner);
                }
            }
            // Traps the host on an invalid signature.
            env.crypto()
                .ed25519_verify(&sig.public_key, &payload, &sig.signature);
            verified.push_back(sig.public_key.clone());
        }

        if verified.len() < config.threshold {
            return Err(Error::InsufficientSignatures);
        }
        Ok(())
    }
}
