//! # `verifier`
//!
//! Host-side wrapper logic for KYC tier validation and transaction rate-gate
//! checks. This crate contains **only pure Rust** — no `soroban-sdk`, no WASM
//! target, no Docker / localnet dependency.
//!
//! Contract code delegates the core decision rules to this crate so they can be
//! exhaustively unit-tested without spinning up a Stellar node or a Soroban
//! test environment.
//!
//! ## KYC tiers
//!
//! | Tier | Minimum score | Daily cap (ACBU, 7 decimals) | Country restriction |
//! |------|--------------|------------------------------|---------------------|
//! | 0    | –            | 0                            | blocked             |
//! | 1    | 30           | 100 ACBU (1_000_000_000)     | allowlisted only    |
//! | 2    | 60           | 10 000 ACBU (100_000_000_000)| any                 |
//! | 3    | 90           | unlimited                    | any                 |
//!
//! ## Rate gate
//!
//! A *rate gate* enforces a per-account daily transaction limit. The contract
//! passes in the amount already consumed in the current window; this crate
//! checks whether adding `requested` would breach the tier cap.

/// Basis-points denominator (10 000 = 100 %).
pub const BASIS_POINTS: i128 = 10_000;

/// Fixed-point decimal scale used throughout the protocol (7 decimals).
pub const DECIMALS: i128 = 10_000_000;

/// Minimum KYC score required for Tier 1 access.
pub const KYC_TIER1_MIN_SCORE: u32 = 30;

/// Minimum KYC score required for Tier 2 access.
pub const KYC_TIER2_MIN_SCORE: u32 = 60;

/// Minimum KYC score required for Tier 3 (unlimited) access.
pub const KYC_TIER3_MIN_SCORE: u32 = 90;

/// Daily cap for KYC Tier 1, expressed in protocol units (7 decimals).
/// 100 ACBU × 10_000_000 = 1_000_000_000.
pub const KYC_TIER1_DAILY_CAP: i128 = 100 * DECIMALS;

/// Daily cap for KYC Tier 2, expressed in protocol units (7 decimals).
/// 10 000 ACBU × 10_000_000 = 100_000_000_000.
pub const KYC_TIER2_DAILY_CAP: i128 = 10_000 * DECIMALS;

/// Sentinel value meaning "no cap" for KYC Tier 3.
pub const KYC_TIER3_DAILY_CAP: i128 = i128::MAX;

// ---------------------------------------------------------------------------
// ZK proof verification constants
// ---------------------------------------------------------------------------

/// Expected byte length of a serialised Noir/Barretenberg KYC proof.
///
/// A Barretenberg UltraPlonk proof for the `kyc_verifier` circuit serialises to
/// 2 144 bytes (standard Plonk proof without recursive aggregation). This
/// constant is the single source of truth used by [`verify_proof`] to reject
/// proofs of the wrong size before any cryptographic work is performed.
pub const PROOF_BYTES: usize = 2_144;

/// Number of public inputs committed to by the `kyc_verifier` circuit.
///
/// The circuit exposes exactly **5** public inputs, in order:
///
/// | Index | Field              | Type    | Description                              |
/// |-------|--------------------|---------|------------------------------------------|
/// | 0     | `min_tier`         | `u8`    | Minimum KYC tier required (0–3)          |
/// | 1     | `country_code`     | `Field` | ISO 3166-1 numeric country code          |
/// | 2     | `requested_amount` | `Field` | Transaction amount (7-decimal units)     |
/// | 3     | `daily_cap`        | `Field` | Per-tier daily cap (`u64::MAX` = unlimited) |
/// | 4     | `already_used`     | `Field` | Window total already consumed            |
///
/// Any call to [`verify_proof`] that supplies a `public_inputs` slice of a
/// different length is rejected immediately with
/// [`VerifierError::InvalidPublicInputsLength`], preventing resource/gas abuse
/// from oversized or undersized input vectors.
pub const PUBLIC_INPUTS_LEN: usize = 5;

// ---------------------------------------------------------------------------
// ZK proof verification
// ---------------------------------------------------------------------------

/// Public-input field indices for the KYC verifier circuit.
const PI_MIN_TIER: usize = 0;
const PI_COUNTRY_CODE: usize = 1;
const PI_REQUESTED_AMOUNT: usize = 2;
const PI_DAILY_CAP: usize = 3;
const PI_ALREADY_USED: usize = 4;

/// Maximum valid KYC tier encoded in a public input.
const MAX_TIER: u128 = 3;

