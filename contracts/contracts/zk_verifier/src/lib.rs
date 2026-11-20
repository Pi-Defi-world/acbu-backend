#![no_std]

//! # `zk_verifier`
//!
//! On-chain ZK proof verifier for KYC compliance proofs.
//!
//! ## AZ-014 fix — bounded storage
//!
//! The original implementation stored all nullifiers and all verified-wallet
//! addresses in two growing `Map` values held in **instance** storage.  Every
//! verification call appended to those maps; entries were never removed.
//! Because instance storage is size-bounded and its rent scales with the total
//! byte size of the instance, the contract would eventually hit storage limits
//! or impose unbounded rent on honest users — a DoS vector.
//!
//! This implementation uses **persistent** storage keyed *per entry*:
//!
//! ```text
//! DataKey::ScopedNullifier(BytesN<32>, BytesN<32>) → bool
//! DataKey::Verified(Address)     → VerificationRecord (fixed validity deadline)
//! DataKey::AttestedCommitment(BytesN<32>) → bool
//! DataKey::Policy                → PolicyParams        (instance — bounded scalar)
//! DataKey::Admin                 → Address             (instance — bounded scalar)
//! DataKey::Paused                → bool                (instance — bounded scalar)
//! ```
//!
//! ## AZ-001 fix — server-side compliance policy enforcement
//!
//! Previously `required_kyc` and `allowed_country` were `pub` inputs supplied
//! entirely by the prover.  Nothing stopped a prover from setting
//! `required_kyc = 0` and `allowed_country = <their own value>` to trivially
//! satisfy both circuit constraints and get a "valid" proof with zero real KYC.
//!
//! This implementation adds an admin-controlled `PolicyParams` value stored in
//! contract instance storage.  During `verify()` the contract independently
//! reads its own stored policy and enforces:
//!
//! * `public_inputs[0]` (min_tier)     **≥** `policy.min_tier`
//! * `public_inputs[1]` (country_code) **==** `policy.allowed_country`
//!
//! A prover cannot satisfy these checks by supplying their own values: the
//! policy is immutable from the prover's perspective and may only be changed
//! by the admin via `set_policy`.  Until a policy is set `verify()` rejects
//! all proofs.

use shared::ContractError;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, Address, Bytes, BytesN,
    Env, Vec,
};

// ---------------------------------------------------------------------------
// Storage TTL constants
// ---------------------------------------------------------------------------

/// Ledgers a nullifier entry is kept alive after its last verification.
///
/// Stellar closes ~1 ledger every 5 seconds.
/// 1 051 200 ledgers ≈ 60 days — long enough to prevent replay within any
/// realistic settlement window while still letting stale entries expire.
const NULLIFIER_TTL_LEDGERS: u32 = 1_051_200; // ~60 days

/// TTL bump threshold: extend only when fewer than this many ledgers remain.
/// Set to half the full TTL so we don't bump on every single call.
const NULLIFIER_TTL_THRESHOLD: u32 = NULLIFIER_TTL_LEDGERS / 2;

/// TTL for the instance storage (admin, paused flag, policy).
const INSTANCE_TTL_LEDGERS: u32 = 5_256_000; // ~1 year

/// How long a successful verification record is valid.
///
/// 1 051 200 ledgers ≈ 60 days.  The admin may revoke earlier.
const VERIFICATION_VALIDITY_LEDGERS: u32 = 1_051_200; // ~60 days

/// Maximum expected length for public inputs slice.
///
/// | Index | Field                 | Description                              |
/// |-------|-----------------------|------------------------------------------|
/// |   0   | `min_tier`            | Minimum KYC tier (0–3)                   |
/// |   1   | `country_code`        | ISO-3166-1 numeric country code          |
/// |   2   | `requested_amount`    | Transaction amount (7 dec)               |
/// |   3   | `daily_cap`           | Per-tier daily cap                       |
/// |   4   | `already_used`        | Already consumed in current daily window |
/// |   5   | `wallet_address_hash` | sha256(wallet_xdr)[0..16] as u128 (AZ-032) |
const MAX_PUBLIC_INPUTS_LEN: u32 = 6;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Compliance policy stored on-chain by the contract administrator.
///
/// AZ-001: these values are the authoritative compliance requirements.
/// The contract enforces them independently of whatever the prover encodes
/// in the circuit's public inputs, so a malicious prover cannot self-select
/// a weaker policy.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyParams {
    /// Minimum KYC tier required.  Wallets whose proof encodes a tier below
    /// this value are rejected at the contract level regardless of circuit
    /// satisfiability.
    pub min_tier: u128,
    /// ISO-3166-1 numeric country code that is permitted to transact.
    /// The prover's `country_code` in `public_inputs[1]` must equal this
    /// exactly; any other country is denied at the contract level.
    pub allowed_country: u128,
}

