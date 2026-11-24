/**
 * Bundled ZK-Comply circuit source (Noir).
 * Loaded by `loadCircuit` so the browser prover does not need a network fetch.
 */
export const ZK_COMPLY_CIRCUIT_SOURCE = `// Poseidon2 hash helpers operating over Noir's default BN254 scalar field.
// Note: BN254 and Poseidon2 are NOT natively accelerated by Stellar/Soroban.
// Proof generation and verification run as pure-WASM Rust (no on-chain precompile).
// RATE = 3, state size = 4

fn poseidon2_hash_2(a: Field, b: Field) -> Field {
    let iv: Field = 2 * 18446744073709551616; // 2 << 64
    let mut state = [a, b, 0, iv];
    state = std::hash::poseidon2_permutation(state);
    state[0]
}

fn poseidon2_hash_4(a: Field, b: Field, c: Field, d: Field) -> Field {
    let iv: Field = 4 * 18446744073709551616; // 4 << 64
    let mut state = [0, 0, 0, iv];
    state[0] = state[0] + a;
    state[1] = state[1] + b;
    state[2] = state[2] + c;
    state = std::hash::poseidon2_permutation(state);
    state[0] = state[0] + d;
    state = std::hash::poseidon2_permutation(state);
    state[0]
}

fn main(
    kyc_level: u64,
    country_code: u64,
    salt: Field,
    commitment: pub Field,
    required_kyc: pub u64,
    allowed_country: pub u64,
    nullifier: pub Field,
) {
    // 1) Prove knowledge of the credential behind the commitment
    let computed: Field = poseidon2_hash_4(
        kyc_level as Field,
        country_code as Field,
        salt,
        0,
    );
    assert(computed == commitment);

    // 2) Prove KYC level meets or exceeds the required threshold
    assert(kyc_level >= required_kyc);

    // 3) Prove the country matches the allowed jurisdiction
    assert(country_code == allowed_country);

    // 4) Derive nullifier = hash(commitment, salt) to prevent double-use
    let expected_nullifier = poseidon2_hash_2(commitment, salt);
    assert(nullifier == expected_nullifier);
}
`;