/// Validates a serialised KYC proof together with its public inputs.
///
/// Enforces both **structural** and **semantic** invariants before any
/// cryptographic work is performed, so callers fail fast on clearly invalid
/// inputs without paying gas for a full proof check.
///
/// # Checks performed (in order)
///
/// 1. `proof_bytes.len() == PROOF_BYTES` — wrong size → [`InvalidProofLength`].
/// 2. `proof_bytes` are not all-zero — trivially forged → [`TriviallyInvalidProof`].
/// 3. `public_inputs.len() == PUBLIC_INPUTS_LEN` — wrong count → [`InvalidPublicInputsLength`]
///    (W2-Z-017 fix: prevents unbounded gas consumption from oversized slices).
/// 4. `public_inputs[PI_MIN_TIER] <= 3` — tier out of range → [`InvalidPublicInputValue`].
/// 5. `public_inputs[PI_COUNTRY_CODE] != 0` — zero country code is not a valid
///    ISO 3166-1 encoding → [`InvalidPublicInputValue`].
/// 6. `public_inputs[PI_REQUESTED_AMOUNT] > 0` — zero-amount proof is invalid
///    → [`InvalidPublicInputValue`].
/// 7. `public_inputs[PI_ALREADY_USED] <= public_inputs[PI_DAILY_CAP]` — a proof
///    claiming already_used > daily_cap is self-contradictory → [`InvalidPublicInputValue`].
///
/// # Note on cryptographic verification
///
/// Full on-chain cryptographic proof verification (Barretenberg / Noir
/// recursive verifier) is performed by the Soroban contract layer, which
/// imports this crate. The checks here are pre-validation guards that run in
/// pure Rust with no runtime overhead.
///
/// # Errors
///
/// | Condition                                         | Error                           |
/// |---------------------------------------------------|---------------------------------|
/// | `proof_bytes.len() != PROOF_BYTES`                | `InvalidProofLength`            |
/// | proof bytes are all-zero                          | `TriviallyInvalidProof`         |
/// | `public_inputs.len() != PUBLIC_INPUTS_LEN`        | `InvalidPublicInputsLength`     |
/// | `min_tier > 3`                                    | `InvalidPublicInputValue`       |
/// | `country_code == 0`                               | `InvalidPublicInputValue`       |
/// | `requested_amount == 0`                           | `InvalidPublicInputValue`       |
/// | `already_used > daily_cap`                        | `InvalidPublicInputValue`       |
///
/// # Examples
///
/// ```
/// use verifier::{verify_proof, PROOF_BYTES, PUBLIC_INPUTS_LEN, VerifierError};
///
/// // Correct proof with valid public inputs — structural + semantic passes.
/// let proof = vec![1u8; PROOF_BYTES]; // non-zero bytes
/// let inputs: Vec<u128> = vec![
///     1,           // min_tier = Tier1
///     0x4E47,      // country_code = "NG"
///     1_000_000,   // requested_amount > 0
///     1_000_000_000, // daily_cap
///     0,           // already_used
/// ];
/// assert!(verify_proof(&proof, &inputs).is_ok());
///
/// // All-zero proof — rejected as trivially forged.
/// let zero_proof = vec![0u8; PROOF_BYTES];
/// assert_eq!(
///     verify_proof(&zero_proof, &inputs).unwrap_err(),
///     VerifierError::TriviallyInvalidProof,
/// );
///
/// // Wrong proof length — rejected immediately.
/// let short_proof = vec![1u8; 10];
/// assert_eq!(
///     verify_proof(&short_proof, &inputs).unwrap_err(),
///     VerifierError::InvalidProofLength,
/// );
/// ```
pub fn verify_proof(
    proof_bytes: &[u8],
    public_inputs: &[u128],
) -> Result<(), VerifierError> {
    // Guard 1: proof must be exactly the expected byte length.
    if proof_bytes.len() != PROOF_BYTES {
        return Err(VerifierError::InvalidProofLength);
    }

    // Guard 2: reject trivially forged proofs (all-zero bytes).
    // A valid Barretenberg UltraPlonk proof is a serialised elliptic-curve
    // point sequence — the all-zero byte string is not on the curve and can
    // never be a valid proof.
    if proof_bytes.iter().all(|&b| b == 0) {
        return Err(VerifierError::TriviallyInvalidProof);
    }

    // Guard 3 (W2-Z-017 fix): public inputs must be exactly PUBLIC_INPUTS_LEN.
    //
    // The KYC verifier circuit has a fixed number of public inputs (5). Any
    // deviation — whether an oversized slice injected by a malicious caller or
    // an undersized slice from a buggy integration — is rejected here before
    // the inputs are passed to the cryptographic verifier. This prevents
    // unbounded resource consumption and ensures the verifier always operates
    // on a well-formed input vector.
    if public_inputs.len() != PUBLIC_INPUTS_LEN {
        return Err(VerifierError::InvalidPublicInputsLength);
    }

    // Guard 4: min_tier must be 0–3.
    if public_inputs[PI_MIN_TIER] > MAX_TIER {
        return Err(VerifierError::InvalidPublicInputValue);
    }

    // Guard 5: country_code == 0 is not a valid ISO 3166-1 encoding.
    if public_inputs[PI_COUNTRY_CODE] == 0 {
        return Err(VerifierError::InvalidPublicInputValue);
    }

    // Guard 6: requesting zero units is never meaningful.
    if public_inputs[PI_REQUESTED_AMOUNT] == 0 {
        return Err(VerifierError::InvalidPublicInputValue);
    }

    // Guard 7: already_used > daily_cap is self-contradictory — the circuit
    // would never produce a valid proof for such a state, so reject early.
    if public_inputs[PI_ALREADY_USED] > public_inputs[PI_DAILY_CAP] {
        return Err(VerifierError::InvalidPublicInputValue);
    }

    // All pre-validation guards passed. Full cryptographic proof verification
    // is delegated to the Soroban contract layer (Barretenberg / Noir verifier).
    Ok(())
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// KYC tier assigned to an account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KycTier {
    /// Not verified; all transactions blocked.
    Zero,
    /// Basic verification; restricted daily volume and country allow-list.
    One,
    /// Standard verification; increased daily cap, no country restriction.
    Two,
    /// Full / institutional verification; no daily cap.
    Three,
}

/// ISO 3166-1 alpha-2 country code (two uppercase ASCII characters).
///
/// Represented as a `u16` (two bytes packed), making it `Copy` and zero-alloc.
/// Use [`CountryCode::from_bytes`] to construct from `[u8; 2]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CountryCode(pub u16);

impl CountryCode {
    /// Constructs a `CountryCode` from two ASCII bytes (e.g. `b"NG"`).
    ///
    /// # Panics
    /// Panics in debug builds if either byte is not an ASCII uppercase letter.
    pub fn from_bytes(code: [u8; 2]) -> Self {
        debug_assert!(
            code[0].is_ascii_uppercase() && code[1].is_ascii_uppercase(),
            "country code must be two uppercase ASCII letters"
        );
        CountryCode(u16::from_be_bytes(code))
    }

    /// Returns the packed `u16` representation.
    pub fn as_u16(self) -> u16 {
        self.0
    }
}