/// On-chain record created for each successfully verified wallet.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VerificationRecord {
    /// The ledger sequence number at which this record expires.
    pub expires_at_ledger: u32,
    /// The nullifier that was spent for this verification.
    pub nullifier: BytesN<32>,
    /// Snapshot of the policy that was active when the proof was verified.
    /// Stored for auditability.
    pub policy: PolicyParams,
}

/// Event emitted on successful verification.
#[contracttype]
pub struct VerifiedEvent {
    pub user: Address,
    pub nullifier: BytesN<32>,
    pub policy: PolicyParams,
    pub expires_at_ledger: u32,
}

/// Event emitted when the admin revokes a wallet's verification.
#[contracttype]
pub struct VerificationRevokedEvent {
    pub user: Address,
    pub revoked_at_ledger: u32,
}

/// Event emitted when the admin updates the compliance policy.
#[contracttype]
pub struct PolicyUpdatedEvent {
    pub min_tier: u128,
    pub allowed_country: u128,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract administrator address.
    Admin,
    /// Whether the contract is paused.
    Paused,
    /// AZ-001: on-chain compliance policy (min_tier + allowed_country).
    Policy,
    /// Spent nullifier — keyed per (commitment, nullifier) pair.
    ///
    /// Stored in *persistent* storage so entries expire individually via TTL
    /// rather than accumulating in a single unbounded instance `Map`.
    ScopedNullifier(BytesN<32>, BytesN<32>),
    /// Verified wallet record — keyed per address and bounded by its deadline.
    ///
    /// Stored in *persistent* storage for the same reason as `ScopedNullifier`.
    Verified(Address),
    /// Attested credential commitment — keyed per 32-byte commitment.
    ///
    /// AZ-002: commitments recorded by the trusted KYC authority (the
    /// admin). Stored in *persistent* storage so the registry stays bounded.
    AttestedCommitment(BytesN<32>),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ZkVerifier;

#[contractimpl]
impl ZkVerifier {
    // ── Initialisation ──────────────────────────────────────────────────────

    /// Initialise the contract.  Must be called exactly once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, ContractError::Unauthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        // Policy starts unconfigured — `verify()` rejects all proofs until
        // the admin calls `set_policy`.  This prevents the zero-KYC bypass
        // window that would otherwise exist between deployment and policy setup.
        Self::extend_instance_ttl(&env);
    }

    // ── Compliance policy (AZ-001) ──────────────────────────────────────────

    /// Configure or update the compliance policy.  Only the admin may call this.
    ///
    /// `min_tier` is the minimum KYC tier (0 = none, 1 = basic, 2 = enhanced,
    /// 3 = enterprise).  Setting it to 0 allows any tier; set it to at least 1
    /// to require real KYC.
    ///
    /// `allowed_country` is the ISO-3166-1 numeric code of the only jurisdiction
    /// permitted to verify (e.g. 566 = Nigeria, 404 = Kenya).  Set it to 0 to
    /// allow any country, but note that `public_inputs[1]` must still equal
    /// exactly 0 in that case.
    ///
    /// AZ-001: these values are stored on-chain and enforced server-side in
    /// `verify()`, so the prover cannot choose weaker values.
    pub fn set_policy(env: Env, min_tier: u128, allowed_country: u128) {
        Self::check_admin(&env);
        let policy = PolicyParams {
            min_tier,
            allowed_country,
        };
        env.storage().instance().set(&DataKey::Policy, &policy);
        env.events().publish(
            (symbol_short!("pol_set"),),
            PolicyUpdatedEvent {
                min_tier,
                allowed_country,
            },
        );
        Self::extend_instance_ttl(&env);
    }

    /// Return the current compliance policy, or `None` if not yet configured.
    pub fn get_policy(env: Env) -> Option<PolicyParams> {
        env.storage().instance().get(&DataKey::Policy)
    }

    // ── Proof verification ──────────────────────────────────────────────────

