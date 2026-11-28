// Poseidon2 hashing over Noir's default BN254 scalar field.
// Note: BN254 and Poseidon2 are NOT natively accelerated by Stellar/Soroban.
// Proof generation and verification run as pure-WASM Rust (no on-chain precompile).
//
// W11-CAR-002: this is the canonical Barretenberg sponge, not a custom
// construction. It mirrors `bb::crypto::FieldSponge` in
// `barretenberg/crypto/poseidon2/sponge/sponge.hpp`, which is what
// `@aztec/bb.js` `BarretenbergSync.poseidon2Hash()` computes off-chain:
//
//   * state width t = 4, rate r = 3, capacity c = 1
//   * domain separator IV = input_length << 64, stored in state[rate]
//   * every full rate-sized block is added into the state, then permuted
//   * the remaining zero-padded block is absorbed and squeezed with one final
//     permutation, returning state[0]
//
// Commitments and nullifiers are computed with bb.js by the prover and then
// checked by the circuit below (and by the SDK), so both sides must agree on
// the exact round constants and sponge layout.

global POSEIDON2_RATE: u32 = 3;
global POSEIDON2_STATE_SIZE: u32 = 4;

fn poseidon2_permute(state: [Field; 4]) -> [Field; 4] {
    std::hash::poseidon2_permutation(state, POSEIDON2_STATE_SIZE)
}

fn poseidon2_hash<let N: u32>(input: [Field; N]) -> Field {
    let iv: Field = (N as Field) * 18446744073709551616; // N << 64
    let mut state = [0, 0, 0, iv];

    let full_blocks = N / POSEIDON2_RATE;
    for block in 0..full_blocks {
        state[0] += input[block * POSEIDON2_RATE];
        state[1] += input[block * POSEIDON2_RATE + 1];
        state[2] += input[block * POSEIDON2_RATE + 2];
        state = poseidon2_permute(state);
    }

    let absorbed = full_blocks * POSEIDON2_RATE;
    for i in 0..(N - absorbed) {
        state[i] += input[absorbed + i];
    }

    poseidon2_permute(state)[0]
}

fn poseidon2_hash_2(a: Field, b: Field) -> Field {
    poseidon2_hash([a, b])
}

fn poseidon2_hash_4(a: Field, b: Field, c: Field, d: Field) -> Field {
    poseidon2_hash([a, b, c, d])
}

// AZ-001 - Defence-in-depth note
//
// `required_kyc` and `allowed_country` are `pub` inputs: the prover must
// commit to them inside the proof.  The circuit alone cannot prevent a
// malicious prover from choosing `required_kyc = 0` and any `allowed_country`,
// because those are valid inputs that trivially satisfy the assertions below.
//
// The **on-chain contract** (`contracts/zk_verifier/src/lib.rs`) closes this
// gap with a second, independent check: it reads its own admin-controlled
// `PolicyParams` from storage and verifies that
//
//   public_inputs[0]  (== required_kyc)    >= policy.min_tier
//   public_inputs[1]  (== allowed_country) == policy.allowed_country
//
// Because the policy lives in contract storage and is only writable by the
// admin, the prover cannot influence these values.  Both the circuit proof
// AND the server-side policy check must pass for `verify()` to succeed.
fn main(
    kyc_level: u64,
    country_code: u64,
    salt: Field,
    commitment: pub Field,
    required_kyc: pub u64,
    allowed_country: pub u64,
    wallet_address_hash: pub u128,
    nullifier: pub Field,
) {
    // Keep the credential and policy inputs inside their documented domains.
    // Without these guards, arbitrary u64 values could be committed and
    // compared successfully even though they are not valid KYC levels or ISO
    // 3166-1 numeric country codes.
    assert(kyc_level <= 3);
    assert(required_kyc <= 3);
    assert(country_code > 0);
    assert(country_code <= 999);
    assert(allowed_country > 0);
    assert(allowed_country <= 999);
    assert(wallet_address_hash != 0);

    // 1) Prove knowledge of the credential behind the commitment
    let computed: Field = poseidon2_hash_4(
        kyc_level as Field,
        country_code as Field,
        salt,
        0,
    );
    assert(computed == commitment);

    // 2) Prove KYC level meets or exceeds the required threshold.
    //    Note: the on-chain contract ALSO enforces this against its stored
    //    policy.min_tier, so the prover cannot bypass by setting required_kyc=0.
    assert(kyc_level >= required_kyc);

    // 3) Prove the country matches the allowed jurisdiction.
    //    Note: the on-chain contract ALSO enforces this against its stored
    //    policy.allowed_country, so the prover cannot bypass by choosing freely.
    assert(country_code == allowed_country);

    // 4) Bind the nullifier to this wallet so one credential cannot be reused
    //    across multiple Stellar accounts.
    let expected_nullifier =
        poseidon2_hash_4(commitment, salt, wallet_address_hash as Field, 0);
    assert(nullifier == expected_nullifier);
}