// Convenience constants for frequently tested countries.
/// Nigeria
pub const CC_NG: CountryCode = CountryCode(u16::from_be_bytes(*b"NG"));
/// Kenya
pub const CC_KE: CountryCode = CountryCode(u16::from_be_bytes(*b"KE"));
/// South Africa
pub const CC_ZA: CountryCode = CountryCode(u16::from_be_bytes(*b"ZA"));
/// Ghana
pub const CC_GH: CountryCode = CountryCode(u16::from_be_bytes(*b"GH"));
/// Rwanda
pub const CC_RW: CountryCode = CountryCode(u16::from_be_bytes(*b"RW"));
/// Egypt
pub const CC_EG: CountryCode = CountryCode(u16::from_be_bytes(*b"EG"));

/// Error codes returned by the verifier functions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifierError {
    /// Account is in KYC Tier 0 — no operations permitted.
    KycBlocked,
    /// Country is not on the Tier-1 allow-list.
    CountryNotAllowed,
    /// The requested amount would exceed the tier's daily cap.
    DailyCapExceeded,
    /// The `requested` amount is zero or negative.
    InvalidAmount,
    /// The provided KYC score is out of the valid range `[0, 100]`.
    InvalidScore,
    /// The proof byte slice does not match the expected length.
    InvalidProofLength,
    /// The public-inputs slice does not match the expected length.
    ///
    /// The KYC verifier circuit always produces exactly [`PUBLIC_INPUTS_LEN`]
    /// public inputs. Passing more or fewer is a protocol error.
    InvalidPublicInputsLength,
    /// A public input encodes a value that violates a protocol invariant
    /// (e.g., `min_tier > 3`, `requested_amount == 0`, `daily_cap` mismatch).
    InvalidPublicInputValue,
    /// The proof bytes are all-zero or otherwise trivially invalid (forged /
    /// default-initialised). A valid Barretenberg proof never has this form.
    TriviallyInvalidProof,
}

// ---------------------------------------------------------------------------
// KYC tier derivation
// ---------------------------------------------------------------------------

/// Derives a [`KycTier`] from a numeric score in the range `[0, 100]`.
///
/// Returns `Err(VerifierError::InvalidScore)` for scores above 100.
///
/// # Examples
///
/// ```
/// use verifier::{kyc_tier_from_score, KycTier};
///
/// assert_eq!(kyc_tier_from_score(0).unwrap(),  KycTier::Zero);
/// assert_eq!(kyc_tier_from_score(29).unwrap(), KycTier::Zero);
/// assert_eq!(kyc_tier_from_score(30).unwrap(), KycTier::One);
/// assert_eq!(kyc_tier_from_score(60).unwrap(), KycTier::Two);
/// assert_eq!(kyc_tier_from_score(90).unwrap(), KycTier::Three);
/// assert!(kyc_tier_from_score(101).is_err());
/// ```
pub fn kyc_tier_from_score(score: u32) -> Result<KycTier, VerifierError> {
    if score > 100 {
        return Err(VerifierError::InvalidScore);
    }
    Ok(match score {
        s if s >= KYC_TIER3_MIN_SCORE => KycTier::Three,
        s if s >= KYC_TIER2_MIN_SCORE => KycTier::Two,
        s if s >= KYC_TIER1_MIN_SCORE => KycTier::One,
        _ => KycTier::Zero,
    })
}

/// Returns the daily cap (in protocol units, 7 decimals) for a given tier.
///
/// Tier 3 returns [`i128::MAX`] (effectively unlimited).
pub fn daily_cap_for_tier(tier: KycTier) -> i128 {
    match tier {
        KycTier::Zero => 0,
        KycTier::One => KYC_TIER1_DAILY_CAP,
        KycTier::Two => KYC_TIER2_DAILY_CAP,
        KycTier::Three => KYC_TIER3_DAILY_CAP,
    }
}

// ---------------------------------------------------------------------------
// Country check
// ---------------------------------------------------------------------------

/// Tier-1 country allow-list: African markets supported in the initial launch.
///
/// Stored as a sorted slice of `u16` values so the check is `O(log n)`.
const TIER1_ALLOWED_COUNTRIES: &[u16] = &[
    u16::from_be_bytes(*b"EG"), // Egypt
    u16::from_be_bytes(*b"GH"), // Ghana
    u16::from_be_bytes(*b"KE"), // Kenya
    u16::from_be_bytes(*b"MA"), // Morocco
    u16::from_be_bytes(*b"MZ"), // Mozambique
    u16::from_be_bytes(*b"NG"), // Nigeria
    u16::from_be_bytes(*b"RW"), // Rwanda
    u16::from_be_bytes(*b"SN"), // Senegal
    u16::from_be_bytes(*b"TZ"), // Tanzania
    u16::from_be_bytes(*b"UG"), // Uganda
    u16::from_be_bytes(*b"ZA"), // South Africa
    u16::from_be_bytes(*b"ZM"), // Zambia
];

/// Returns `true` if `country` is on the Tier-1 country allow-list.
///
/// Tier-2 and Tier-3 accounts are unrestricted by country.
pub fn is_country_allowed_for_tier1(country: CountryCode) -> bool {
    TIER1_ALLOWED_COUNTRIES.binary_search(&country.as_u16()).is_ok()
}

// ---------------------------------------------------------------------------
// Rate-gate (daily cap check)
// ---------------------------------------------------------------------------