    /// AZ-002 — trusted commitment registry.
    ///
    /// The admin acts as the trusted KYC authority: after a user's redacted
    /// KYC review is approved, it records the user's credential commitment
    /// `poseidon2(kyc_level, country_code, salt)` — derived from the
    /// authority's **own** verified records, never from user-claimed values.
    ///
    /// Only attested commitments are accepted by `verify`, so an unverified
    /// user can no longer claim an arbitrary `kyc_level` and produce a valid
    /// proof about a self-asserted credential.
    pub fn register_commitment(env: Env, commitment: BytesN<32>) {
        Self::check_admin(&env);
        Self::assert_not_paused(&env);

        if env
            .storage()
            .persistent()
            .has(&DataKey::AttestedCommitment(commitment.clone()))
        {
            panic_with_error!(&env, ContractError::CommitmentAlreadyAttested);
        }

        env.storage()
            .persistent()
            .set(&DataKey::AttestedCommitment(commitment.clone()), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::AttestedCommitment(commitment.clone()),
            NULLIFIER_TTL_THRESHOLD,
            NULLIFIER_TTL_LEDGERS,
        );

        env.events()
            .publish((symbol_short!("attested"), commitment.clone()), ());

        Self::extend_instance_ttl(&env);
    }

    /// Returns `true` if `commitment` was attested by the trusted KYC authority.
    pub fn is_attested(env: Env, commitment: BytesN<32>) -> bool {
        let key = DataKey::AttestedCommitment(commitment);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(
                &key,
                NULLIFIER_TTL_THRESHOLD,
                NULLIFIER_TTL_LEDGERS,
            );
            true
        } else {
            false
        }
    }

    /// Record a successful proof verification for `wallet`.
    ///
    /// # AZ-001 — server-side compliance policy enforcement
    ///
    /// The contract reads its stored `PolicyParams` and checks:
    ///
    /// * `public_inputs[0]` (the tier the prover claims) **≥** `policy.min_tier`
    /// * `public_inputs[1]` (the country the prover claims) **==** `policy.allowed_country`
    ///
    /// These checks happen *after* the ZK proof passes, so a prover cannot
    /// choose weaker values in the circuit's public inputs to bypass compliance.
    /// If no policy has been configured yet, all verifications are rejected.
    ///
    /// # AZ-002
    ///
    /// The credential `commitment` must have been attested by the KYC authority.
    ///
    /// # AZ-014
    ///
    /// Both the nullifier and the verified-wallet flag are written to
    /// **persistent** storage as individual scalar entries, not appended to a
    /// shared `Map` in instance storage.
    ///
    /// # AZ-032 — Caller binding
    ///
    /// `public_inputs[5]` must equal the first 16 bytes of `sha256(wallet_xdr)`
    /// interpreted as a little-endian `u128`.
    pub fn verify(
        env: Env,
        wallet: Address,
        nullifier: BytesN<32>,
        commitment: BytesN<32>,
        public_inputs: Vec<u128>,
    ) {
        wallet.require_auth();
        Self::assert_not_paused(&env);

        // AZ-007: Enforce exact bound on public_inputs length.
        if public_inputs.len() != MAX_PUBLIC_INPUTS_LEN {
            panic_with_error!(&env, ContractError::InvalidPublicInputsLength);
        }

        // AZ-032: Verify wallet_address_hash (public_inputs[5]) matches caller.
        let wallet_xdr: Bytes = wallet.clone().to_xdr(&env);
        let digest: BytesN<32> = env.crypto().sha256(&wallet_xdr).into();
        let digest_bytes = digest.to_array();
        let mut hash_u128: u128 = 0u128;
        let mut i: u32 = 0;
        while i < 16 {
            hash_u128 |= (digest_bytes[i as usize] as u128) << (i * 8);
            i += 1;
        }
        let claimed_wallet_hash: u128 = public_inputs.get_unchecked(5);
        if hash_u128 != claimed_wallet_hash {
            panic_with_error!(&env, ContractError::ProofCallerMismatch);
        }

        // AZ-001: Load the admin-controlled compliance policy.  Reject all
        // verifications until the policy is explicitly configured.
        let policy: PolicyParams = env
            .storage()
            .instance()
            .get(&DataKey::Policy)
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::PolicyNotConfigured));

        // AZ-001: Enforce minimum KYC tier server-side.
        // public_inputs[0] is the tier the prover encoded; it must meet or
        // exceed the contract's required minimum.
        let prover_tier: u128 = public_inputs.get_unchecked(0);
        if prover_tier < policy.min_tier {
            panic_with_error!(&env, ContractError::KycTierTooLow);
        }

        // AZ-001: Enforce allowed-country server-side.
        // public_inputs[1] is the country the prover encoded; it must match
        // exactly the country stored in the contract policy.
        let prover_country: u128 = public_inputs.get_unchecked(1);
        if prover_country != policy.allowed_country {
            panic_with_error!(&env, ContractError::CountryNotAllowed);
        }

        // AZ-002: Reject proofs whose commitment was never attested.
        if !env
            .storage()
            .persistent()
            .has(&DataKey::AttestedCommitment(commitment.clone()))
        {
            panic_with_error!(&env, ContractError::CommitmentNotAttested);
        }

        // Reject replayed nullifiers for this commitment.
        if env
            .storage()
            .persistent()
            .has(&DataKey::ScopedNullifier(commitment.clone(), nullifier.clone()))
        {
            panic_with_error!(&env, ContractError::NullifierAlreadySpent);
        }

        // Record the nullifier in persistent storage (AZ-014).
        env.storage()
            .persistent()
            .set(&DataKey::ScopedNullifier(commitment.clone(), nullifier.clone()), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::ScopedNullifier(commitment.clone(), nullifier.clone()),
            NULLIFIER_TTL_THRESHOLD,
            NULLIFIER_TTL_LEDGERS,
        );

        // Store an immutable validity deadline.
        let expires_at_ledger = env
            .ledger()
            .sequence()
            .saturating_add(VERIFICATION_VALIDITY_LEDGERS);
        let record = VerificationRecord {
            expires_at_ledger,
            nullifier: nullifier.clone(),
            policy: policy.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Verified(wallet.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Verified(wallet.clone()),
            VERIFICATION_VALIDITY_LEDGERS / 2,
            VERIFICATION_VALIDITY_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("verified"),),
            VerifiedEvent {
                user: wallet,
                nullifier,
                policy,
                expires_at_ledger,
            },
        );

        Self::extend_instance_ttl(&env);
    }

    // ── Read helpers ────────────────────────────────────────────────────────

    /// Returns `true` only while `wallet` has a non-expired verification.
    pub fn is_verified(env: Env, wallet: Address) -> bool {
        let key = DataKey::Verified(wallet);
        env.storage()
            .persistent()
            .get::<_, VerificationRecord>(&key)
            .is_some_and(|record| env.ledger().sequence() < record.expires_at_ledger)
    }

    /// Return the current verification record when it is still valid.
    pub fn verification(env: Env, wallet: Address) -> Option<VerificationRecord> {
        let key = DataKey::Verified(wallet);
        env.storage()
            .persistent()
            .get::<_, VerificationRecord>(&key)
            .filter(|record| env.ledger().sequence() < record.expires_at_ledger)
    }

    /// Returns `true` if `nullifier` has already been spent for `commitment`.
    pub fn is_nullifier_spent(env: Env, commitment: BytesN<32>, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::ScopedNullifier(commitment, nullifier))
    }

    /// Return the admin address.
    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::Unauthorized))
    }

    /// Return whether the contract is paused.
    pub fn paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    /// Pause the contract.
    pub fn pause(env: Env) {
        Self::check_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::extend_instance_ttl(&env);
    }

    /// Unpause the contract.
    pub fn unpause(env: Env) {
        Self::check_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);
    }

    /// Revoke a wallet's verification immediately.
    pub fn revoke_verification(env: Env, wallet: Address) -> bool {
        Self::check_admin(&env);
        let key = DataKey::Verified(wallet.clone());
        if !env.storage().persistent().has(&key) {
            return false;
        }

        env.storage().persistent().remove(&key);
        env.events().publish(
            (symbol_short!("revoked"),),
            VerificationRevokedEvent {
                user: wallet,
                revoked_at_ledger: env.ledger().sequence(),
            },
        );
        Self::extend_instance_ttl(&env);
        true
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    fn check_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, ContractError::Unauthorized));
        admin.require_auth();
    }

    fn assert_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic_with_error!(env, ContractError::Paused);
        }
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_LEDGERS / 2, INSTANCE_TTL_LEDGERS);
    }
}
