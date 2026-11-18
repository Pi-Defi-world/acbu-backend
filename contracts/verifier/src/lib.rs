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

/// Validates a serialised KYC proof together with its public inputs.
///
/// This function acts as the **host-side gate** before any cryptographic
/// verification: it enforces structural invariants that must hold regardless
/// of proof contents, allowing callers to fail fast without paying the cost of
/// a full proof check on malformed inputs.
///
/// # Checks performed
///
/// 1. `proof_bytes.len() == PROOF_BYTES` — rejects proofs that are too short
///    or too long ([`VerifierError::InvalidProofLength`]).
/// 2. `public_inputs.len() == PUBLIC_INPUTS_LEN` — rejects inputs vectors that
///    do not match the circuit's exact public-input count
///    ([`VerifierError::InvalidPublicInputsLength`]).  This is the fix for
///    **W2-Z-017**: without this check a caller could pass an arbitrarily large
///    `public_inputs` slice, causing unbounded memory/gas consumption during
///    downstream cryptographic processing.
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
/// | Condition                                         | Error                         |
/// |---------------------------------------------------|-------------------------------|
/// | `proof_bytes.len() != PROOF_BYTES`                | `InvalidProofLength`          |
/// | `public_inputs.len() != PUBLIC_INPUTS_LEN`        | `InvalidPublicInputsLength`   |
///
/// # Examples
///
/// ```
/// use verifier::{verify_proof, PROOF_BYTES, PUBLIC_INPUTS_LEN, VerifierError};
///
/// // Correct sizes — structural validation passes.
/// let proof = vec![0u8; PROOF_BYTES];
/// let inputs = vec![0u128; PUBLIC_INPUTS_LEN];
/// assert!(verify_proof(&proof, &inputs).is_ok());
///
/// // Wrong proof length — rejected immediately.
/// let short_proof = vec![0u8; 10];
/// assert_eq!(
///     verify_proof(&short_proof, &inputs).unwrap_err(),
///     VerifierError::InvalidProofLength,
/// );
///
/// // Oversized public_inputs — rejected immediately (W2-Z-017 fix).
/// let oversized_inputs = vec![0u128; PUBLIC_INPUTS_LEN + 100];
/// assert_eq!(
///     verify_proof(&proof, &oversized_inputs).unwrap_err(),
///     VerifierError::InvalidPublicInputsLength,
/// );
///
/// // Undersized public_inputs — also rejected.
/// let undersized_inputs = vec![0u128; PUBLIC_INPUTS_LEN - 1];
/// assert_eq!(
///     verify_proof(&proof, &undersized_inputs).unwrap_err(),
///     VerifierError::InvalidPublicInputsLength,
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

    // Guard 2 (W2-Z-017 fix): public inputs must be exactly PUBLIC_INPUTS_LEN.
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

    // Structural validation passed. Full cryptographic proof verification is
    // delegated to the Soroban contract layer (Barretenberg / Noir verifier).
    // This function is intentionally kept pure-Rust so it can be exhaustively
    // unit-tested without a Soroban runtime.
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
            check_rate_gate(KycTier::Zero, CC_NG, 0, 1 * DECIMALS).unwrap_err(),
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

    // ── verify_proof — structural validation (W2-Z-017) ────────────────────

    /// Helper: returns a valid-sized proof byte slice.
    fn valid_proof() -> Vec<u8> {
        vec![0u8; PROOF_BYTES]
    }

    /// Helper: returns a valid-sized public-inputs slice.
    fn valid_inputs() -> Vec<u128> {
        vec![0u128; PUBLIC_INPUTS_LEN]
    }

    #[test]
    fn verify_proof_correct_sizes_ok() {
        // Both sizes are exact — structural validation must pass.
        assert!(verify_proof(&valid_proof(), &valid_inputs()).is_ok());
    }

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
        let long = vec![0u8; PROOF_BYTES + 1];
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

    /// W2-Z-017: oversized public_inputs must be rejected before any
    /// cryptographic work is performed.
    #[test]
    fn verify_proof_oversized_public_inputs_rejected() {
        let oversized = vec![0u128; PUBLIC_INPUTS_LEN + 1];
        assert_eq!(
            verify_proof(&valid_proof(), &oversized).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    /// W2-Z-017: a significantly oversized public_inputs slice (resource/gas
    /// abuse vector) must be rejected at the length check, not during
    /// cryptographic processing.
    #[test]
    fn verify_proof_massively_oversized_public_inputs_rejected() {
        let huge = vec![0u128; 10_000];
        assert_eq!(
            verify_proof(&valid_proof(), &huge).unwrap_err(),
            VerifierError::InvalidPublicInputsLength
        );
    }

    #[test]
    fn verify_proof_undersized_public_inputs_rejected() {
        let undersized = vec![0u128; PUBLIC_INPUTS_LEN - 1];
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

    #[test]
    fn verify_proof_wrong_proof_takes_priority_over_bad_inputs() {
        // Even if public_inputs are wrong size, proof length is checked first.
        let short_proof = vec![0u8; 10];
        let bad_inputs: Vec<u128> = vec![];
        assert_eq!(
            verify_proof(&short_proof, &bad_inputs).unwrap_err(),
            VerifierError::InvalidProofLength
        );
    }

    #[test]
    fn public_inputs_len_constant_matches_circuit() {
        // The KYC circuit has exactly 5 public inputs: min_tier, country_code,
        // requested_amount, daily_cap, already_used.
        assert_eq!(PUBLIC_INPUTS_LEN, 5);
    }
}