/// Verifies that an account is permitted to transact `requested` units given:
///
/// * `tier`           — the account's KYC tier (derived from KYC score).
/// * `country`        — the account's registered country.
/// * `already_used`   — protocol units already consumed in the current window.
/// * `requested`      — protocol units being requested in this transaction.
///
/// Returns `Ok(new_total)` — the updated window total — on success, or a
/// [`VerifierError`] describing the failure.
///
/// # Errors
///
/// | Condition                                    | Error                           |
/// |----------------------------------------------|---------------------------------|
/// | `requested <= 0`                             | `InvalidAmount`                 |
/// | `tier == KycTier::Zero`                      | `KycBlocked`                    |
/// | `tier == KycTier::One` & country not allowed | `CountryNotAllowed`             |
/// | `already_used + requested > cap`             | `DailyCapExceeded`              |
pub fn check_rate_gate(
    tier: KycTier,
    country: CountryCode,
    already_used: i128,
    requested: i128,
) -> Result<i128, VerifierError> {
    if requested <= 0 {
        return Err(VerifierError::InvalidAmount);
    }

    match tier {
        KycTier::Zero => return Err(VerifierError::KycBlocked),
        KycTier::One => {
            if !is_country_allowed_for_tier1(country) {
                return Err(VerifierError::CountryNotAllowed);
            }
        }
        KycTier::Two | KycTier::Three => { /* no country restriction */ }
    }

    let cap = daily_cap_for_tier(tier);

    // cap == i128::MAX means unlimited; skip overflow-prone addition check.
    if cap != i128::MAX {
        let new_total = already_used
            .checked_add(requested)
            .ok_or(VerifierError::DailyCapExceeded)?;

        if new_total > cap {
            return Err(VerifierError::DailyCapExceeded);
        }

        Ok(new_total)
    } else {
        // Tier 3: no cap, but still return a meaningful total (saturating).
        Ok(already_used.saturating_add(requested))
    }
}

// ---------------------------------------------------------------------------
// Per-pool / per-policy access checks (AZ-010)
// ---------------------------------------------------------------------------

/// Pool-local access policy. Unlike a global "wallet was ever verified" flag,
/// this captures the thresholds a *specific* pool (or product) requires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolAccessPolicy {
    /// Minimum KYC tier the pool accepts.
    pub required_tier: KycTier,
    /// When `Some`, the user's country must equal this code. When `None`, the
    /// pool does not impose an extra country restriction beyond the tier rules
    /// already enforced by [`check_rate_gate`].
    pub allowed_country: Option<CountryCode>,
}

