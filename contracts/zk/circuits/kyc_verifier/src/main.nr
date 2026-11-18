/// # KYC Verifier Circuit
///
/// Proves that an account satisfies a KYC tier constraint without revealing
/// the underlying KYC score.
///
/// ## Public inputs
///
/// | Field              | Description                                                      |
/// |--------------------|------------------------------------------------------------------|
/// | `min_tier`         | Minimum KYC tier required (0–3)                                  |
/// | `country_code`     | ISO-3166-1 numeric country code of the account                   |
/// | `requested_amount` | Transaction amount in protocol units (7 decimals)                |
/// | `daily_cap`        | Per-tier daily cap (0 = blocked, `Field::max_value` = unlimited) |
/// | `already_used`     | Amount already consumed in the current daily window              |
///
/// ## Private inputs
///
/// | Field        | Description                                                    |
/// |--------------|----------------------------------------------------------------|
/// | `kyc_score`  | The account's raw KYC score (0–100)                            |
/// | `tier`       | Derived tier (0–3); must be consistent with `kyc_score`       |
///
/// ## Constraints
///
/// 1. `kyc_score` is in range [0, 100].
/// 2. `tier` is correctly derived from `kyc_score`.
/// 3. `tier >= min_tier` (tier gate).
/// 4. `requested_amount > 0`.
/// 5. `already_used + requested_amount <= daily_cap`  (unless daily_cap == 0xFFFF…FF).

// ── Score-to-tier derivation ────────────────────────────────────────────────

/// Derives a KYC tier (0–3) from a numeric score.
///
/// Tier boundaries:
///   tier 0 :  score < 30
///   tier 1 : 30 <= score < 60
///   tier 2 : 60 <= score < 90
///   tier 3 : score >= 90
fn score_to_tier(score: Field) -> Field {
    // Cast to u8 for arithmetic; constrain range in caller.
    let s = score as u8;
    if s >= 90 {
        3
    } else if s >= 60 {
        2
    } else if s >= 30 {
        1
    } else {
        0
    }
}

// ── Tier-1 country allow-list ───────────────────────────────────────────────
//
// ISO 3166-1 numeric codes for the Tier-1 allow-list:
//   566 = NG (Nigeria)
//   404 = KE (Kenya)
//   710 = ZA (South Africa)
//   288 = GH (Ghana)
//   646 = RW (Rwanda)
//   818 = EG (Egypt)
//   504 = MA (Morocco)
//   508 = MZ (Mozambique)
//   686 = SN (Senegal)
//   834 = TZ (Tanzania)
//   800 = UG (Uganda)
//   894 = ZM (Zambia)

fn is_country_allowed_tier1(country_code: Field) -> bool {
    let c = country_code as u32;
    (c == 566)
        | (c == 404)
        | (c == 710)
        | (c == 288)
        | (c == 646)
        | (c == 818)
        | (c == 504)
        | (c == 508)
        | (c == 686)
        | (c == 834)
        | (c == 800)
        | (c == 894)
}

// ── Main circuit ────────────────────────────────────────────────────────────