// Differential vectors: these digests were produced by the canonical
// `@aztec/bb.js@0.87.0` `BarretenbergSync.poseidon2Hash()` (the same library the
// prover uses), so any divergence between the circuit sponge and Barretenberg
// breaks these assertions. Lengths 2, 4 and 5 cover a single block, an exact
// block plus a residual block, and two blocks plus a residual.
#[test]
fn poseidon2_hash_matches_bb_js() {
    assert_eq(
        poseidon2_hash_2(1, 566),
        0x187f528fb9a32a987d16044b249b2eadc5ed916b50b5371b59cc3e9e8b688726,
    );
    assert_eq(
        poseidon2_hash([1, 566, 12345, 0]),
        0x208a72dec0df0224f59fdf62644c391524b9a313a49f62c90f0a20df1c84a391,
    );
    assert_eq(
        poseidon2_hash([1, 2, 3, 4, 5]),
        0x2247be7014a54d17342a7ef677f58d28877780d203860396967f5d0a18d259db,
    );
    assert_eq(
        poseidon2_hash([0, 0, 0, 0]),
        0x20be000d93b852c82d4e02c94e9e61fa3a0e79949aac3af4010620651d416134,
    );
}

#[test]
fn test_valid_basic_kyc_ngn() {
    main(
        1,
        566,
        12345,
        poseidon2_hash_4(1, 566, 12345, 0),
        1,
        566,
        0x0102030405060708090a0b0c0d0e0f10,
        poseidon2_hash_4(
            poseidon2_hash_4(1, 566, 12345, 0),
            12345,
            0x0102030405060708090a0b0c0d0e0f10,
            0,
        ),
    );
}

#[test]
fn test_valid_enterprise_kes() {
    main(
        3,
        404,
        99999,
        poseidon2_hash_4(3, 404, 99999, 0),
        2,
        404,
        0x0102030405060708090a0b0c0d0e0f10,
        poseidon2_hash_4(
            poseidon2_hash_4(3, 404, 99999, 0),
            99999,
            0x0102030405060708090a0b0c0d0e0f10,
            0,
        ),
    );
}

#[test(should_fail)]
fn test_rejects_kyc_level_outside_documented_range() {
    let commitment = poseidon2_hash_4(4, 566, 12345, 0);
    main(
        1,
        566,
        12345,
        commitment,
        1,
        566,
        0x0102030405060708090a0b0c0d0e0f10,
        poseidon2_hash_4(
            commitment,
            12345,
            0x0102030405060708090a0b0c0d0e0f10,
            0,
        ),
    );
}

#[test(should_fail)]
fn test_rejects_country_code_outside_iso_numeric_range() {
    let commitment = poseidon2_hash_4(1, 1000, 12345, 0);
    main(
        1,
        1000,
        12345,
        commitment,
        1,
        1000,
        0x0102030405060708090a0b0c0d0e0f10,
        poseidon2_hash_4(
            commitment,
            12345,
            0x0102030405060708090a0b0c0d0e0f10,
            0,
        ),
    );
}

#[test(should_fail)]
fn test_rejects_zero_country_code() {
    let commitment = poseidon2_hash_4(1, 0, 12345, 0);
    main(
        1,
        0,
        12345,
        commitment,
        1,
        0,
        0x0102030405060708090a0b0c0d0e0f10,
        poseidon2_hash_4(
            commitment,
            12345,
            0x0102030405060708090a0b0c0d0e0f10,
            0,
        ),
    );
}

#[test]
fn test_nullifier_differs_between_accounts() {
    let commitment = poseidon2_hash_4(1, 566, 12345, 0);
    let nullifier_a = poseidon2_hash_4(commitment, 12345, 101, 0);
    let nullifier_b = poseidon2_hash_4(commitment, 12345, 202, 0);
    assert(nullifier_a != nullifier_b);
}

#[test(should_fail)]
fn test_rejects_nullifier_bound_to_another_account() {
    let commitment = poseidon2_hash_4(1, 566, 12345, 0);
    let other_account_nullifier = poseidon2_hash_4(commitment, 12345, 101, 0);
    main(
        1,
        566,
        12345,
        commitment,
        1,
        566,
        202,
        other_account_nullifier,
    );
}

#[test(should_fail)]
fn test_rejects_unbound_wallet_address() {
    let commitment = poseidon2_hash_4(1, 566, 12345, 0);
    main(
        1,
        566,
        12345,
        commitment,
        1,
        566,
        0,
        poseidon2_hash_4(commitment, 12345, 0, 0),
    );
}