/// Evaluate whether a wallet may enter a pool under that pool's policy.
///
/// Global verification alone is **not** sufficient: a user who cleared a
/// low-tier / permissive pool must still be rejected by a stricter pool that
/// demands a higher KYC tier or a specific country allow-list.
///
/// # Errors
///
/// | Condition                                         | Error                |
/// |---------------------------------------------------|----------------------|
/// | `user_tier < policy.required_tier`                | `KycBlocked`         |
/// | `policy.allowed_country` set and country mismatch | `CountryNotAllowed`  |
pub fn check_pool_access(
    user_tier: KycTier,
    user_country: CountryCode,
    policy: PoolAccessPolicy,
) -> Result<(), VerifierError> {
    if user_tier < policy.required_tier {
        return Err(VerifierError::KycBlocked);
    }
    if let Some(required) = policy.allowed_country {
        if user_country != required {
            return Err(VerifierError::CountryNotAllowed);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Fee calculation helpers (pure arithmetic, no Soroban dependency)
// ---------------------------------------------------------------------------

/// Computes the fee amount for a given `amount` and `fee_rate_bps`.
///
/// Uses checked arithmetic; panics on overflow (which would require astronomically
/// large values — not reachable with protocol limits).
pub fn calculate_fee(amount: i128, fee_rate_bps: i128) -> i128 {
    amount
        .checked_mul(fee_rate_bps)
        .and_then(|v| v.checked_div(BASIS_POINTS))
        .expect("overflow in fee calculation")
}

/// Returns `amount - fee` where fee is computed via [`calculate_fee`].
pub fn calculate_amount_after_fee(amount: i128, fee_rate_bps: i128) -> i128 {
    amount
        .checked_sub(calculate_fee(amount, fee_rate_bps))
        .expect("underflow in amount-after-fee calculation")
}

/// Calculates the deviation between two values in basis points relative to `base`.
///
/// Returns [`i128::MAX`] when `base` is zero.
pub fn calculate_deviation_bps(value: i128, base: i128) -> i128 {
    if base == 0 {
        return i128::MAX;
    }
    let diff = if value > base { value - base } else { base - value };
    (diff * BASIS_POINTS) / base
}

/// Computes the median of a slice of `i128` values without requiring a heap
/// allocator or Soroban SDK.
///
/// Returns `None` for an empty slice. For an even-length slice the two middle
/// values are averaged (truncating towards zero).
pub fn median_of_slice(values: &[i128]) -> Option<i128> {
    if values.is_empty() {
        return None;
    }

    let mut sorted = values.to_vec();
    sorted.sort_unstable();

    let n = sorted.len();
    let mid = n / 2;

    if n % 2 == 0 {
        sorted[mid - 1]
            .checked_add(sorted[mid])
            .and_then(|s| s.checked_div(2))
    } else {
        Some(sorted[mid])
    }
}

// ---------------------------------------------------------------------------
// Unit tests — run with `cargo test -p verifier` (no Docker, no Soroban env)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── kyc_tier_from_score ─────────────────────────────────────────────────

    #[test]
    fn score_0_is_tier_zero() {
        assert_eq!(kyc_tier_from_score(0).unwrap(), KycTier::Zero);
    }

    #[test]
    fn score_29_is_tier_zero() {
        assert_eq!(kyc_tier_from_score(29).unwrap(), KycTier::Zero);
    }

    #[test]
    fn score_30_is_tier_one() {
        assert_eq!(kyc_tier_from_score(30).unwrap(), KycTier::One);
    }

    #[test]
    fn score_59_is_tier_one() {
        assert_eq!(kyc_tier_from_score(59).unwrap(), KycTier::One);
    }

    #[test]
    fn score_60_is_tier_two() {
        assert_eq!(kyc_tier_from_score(60).unwrap(), KycTier::Two);
    }

    #[test]
    fn score_89_is_tier_two() {
        assert_eq!(kyc_tier_from_score(89).unwrap(), KycTier::Two);
    }

    #[test]
    fn score_90_is_tier_three() {
        assert_eq!(kyc_tier_from_score(90).unwrap(), KycTier::Three);
    }

    #[test]
    fn score_100_is_tier_three() {
        assert_eq!(kyc_tier_from_score(100).unwrap(), KycTier::Three);
    }

    #[test]
    fn score_101_is_invalid() {
        assert_eq!(
            kyc_tier_from_score(101).unwrap_err(),
            VerifierError::InvalidScore
        );
    }

    #[test]
    fn score_u32_max_is_invalid() {
        assert_eq!(
            kyc_tier_from_score(u32::MAX).unwrap_err(),
            VerifierError::InvalidScore
        );
    }

    // ── daily_cap_for_tier ──────────────────────────────────────────────────

    #[test]
    fn tier_zero_cap_is_zero() {
        assert_eq!(daily_cap_for_tier(KycTier::Zero), 0);
    }

    #[test]
    fn tier_one_cap_is_100_acbu() {
        assert_eq!(daily_cap_for_tier(KycTier::One), 100 * DECIMALS);
    }

    #[test]
    fn tier_two_cap_is_10_000_acbu() {
        assert_eq!(daily_cap_for_tier(KycTier::Two), 10_000 * DECIMALS);
    }

    #[test]
    fn tier_three_cap_is_unlimited() {
        assert_eq!(daily_cap_for_tier(KycTier::Three), i128::MAX);
    }

    // ── is_country_allowed_for_tier1 ────────────────────────────────────────

    #[test]
    fn nigeria_is_allowed() {
        assert!(is_country_allowed_for_tier1(CC_NG));
    }

    #[test]
    fn kenya_is_allowed() {
        assert!(is_country_allowed_for_tier1(CC_KE));
    }

    #[test]
    fn south_africa_is_allowed() {
        assert!(is_country_allowed_for_tier1(CC_ZA));
    }

    #[test]
    fn ghana_is_allowed() {
        assert!(is_country_allowed_for_tier1(CC_GH));
    }

    #[test]
    fn rwanda_is_allowed() {
        assert!(is_country_allowed_for_tier1(CC_RW));
    }

    #[test]
    fn egypt_is_allowed() {
        assert!(is_country_allowed_for_tier1(CC_EG));
    }

    #[test]
    fn us_is_not_allowed() {
        let us = CountryCode::from_bytes(*b"US");
        assert!(!is_country_allowed_for_tier1(us));
    }

    #[test]
    fn gb_is_not_allowed() {
        let gb = CountryCode::from_bytes(*b"GB");
        assert!(!is_country_allowed_for_tier1(gb));
    }

    #[test]
    fn cn_is_not_allowed() {
        let cn = CountryCode::from_bytes(*b"CN");
        assert!(!is_country_allowed_for_tier1(cn));
    }

    // ── check_rate_gate ─────────────────────────────────────────────────────

    #[test]
    fn tier_zero_always_blocked() {
        assert_eq!(
            check_rate_gate(KycTier::Zero, CC_NG, 0, DECIMALS).unwrap_err(),
            VerifierError::KycBlocked
        );
    }

    #[test]
    fn zero_requested_is_invalid() {
        assert_eq!(
            check_rate_gate(KycTier::One, CC_NG, 0, 0).unwrap_err(),
            VerifierError::InvalidAmount
        );
    }

    #[test]
    fn negative_requested_is_invalid() {
        assert_eq!(
            check_rate_gate(KycTier::Two, CC_NG, 0, -1).unwrap_err(),
            VerifierError::InvalidAmount
        );
    }

    #[test]
    fn tier1_allowed_country_within_cap_ok() {
        let new_total =
            check_rate_gate(KycTier::One, CC_NG, 0, 50 * DECIMALS).unwrap();
        assert_eq!(new_total, 50 * DECIMALS);
    }

    #[test]
    fn tier1_disallowed_country_blocked() {
        let us = CountryCode::from_bytes(*b"US");
        assert_eq!(
            check_rate_gate(KycTier::One, us, 0, 10 * DECIMALS).unwrap_err(),
            VerifierError::CountryNotAllowed
        );
    }

    #[test]
    fn tier1_exact_cap_succeeds() {
        // Exactly consuming the daily cap should be allowed.
        let new_total =
            check_rate_gate(KycTier::One, CC_NG, 0, KYC_TIER1_DAILY_CAP).unwrap();
        assert_eq!(new_total, KYC_TIER1_DAILY_CAP);
    }

    #[test]
    fn tier1_exceeds_cap_blocked() {
        // One unit over the daily cap must be rejected.
        assert_eq!(
            check_rate_gate(KycTier::One, CC_NG, 0, KYC_TIER1_DAILY_CAP + 1)
                .unwrap_err(),
            VerifierError::DailyCapExceeded
        );
    }

    #[test]
    fn tier1_partial_usage_then_fills_exactly() {
        let half = KYC_TIER1_DAILY_CAP / 2;
        let new_total = check_rate_gate(KycTier::One, CC_NG, half, half).unwrap();
        assert_eq!(new_total, KYC_TIER1_DAILY_CAP);
    }

    #[test]
    fn tier1_partial_usage_then_exceeds_cap() {
        let half = KYC_TIER1_DAILY_CAP / 2;
        assert_eq!(
            check_rate_gate(KycTier::One, CC_NG, half, half + 1).unwrap_err(),
            VerifierError::DailyCapExceeded
        );
    }

    #[test]
    fn tier2_no_country_restriction() {
        let us = CountryCode::from_bytes(*b"US");
        let result = check_rate_gate(KycTier::Two, us, 0, 1_000 * DECIMALS);
        assert!(result.is_ok());
    }

    #[test]
    fn tier2_exact_cap_succeeds() {
        let new_total =
            check_rate_gate(KycTier::Two, CC_NG, 0, KYC_TIER2_DAILY_CAP).unwrap();
        assert_eq!(new_total, KYC_TIER2_DAILY_CAP);
    }

    #[test]
    fn tier2_exceeds_cap_blocked() {
        assert_eq!(
            check_rate_gate(KycTier::Two, CC_NG, 0, KYC_TIER2_DAILY_CAP + 1)
                .unwrap_err(),
            VerifierError::DailyCapExceeded
        );
    }

    #[test]
    fn tier3_no_cap_large_amount() {
        // Tier 3 must never be blocked by a cap check.
        let large = 1_000_000_000 * DECIMALS; // 1 billion ACBU
        let result = check_rate_gate(KycTier::Three, CC_NG, 0, large);
        assert!(result.is_ok());
    }

    #[test]
    fn tier3_disallowed_country_still_allowed() {
        // Country restrictions do not apply to Tier 3.
        let us = CountryCode::from_bytes(*b"US");
        let result = check_rate_gate(KycTier::Three, us, 0, 1_000 * DECIMALS);
        assert!(result.is_ok());
    }

    #[test]
    fn tier3_accumulates_without_cap() {
        let very_large = i128::MAX / 2;
        let result = check_rate_gate(KycTier::Three, CC_NG, 0, very_large);
        assert!(result.is_ok());
    }

    // ── calculate_fee ───────────────────────────────────────────────────────

    #[test]
    fn fee_zero_rate() {
        assert_eq!(calculate_fee(1_000 * DECIMALS, 0), 0);
    }

    #[test]
    fn fee_3_percent() {
        // 1000 ACBU at 3% = 30 ACBU
        assert_eq!(calculate_fee(1_000 * DECIMALS, 300), 30 * DECIMALS);
    }

    #[test]
    fn fee_100_percent() {
        assert_eq!(calculate_fee(1_000 * DECIMALS, 10_000), 1_000 * DECIMALS);
    }

    #[test]
    fn fee_truncates_correctly() {
        // 1 unit at 300 bps = 0 (integer truncation — no fractional units)
        assert_eq!(calculate_fee(1, 300), 0);
    }

    // ── calculate_amount_after_fee ──────────────────────────────────────────

    #[test]
    fn net_after_fee_3_percent() {
        let amount = 1_000 * DECIMALS;
        assert_eq!(calculate_amount_after_fee(amount, 300), 970 * DECIMALS);
    }

    #[test]
    fn net_after_fee_zero_rate_is_full_amount() {
        let amount = 5_000 * DECIMALS;
        assert_eq!(calculate_amount_after_fee(amount, 0), amount);
    }

    #[test]
    fn fee_plus_net_equals_amount() {
        let amount = 7_654_321_i128;
        let fee_rate = 123_i128; // 1.23%
        let fee = calculate_fee(amount, fee_rate);
        let net = calculate_amount_after_fee(amount, fee_rate);
        assert_eq!(fee + net, amount, "fee + net must equal original amount");
    }

    // ── calculate_deviation_bps ─────────────────────────────────────────────

    #[test]
    fn deviation_zero_when_equal() {
        assert_eq!(calculate_deviation_bps(1_000_000, 1_000_000), 0);
    }

    #[test]
    fn deviation_50_percent() {
        // value = 150, base = 100 → diff = 50 → 5000 bps
        assert_eq!(calculate_deviation_bps(150, 100), 5_000);
    }

    #[test]
    fn deviation_3_percent() {
        // Outlier threshold: >300 bps
        assert_eq!(calculate_deviation_bps(103, 100), 300);
    }

    #[test]
    fn deviation_below_outlier_threshold() {
        // 2% deviation — below the 300 bps threshold
        assert_eq!(calculate_deviation_bps(102, 100), 200);
    }

    #[test]
    fn deviation_zero_base_returns_max() {
        assert_eq!(calculate_deviation_bps(100, 0), i128::MAX);
    }

    #[test]
    fn deviation_symmetric_for_below_and_above() {
        // Deviation from 90 relative to 100 = 10/100 = 1000 bps
        assert_eq!(calculate_deviation_bps(90, 100), 1_000);
    }

    // ── median_of_slice ─────────────────────────────────────────────────────

    #[test]
    fn median_empty_slice_is_none() {
        assert_eq!(median_of_slice(&[]), None);
    }

    #[test]
    fn median_single_element() {
        assert_eq!(median_of_slice(&[42]), Some(42));
    }

    #[test]
    fn median_odd_unsorted() {
        assert_eq!(median_of_slice(&[5, 1, 3]), Some(3));
    }

    #[test]
    fn median_even_sorted() {
        // (3 + 5) / 2 = 4
        assert_eq!(median_of_slice(&[1, 3, 5, 7]), Some(4));
    }

    #[test]
    fn median_even_unsorted() {
        assert_eq!(median_of_slice(&[7, 1, 5, 3]), Some(4));
    }

    #[test]
    fn median_five_oracle_rates() {
        // Typical validator submission: 5 source rates
        let rates = [
            1_000_000_i128,
            1_005_000,
            1_010_000,
            1_350_000, // outlier — should not affect median
            995_000,
        ];
        assert_eq!(median_of_slice(&rates), Some(1_005_000));
    }

    #[test]
    fn median_three_identical_rates() {
        assert_eq!(median_of_slice(&[7, 7, 7]), Some(7));
    }

    #[test]
    fn median_two_middle_overflow_returns_none() {
        // Even-length: (i128::MAX + i128::MAX) overflows checked_add → None
        assert_eq!(median_of_slice(&[i128::MAX, i128::MAX]), None);
    }

    #[test]
    fn median_negative_values() {
        assert_eq!(median_of_slice(&[-3, -1, -2]), Some(-2));
    }

    // ── KYC tier + rate-gate integration scenario ───────────────────────────

    #[test]
    fn full_flow_tier1_nigeria_within_cap() {
        // Simulate: score=50, country=NG, already_used=0, requesting 10 ACBU
        let tier = kyc_tier_from_score(50).unwrap();
        assert_eq!(tier, KycTier::One);

        let result = check_rate_gate(tier, CC_NG, 0, 10 * DECIMALS);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 10 * DECIMALS);
    }

    #[test]
    fn full_flow_tier1_us_blocked() {
        let tier = kyc_tier_from_score(50).unwrap();
        let us = CountryCode::from_bytes(*b"US");
        let result = check_rate_gate(tier, us, 0, 10 * DECIMALS);
        assert_eq!(result.unwrap_err(), VerifierError::CountryNotAllowed);
    }

    #[test]
    fn full_flow_tier0_always_blocked() {
        let tier = kyc_tier_from_score(0).unwrap();
        let result = check_rate_gate(tier, CC_NG, 0, 1);
        assert_eq!(result.unwrap_err(), VerifierError::KycBlocked);
    }

    #[test]
    fn full_flow_tier2_us_allowed() {
        let tier = kyc_tier_from_score(65).unwrap();
        let us = CountryCode::from_bytes(*b"US");
        let result = check_rate_gate(tier, us, 0, 5_000 * DECIMALS);
        assert!(result.is_ok());
    }

    #[test]
    fn full_flow_tier3_institutional_no_restrictions() {
        let tier = kyc_tier_from_score(95).unwrap();
        let us = CountryCode::from_bytes(*b"US");
        let large = 500_000 * DECIMALS;
        let result = check_rate_gate(tier, us, 0, large);
        assert!(result.is_ok());
    }

    #[test]
    fn daily_window_accumulates_across_calls() {
        let tier = KycTier::One;
        // First call: 40 ACBU
        let after_first =
            check_rate_gate(tier, CC_KE, 0, 40 * DECIMALS).unwrap();
        // Second call: 40 more ACBU — still within 100 ACBU cap
        let after_second =
            check_rate_gate(tier, CC_KE, after_first, 40 * DECIMALS).unwrap();
        assert_eq!(after_second, 80 * DECIMALS);
        // Third call: 21 ACBU — would push total to 101, exceeds cap
        let result = check_rate_gate(tier, CC_KE, after_second, 21 * DECIMALS);
        assert_eq!(result.unwrap_err(), VerifierError::DailyCapExceeded);
    }

    // ── verify_proof — structural + semantic validation ─────────────────────

    /// Returns a proof that passes every pre-validation guard:
    /// correct length and at least one non-zero byte.
    fn valid_proof() -> Vec<u8> {
        let mut p = vec![0u8; PROOF_BYTES];
        p[0] = 0x01; // non-zero first byte — never all-zero
        p
    }

    /// Returns public inputs that pass every semantic guard:
    /// valid tier, non-zero country, non-zero amount, cap ≥ already_used.
    fn valid_inputs() -> Vec<u128> {
        vec![
            1,             // min_tier = Tier1
            0x4E47,        // country_code = "NG" (Nigeria)
            1_000_000,     // requested_amount > 0
            1_000_000_000, // daily_cap
            0,             // already_used
        ]
    }

    // ── happy path ──────────────────────────────────────────────────────────

    #[test]
    fn verify_proof_valid_inputs_ok() {
        assert!(verify_proof(&valid_proof(), &valid_inputs()).is_ok());
    }

    #[test]
    fn verify_proof_tier3_unlimited_cap_ok() {
        // Tier 3 encodes daily_cap as u64::MAX (sentinel for unlimited).
        let inputs = vec![
            3,            // min_tier = Tier3
            0x4E47,       // country_code = "NG"
            5_000_000,    // requested_amount
            u64::MAX as u128, // daily_cap = unlimited
            0,            // already_used
        ];
        assert!(verify_proof(&valid_proof(), &inputs).is_ok());
    }

    #[test]
    fn verify_proof_already_used_equals_cap_ok() {
        // already_used == daily_cap is exactly at the boundary — still valid.
        let cap = 1_000_000_000_u128;
        let inputs = vec![1, 0x4E47, 1, cap, cap];
        assert!(verify_proof(&valid_proof(), &inputs).is_ok());
    }

    // ── proof-byte rejection ─────────────────────────────────────────────────

    #[test]
    fn verify_proof_short_proof_rejected() {
        let short = vec![0u8; PROOF_BYTES - 1];
        assert_eq!(
            verify_proof(&short, &valid_inputs()).unwrap_err(),
            VerifierError::InvalidProofLength
        );
    }

    #[test]
    fn verify_proof_long_proof_rejected() {
        let long = vec![1u8; PROOF_BYTES + 1];
        assert_eq!(
            verify_proof(&long, &valid_inputs()).unwrap_err(),
            VerifierError::InvalidProofLength
        );
    }

    #[test]
    fn verify_proof_empty_proof_rejected() {
        assert_eq!(
            verify_proof(&[], &valid_inputs()).unwrap_err(),
            VerifierError::InvalidProofLength
        );
    }

    #[test]
    fn verify_proof_all_zero_bytes_rejected_as_forged() {
        // An all-zero byte string is never a valid Barretenberg proof — it
        // must be caught before any cryptographic check.
        let zero_proof = vec![0u8; PROOF_BYTES];
        assert_eq!(
            verify_proof(&zero_proof, &valid_inputs()).unwrap_err(),
            VerifierError::TriviallyInvalidProof
        );
    }

    #[test]
    fn verify_proof_tampered_proof_with_single_zero_run_rejected() {
        // A proof that is all zeros except the very last byte is still trivially
        // invalid for most positions; but here we test the complementary case
        // where only ONE non-zero byte exists — this passes guard 2.
        let mut one_byte_proof = vec![0u8; PROOF_BYTES];
        one_byte_proof[PROOF_BYTES - 1] = 0xFF;
        // Length is correct; not all-zero — passes pre-validation guards.
        // The full cryptographic check (Soroban layer) would reject this,
        // but this test confirms the pre-validation does NOT falsely reject it,
        // so the Soroban layer always receives the call.
        assert!(verify_proof(&one_byte_proof, &valid_inputs()).is_ok());
    }

    // ── public-input length rejection (W2-Z-017) ────────────────────────────

    #[test]
    fn verify_proof_oversized_public_inputs_rejected() {
        let oversized = vec![1u128; PUBLIC_INPUTS_LEN + 1];
        assert_eq!(
            verify_proof(&valid_proof(), &oversized).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    #[test]
    fn verify_proof_massively_oversized_public_inputs_rejected() {
        let huge = vec![1u128; 10_000];
        assert_eq!(
            verify_proof(&valid_proof(), &huge).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    #[test]
    fn verify_proof_undersized_public_inputs_rejected() {
        let undersized = vec![1u128; PUBLIC_INPUTS_LEN - 1];
        assert_eq!(
            verify_proof(&valid_proof(), &undersized).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    #[test]
    fn verify_proof_empty_public_inputs_rejected() {
        assert_eq!(
            verify_proof(&valid_proof(), &[]).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    // ── semantic public-input rejection ─────────────────────────────────────

    #[test]
    fn verify_proof_invalid_tier_above_max_rejected() {
        let mut inputs = valid_inputs();
        inputs[PI_MIN_TIER] = 4; // tier 4 does not exist
        assert_eq!(
            verify_proof(&valid_proof(), &inputs).unwrap_err(),
            VerifierError::InvalidPublicInputValue
        );
    }

    #[test]
    fn verify_proof_absurd_tier_rejected() {
        let mut inputs = valid_inputs();
        inputs[PI_MIN_TIER] = u128::MAX;
        assert_eq!(
            verify_proof(&valid_proof(), &inputs).unwrap_err(),
            VerifierError::InvalidPublicInputValue
        );
    }

    #[test]
    fn verify_proof_zero_country_code_rejected() {
        // A zero country code is not a valid ISO 3166-1 encoding.
        let mut inputs = valid_inputs();
        inputs[PI_COUNTRY_CODE] = 0;
        assert_eq!(
            verify_proof(&valid_proof(), &inputs).unwrap_err(),
            VerifierError::InvalidPublicInputValue
        );
    }

    #[test]
    fn verify_proof_zero_requested_amount_rejected() {
        // A proof committing to a zero-amount transaction is semantically invalid.
        let mut inputs = valid_inputs();
        inputs[PI_REQUESTED_AMOUNT] = 0;
        assert_eq!(
            verify_proof(&valid_proof(), &inputs).unwrap_err(),
            VerifierError::InvalidPublicInputValue
        );
    }

    #[test]
    fn verify_proof_already_used_exceeds_daily_cap_rejected() {
        // already_used > daily_cap is a self-contradictory state that no valid
        // proof could ever encode — reject before touching the cryptographic layer.
        let mut inputs = valid_inputs();
        inputs[PI_DAILY_CAP] = 1_000;
        inputs[PI_ALREADY_USED] = 1_001; // one over the cap
        assert_eq!(
            verify_proof(&valid_proof(), &inputs).unwrap_err(),
            VerifierError::InvalidPublicInputValue
        );
    }

    #[test]
    fn verify_proof_already_used_far_exceeds_cap_rejected() {
        let mut inputs = valid_inputs();
        inputs[PI_DAILY_CAP] = 100;
        inputs[PI_ALREADY_USED] = u128::MAX;
        assert_eq!(
            verify_proof(&valid_proof(), &inputs).unwrap_err(),
            VerifierError::InvalidPublicInputValue
        );
    }

    #[test]
    fn verify_proof_wrong_proof_takes_priority_over_bad_inputs() {
        // Proof-length check fires before public-input checks.
        let short_proof = vec![1u8; 10];
        let bad_inputs: Vec<u128> = vec![];
        assert_eq!(
            verify_proof(&short_proof, &bad_inputs).unwrap_err(),
            VerifierError::InvalidProofLength
        );
    }

    #[test]
    fn verify_proof_forged_proof_takes_priority_over_bad_inputs() {
        // All-zero proof check fires before public-input semantic checks.
        let zero_proof = vec![0u8; PROOF_BYTES];
        let mut bad_inputs = valid_inputs();
        bad_inputs[PI_MIN_TIER] = 99; // also invalid
        assert_eq!(
            verify_proof(&zero_proof, &bad_inputs).unwrap_err(),
            VerifierError::TriviallyInvalidProof
        );
    }

    #[test]
    fn verify_proof_wrong_inputs_length_takes_priority_over_bad_values() {
        // Length check fires before semantic checks.
        let oversized: Vec<u128> = vec![99u128; PUBLIC_INPUTS_LEN + 5]; // tier=99 also invalid
        assert_eq!(
            verify_proof(&valid_proof(), &oversized).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    #[test]
    fn public_inputs_len_constant_matches_circuit() {
        // The KYC circuit has exactly 5 public inputs: min_tier, country_code,
        // requested_amount, daily_cap, already_used.
        assert_eq!(PUBLIC_INPUTS_LEN, 5);
    }

    // ── check_pool_access (AZ-010) ───────────────────────────────────────────

    #[test]
    fn pool_policy_rejects_globally_verified_user_below_required_tier() {
        // User cleared a Tier-1 pool earlier (globally "verified") but this pool
        // requires Tier 2 — must still fail.
        let us = CountryCode::from_bytes(*b"US");
        let policy = PoolAccessPolicy {
            required_tier: KycTier::Two,
            allowed_country: None,
        };
        assert_eq!(
            check_pool_access(KycTier::One, us, policy).unwrap_err(),
            VerifierError::KycBlocked
        );
    }

    #[test]
    fn pool_policy_rejects_wrong_country_even_when_tier_ok() {
        let us = CountryCode::from_bytes(*b"US");
        let ng = CountryCode::from_bytes(*b"NG");
        let policy = PoolAccessPolicy {
            required_tier: KycTier::One,
            allowed_country: Some(us),
        };
        assert_eq!(
            check_pool_access(KycTier::Two, ng, policy).unwrap_err(),
            VerifierError::CountryNotAllowed
        );
    }

    #[test]
    fn pool_policy_allows_matching_tier_and_country() {
        let us = CountryCode::from_bytes(*b"US");
        let policy = PoolAccessPolicy {
            required_tier: KycTier::Two,
            allowed_country: Some(us),
        };
        assert!(check_pool_access(KycTier::Three, us, policy).is_ok());
        assert!(check_pool_access(KycTier::Two, us, policy).is_ok());
    }

}