fn main(
    // Public inputs
    min_tier: pub u8,
    country_code: pub Field,
    requested_amount: pub Field,
    daily_cap: pub Field,
    already_used: pub Field,

    // Private inputs
    kyc_score: Field,
    tier: Field,
) {
    // ── Constraint 1: score in [0, 100] ────────────────────────────────────
    let s = kyc_score as u8;
    assert(s as Field == kyc_score, "kyc_score must fit in u8");
    assert(s <= 100, "kyc_score must be <= 100");

    // ── Constraint 2: tier consistent with score ────────────────────────────
    let derived = score_to_tier(kyc_score);
    assert(derived == tier, "tier must match kyc_score");

    // ── Constraint 3: tier gate ─────────────────────────────────────────────
    let t = tier as u8;
    assert(t >= min_tier, "account tier does not meet minimum requirement");

    // ── Constraint 4: positive amount ──────────────────────────────────────
    // Treat requested_amount as u64 so we can compare > 0.
    let ra = requested_amount as u64;
    assert(ra > 0, "requested_amount must be positive");

    // ── Constraint 5a: tier-0 blocked ──────────────────────────────────────
    assert(t != 0, "tier 0 accounts cannot transact");

    // ── Constraint 5b: tier-1 country check ────────────────────────────────
    if t == 1 {
        assert(
            is_country_allowed_tier1(country_code),
            "country not on tier-1 allow-list"
        );
    }

    // ── Constraint 5c: daily cap ────────────────────────────────────────────
    //
    // The sentinel value 2^64-1 means "unlimited" (Tier 3).
    // We compare as u64 to stay within Noir's native integer range.
    let cap_u64 = daily_cap as u64;
    let used_u64 = already_used as u64;

    let unlimited: u64 = 0xFFFFFFFFFFFFFFFF;

    if cap_u64 != unlimited {
        // Check that already_used + requested <= cap (no overflow).
        let new_total = used_u64 + ra;
        assert(new_total >= used_u64, "daily window overflow"); // overflow guard
        assert(new_total <= cap_u64, "daily cap exceeded");
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn test_tier3_institutional_passes() {
    // Score 95 → tier 3, min_tier 3, NG, 500_000 ACBU, unlimited cap
    main(
        3,                    // min_tier
        566,                  // country_code = NG
        5_000_000_000_000,    // requested_amount = 500 000 ACBU (7 dec)
        0xFFFFFFFFFFFFFFFF,   // daily_cap = unlimited
        0,                    // already_used
        95,                   // kyc_score (private)
        3,                    // tier (private)
    );
}

#[test]
fn test_tier2_standard_passes() {
    // Score 65 → tier 2, min_tier 2, US country (not on tier-1 list, allowed for tier 2)
    main(
        2,                   // min_tier
        840,                 // country_code = US (ISO 3166-1 numeric)
        1_000_000_000_000,   // requested_amount = 100 000 ACBU
        1_000_000_000_000,   // daily_cap = 100 000 ACBU
        0,                   // already_used
        65,                  // kyc_score (private)
        2,                   // tier (private)
    );
}

#[test]
fn test_tier1_nigeria_within_cap_passes() {
    // Score 50 → tier 1, Nigeria (566), 10 ACBU of 100 ACBU cap
    main(
        1,              // min_tier
        566,            // country_code = NG
        100_000_000,    // requested_amount = 10 ACBU (7 dec)
        1_000_000_000,  // daily_cap = 100 ACBU
        0,              // already_used
        50,             // kyc_score (private)
        1,              // tier (private)
    );
}

#[test]
fn test_tier1_exact_cap_boundary_passes() {
    // Consuming exactly the daily cap (100 ACBU) must succeed.
    main(
        1,              // min_tier
        566,            // country_code = NG
        1_000_000_000,  // requested_amount = 100 ACBU
        1_000_000_000,  // daily_cap = 100 ACBU
        0,              // already_used
        45,             // kyc_score
        1,              // tier
    );
}

#[test]
fn test_tier2_partially_used_window_passes() {
    // 5 000 ACBU already used, requesting 4 999 ACBU, cap 10 000 ACBU
    main(
        2,                    // min_tier
        566,                  // country_code = NG
        49_990_000_000,       // requested_amount = 4 999 ACBU
        100_000_000_000,      // daily_cap = 10 000 ACBU
        50_000_000_000,       // already_used = 5 000 ACBU
        70,                   // kyc_score
        2,                    // tier
    );
}

#[test]
fn test_tier1_kenya_passes() {
    // Kenya (ISO 3166-1 numeric: 404) is on the tier-1 allow-list.
    main(
        1,
        404,            // KE
        100_000_000,    // 10 ACBU
        1_000_000_000,  // 100 ACBU cap
        0,
        35,
        1,
    );
}

#[test]
fn test_score_boundary_30_becomes_tier1() {
    // Exact boundary: score == 30 must resolve to tier 1.
    main(
        1,
        566,
        100_000_000,
        1_000_000_000,
        0,
        30,  // boundary
        1,
    );
}

#[test]
fn test_score_boundary_60_becomes_tier2() {
    main(
        2,
        566,
        100_000_000,
        100_000_000_000,
        0,
        60,  // boundary
        2,
    );
}

#[test]
fn test_score_boundary_90_becomes_tier3() {
    main(
        3,
        566,
        100_000_000,
        0xFFFFFFFFFFFFFFFF,
        0,
        90,  // boundary
        3,
    );
}
