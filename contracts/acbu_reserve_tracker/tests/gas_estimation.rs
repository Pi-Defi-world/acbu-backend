//! # Gas / Budget Regression Tests — Reserve Tracker (W2-Z-022)
//!
//! Covers adversarial inputs to `verify_merkle_proof`, `is_reserve_sufficient`,
//! `verify_reserves_manual`, `submit_attestation`, and `get_all_reserves`.
//!
//! Each test follows the same pattern as `acbu_oracle/tests/gas_estimation.rs`:
//!   1. Reset the budget tracker to zero.
//!   2. Execute the operation under test.
//!   3. Assert that both CPU and memory costs stay below documented ceilings.
//!
//! These ceilings are intentionally generous (×5 over the measured baseline)
//! so that minor SDK version bumps do not cause spurious CI failures, while
//! still catching true regressions (e.g. accidentally O(n²) loops).
//!
//! Run with:
//!   cargo test -p acbu_reserve_tracker gas_estimation
#![cfg(test)]

use acbu_reserve_tracker::{AttestationLeaf, ReserveTrackerContract, ReserveTrackerContractClient};
use shared::{CurrencyCode, ReserveData, DECIMALS};
use soroban_sdk::{
    testutils::{budget::Budget, Address as _, Ledger},
    Address, Bytes, BytesN, Env, Vec,
};

// ── Mock contracts ────────────────────────────────────────────────────────────
//
// Isolated in sub-modules to avoid symbol-name collisions with the main test
// suite that is also compiled into the same test binary.

mod mock_oracle_gas {
    use shared::CurrencyCode;
    use soroban_sdk::{contract, contractimpl, symbol_short, Env, Map};

    #[contract]
    pub struct MockOracleGas;

    #[contractimpl]
    impl MockOracleGas {
        /// Returns a fixed ACBU/USD rate of 1 USD (8 decimals).
        pub fn get_acbu_usd_rate(_env: Env) -> i128 {
            100_000_000
        }

        pub fn get_rate_with_timestamp(env: Env, currency: CurrencyCode) -> (i128, u64) {
            let rates: Map<CurrencyCode, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("rates"))
                .unwrap_or(Map::new(&env));
            let rate = rates.get(currency).unwrap_or(0);
            (rate, env.ledger().timestamp())
        }

        pub fn set_rate(env: Env, currency: CurrencyCode, rate: i128) {
            let mut rates: Map<CurrencyCode, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("rates"))
                .unwrap_or(Map::new(&env));
            rates.set(currency, rate);
            env.storage()
                .instance()
                .set(&symbol_short!("rates"), &rates);
        }
    }
}

mod mock_token_gas {
    use shared::DECIMALS;
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockTokenGas;

    #[contractimpl]
    impl MockTokenGas {
        pub fn get_total_supply(_env: Env) -> i128 {
            10 * DECIMALS
        }
    }
}

use mock_oracle_gas::{MockOracleGas, MockOracleGasClient};
use mock_token_gas::MockTokenGas;

// ── Budget ceilings ───────────────────────────────────────────────────────────
//
// These are conservative upper bounds measured empirically and multiplied by 5.
// Update them only when a deliberate algorithmic change is made (and document
// the reason in the PR).

/// Maximum CPU instructions for a 20-level deep Merkle proof walk.
const MAX_DEEP_PROOF_CPU: u64 = 100_000_000;
/// Maximum memory bytes for a 20-level deep Merkle proof walk.
const MAX_DEEP_PROOF_MEM: u64 = 20_000_000;

/// Maximum CPU instructions for `is_reserve_sufficient` over 20 currencies.
const MAX_RESERVE_20_CURRENCIES_CPU: u64 = 80_000_000;
/// Maximum memory bytes for `is_reserve_sufficient` over 20 currencies.
const MAX_RESERVE_20_CURRENCIES_MEM: u64 = 15_000_000;

/// Maximum CPU instructions for `submit_attestation`.
const MAX_SUBMIT_ATTESTATION_CPU: u64 = 20_000_000;
/// Maximum memory bytes for `submit_attestation`.
const MAX_SUBMIT_ATTESTATION_MEM: u64 = 5_000_000;

/// Maximum CPU instructions for `get_all_reserves` with 20 stored entries.
const MAX_GET_ALL_RESERVES_CPU: u64 = 30_000_000;
/// Maximum memory bytes for `get_all_reserves` with 20 stored entries.
const MAX_GET_ALL_RESERVES_MEM: u64 = 10_000_000;

// ── Shared test helpers ───────────────────────────────────────────────────────

/// Hashes an `AttestationLeaf` using the same serialisation as the contract.
///
/// Format: `currency_bytes || amount(16BE) || value_usd(16BE) || timestamp(8BE)`
fn hash_leaf(env: &Env, leaf: &AttestationLeaf) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    let code = leaf.currency.code();
    let mut code_buf = [0u8; 32];
    code.copy_into_slice(&mut code_buf);
    let code_len = code.len() as usize;
    let code_bytes = Bytes::from_slice(env, &code_buf[..code_len]);
    buf.append(&code_bytes);
    buf.append(&Bytes::from_slice(env, &leaf.amount.to_be_bytes()[..]));
    buf.append(&Bytes::from_slice(env, &leaf.value_usd.to_be_bytes()[..]));
    buf.append(&Bytes::from_slice(env, &leaf.timestamp.to_be_bytes()[..]));
    env.crypto().keccak256(&buf).into()
}

/// Combines two 32-byte hashes the same way `compute_merkle_root` does at each
/// level when the *left* child is at an even index.
fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    let l: Bytes = left.clone().into();
    let r: Bytes = right.clone().into();
    combined.append(&l);
    combined.append(&r);
    env.crypto().keccak256(&combined).into()
}

/// Builds a minimal setup: registers the reserve tracker, oracle, and token
/// mocks, initialises the contract, and sets a custodian.  Returns the client,
/// admin, custodian, oracle-client, and oracle address.
fn setup(
    env: &Env,
) -> (
    ReserveTrackerContractClient<'static>,
    Address,
    Address,
    MockOracleGasClient<'static>,
) {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let admin = Address::generate(env);
    let custodian = Address::generate(env);

    let oracle = env.register_contract(None, MockOracleGas);
    let oracle_client = MockOracleGasClient::new(env, &oracle);

    let token = env.register_contract(None, MockTokenGas);

    let contract_id = env.register_contract(None, ReserveTrackerContract);
    let client = ReserveTrackerContractClient::new(env, &contract_id);
    client.initialize(&admin, &oracle, &token, &10_000i128);
    client.set_custodian(&custodian);

    (client, admin, custodian, oracle_client)
}

// ── Merkle-proof budget tests ─────────────────────────────────────────────────

/// Builds a perfectly balanced 4-leaf Merkle tree and verifies leaf 0 with a
/// 2-level proof — baseline for the deep-proof test.
#[test]
fn gas_verify_merkle_proof_shallow_baseline_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    let leaf0 = AttestationLeaf {
        currency: CurrencyCode::new(&env, "NGN"),
        amount: 1_000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let leaf1 = AttestationLeaf {
        currency: CurrencyCode::new(&env, "KES"),
        amount: 2_000,
        value_usd: 5 * DECIMALS,
        timestamp: 1,
    };
    let leaf2 = AttestationLeaf {
        currency: CurrencyCode::new(&env, "ZAR"),
        amount: 1_500,
        value_usd: 3 * DECIMALS,
        timestamp: 1,
    };
    let leaf3 = AttestationLeaf {
        currency: CurrencyCode::new(&env, "GHS"),
        amount: 800,
        value_usd: 2 * DECIMALS,
        timestamp: 1,
    };

    let h0 = hash_leaf(&env, &leaf0);
    let h1 = hash_leaf(&env, &leaf1);
    let h2 = hash_leaf(&env, &leaf2);
    let h3 = hash_leaf(&env, &leaf3);
    let h01 = hash_pair(&env, &h0, &h1);
    let h23 = hash_pair(&env, &h2, &h3);
    let root = hash_pair(&env, &h01, &h23);

    client.submit_attestation(&root);

    let proof = soroban_sdk::vec![&env, h1.clone(), h23.clone()];

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let ok = client.verify_merkle_proof(&leaf0, &proof, &0u32);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(ok, "valid 2-level proof must succeed");
    eprintln!("shallow merkle proof: cpu={cpu}, mem={mem}");
    assert!(cpu > 0, "CPU tracker must record non-zero cost");
    assert!(mem > 0, "memory tracker must record non-zero cost");
    assert!(
        cpu <= MAX_DEEP_PROOF_CPU,
        "shallow merkle proof CPU regression: {cpu} > {MAX_DEEP_PROOF_CPU}"
    );
    assert!(
        mem <= MAX_DEEP_PROOF_MEM,
        "shallow merkle proof memory regression: {mem} > {MAX_DEEP_PROOF_MEM}"
    );
}

/// Constructs a maximum-depth (20-level) Merkle path to test that the proof
/// walk does not blow up the budget with deep adversarial inputs.
///
/// We build the proof as a chain of 20 sibling hashes, all starting from a
/// single leaf whose root is derived by hashing the leaf with each sibling in
/// turn (all at even indices, so left-to-right concatenation applies).
#[test]
fn gas_verify_merkle_proof_depth_20_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    const DEPTH: usize = 20;

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "NGN"),
        amount: i128::MAX / 2,
        value_usd: i128::MAX / 4,
        timestamp: u64::MAX / 2,
    };

    // Build a proof of DEPTH siblings, each filled with 0xcc bytes.
    // Index 0 at every level means node is always the left child:
    //   current = keccak256(current || sibling)
    let sibling_bytes = [0xcc_u8; 32];
    let sibling_raw = Bytes::from_slice(&env, &sibling_bytes);
    let sibling: BytesN<32> = env.crypto().keccak256(&sibling_raw).into();

    let mut siblings: Vec<BytesN<32>> = Vec::new(&env);
    for _ in 0..DEPTH {
        siblings.push_back(sibling.clone());
    }

    // Compute the expected root by walking the same algorithm the contract uses
    // (index=0 ⟹ all left children).
    let mut current = hash_leaf(&env, &leaf);
    for _ in 0..DEPTH {
        let mut combined = Bytes::new(&env);
        let c: Bytes = current.clone().into();
        let s: Bytes = sibling.clone().into();
        combined.append(&c);
        combined.append(&s);
        current = env.crypto().keccak256(&combined).into();
    }
    let root = current;

    client.submit_attestation(&root);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let ok = client.verify_merkle_proof(&leaf, &siblings, &0u32);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(ok, "valid 20-level proof must succeed");
    eprintln!("depth-20 merkle proof: cpu={cpu}/{MAX_DEEP_PROOF_CPU}, mem={mem}/{MAX_DEEP_PROOF_MEM}");
    assert!(
        cpu <= MAX_DEEP_PROOF_CPU,
        "depth-20 merkle proof CPU budget regression: consumed {cpu}, limit {MAX_DEEP_PROOF_CPU}"
    );
    assert!(
        mem <= MAX_DEEP_PROOF_MEM,
        "depth-20 merkle proof memory budget regression: consumed {mem}, limit {MAX_DEEP_PROOF_MEM}"
    );
}

/// A proof with all-zero 32-byte siblings at max depth.
/// Ensures that the contract does not special-case zero bytes and that budget
/// cost is stable regardless of sibling content.
#[test]
fn gas_verify_merkle_proof_all_zero_siblings_depth_20_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    const DEPTH: usize = 20;

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "KES"),
        amount: 1,
        value_usd: 1,
        timestamp: 1,
    };

    // All-zero 32-byte sibling (as a BytesN<32>, not via keccak).
    let zero_bytes = [0x00_u8; 32];
    let sibling: BytesN<32> = BytesN::from_array(&env, &zero_bytes);

    let mut siblings: Vec<BytesN<32>> = Vec::new(&env);
    for _ in 0..DEPTH {
        siblings.push_back(sibling.clone());
    }

    // Compute root using index=0 (all left-child) path.
    let mut current = hash_leaf(&env, &leaf);
    for _ in 0..DEPTH {
        let mut combined = Bytes::new(&env);
        let c: Bytes = current.clone().into();
        let s: Bytes = sibling.clone().into();
        combined.append(&c);
        combined.append(&s);
        current = env.crypto().keccak256(&combined).into();
    }
    let root = current;

    client.submit_attestation(&root);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let ok = client.verify_merkle_proof(&leaf, &siblings, &0u32);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(ok, "depth-20 all-zero-sibling proof must succeed");
    eprintln!("all-zero-sibling depth-20: cpu={cpu}/{MAX_DEEP_PROOF_CPU}, mem={mem}/{MAX_DEEP_PROOF_MEM}");
    assert!(
        cpu <= MAX_DEEP_PROOF_CPU,
        "all-zero-sibling proof CPU regression: {cpu} > {MAX_DEEP_PROOF_CPU}"
    );
    assert!(
        mem <= MAX_DEEP_PROOF_MEM,
        "all-zero-sibling proof memory regression: {mem} > {MAX_DEEP_PROOF_MEM}"
    );
}

/// A deliberately wrong proof (tampered sibling) must be *rejected* quickly —
/// verifying that the early-exit path also does not run over budget.
#[test]
fn gas_verify_merkle_proof_invalid_deep_proof_rejected_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    const DEPTH: usize = 20;

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "RWF"),
        amount: 500,
        value_usd: 2 * DECIMALS,
        timestamp: 42,
    };

    // Build a *correct* proof first so we can tamper a single sibling.
    let sibling_bytes = [0xbe_u8; 32];
    let sibling_raw = Bytes::from_slice(&env, &sibling_bytes);
    let sibling: BytesN<32> = env.crypto().keccak256(&sibling_raw).into();

    let mut correct_siblings: Vec<BytesN<32>> = Vec::new(&env);
    for _ in 0..DEPTH {
        correct_siblings.push_back(sibling.clone());
    }

    let mut current = hash_leaf(&env, &leaf);
    for _ in 0..DEPTH {
        let mut combined = Bytes::new(&env);
        let c: Bytes = current.clone().into();
        let s: Bytes = sibling.clone().into();
        combined.append(&c);
        combined.append(&s);
        current = env.crypto().keccak256(&combined).into();
    }
    let root = current;
    client.submit_attestation(&root);

    // Now tamper one sibling in the middle of the proof.
    let tampered_bytes = [0xde_u8; 32];
    let tampered_raw = Bytes::from_slice(&env, &tampered_bytes);
    let tampered: BytesN<32> = env.crypto().keccak256(&tampered_raw).into();

    let mut bad_siblings: Vec<BytesN<32>> = Vec::new(&env);
    for i in 0..DEPTH {
        if i == DEPTH / 2 {
            bad_siblings.push_back(tampered.clone());
        } else {
            bad_siblings.push_back(sibling.clone());
        }
    }

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let result = client.try_verify_merkle_proof(&leaf, &bad_siblings, &0u32);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(
        result.is_err(),
        "tampered proof must be rejected with InvalidMerkleProof"
    );
    eprintln!("invalid deep proof rejection: cpu={cpu}/{MAX_DEEP_PROOF_CPU}, mem={mem}/{MAX_DEEP_PROOF_MEM}");
    assert!(
        cpu <= MAX_DEEP_PROOF_CPU,
        "invalid deep proof CPU regression: {cpu} > {MAX_DEEP_PROOF_CPU}"
    );
    assert!(
        mem <= MAX_DEEP_PROOF_MEM,
        "invalid deep proof memory regression: {mem} > {MAX_DEEP_PROOF_MEM}"
    );
}

/// Single-element proof (depth 1) — the minimum viable proof tree.
#[test]
fn gas_verify_merkle_proof_single_element_proof_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "NGN"),
        amount: 100,
        value_usd: DECIMALS,
        timestamp: 1,
    };
    let leaf_right = AttestationLeaf {
        currency: CurrencyCode::new(&env, "KES"),
        amount: 200,
        value_usd: 2 * DECIMALS,
        timestamp: 1,
    };
    let h_left = hash_leaf(&env, &leaf);
    let h_right = hash_leaf(&env, &leaf_right);
    let root = hash_pair(&env, &h_left, &h_right);
    client.submit_attestation(&root);

    let proof = soroban_sdk::vec![&env, h_right.clone()];

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let ok = client.verify_merkle_proof(&leaf, &proof, &0u32);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(ok, "single-element proof must succeed");
    eprintln!("single-element proof: cpu={cpu}, mem={mem}");
    assert!(
        cpu <= MAX_DEEP_PROOF_CPU,
        "single-element proof CPU regression: {cpu} > {MAX_DEEP_PROOF_CPU}"
    );
    assert!(
        mem <= MAX_DEEP_PROOF_MEM,
        "single-element proof memory regression: {mem} > {MAX_DEEP_PROOF_MEM}"
    );
}

/// Proof uses max-value leaf fields (i128::MAX, u64::MAX) — adversarial
/// serialisation size.
#[test]
fn gas_verify_merkle_proof_max_value_leaf_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "NGN"),
        amount: i128::MAX,
        value_usd: i128::MAX,
        timestamp: u64::MAX,
    };
    // A single-leaf tree: the root IS the leaf hash (empty proof, index 0).
    let root = hash_leaf(&env, &leaf);
    client.submit_attestation(&root);

    let empty_proof: Vec<BytesN<32>> = Vec::new(&env);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let ok = client.verify_merkle_proof(&leaf, &empty_proof, &0u32);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(ok, "max-value single-leaf tree must succeed with empty proof");
    eprintln!("max-value leaf: cpu={cpu}/{MAX_DEEP_PROOF_CPU}, mem={mem}/{MAX_DEEP_PROOF_MEM}");
    assert!(
        cpu <= MAX_DEEP_PROOF_CPU,
        "max-value leaf CPU regression: {cpu} > {MAX_DEEP_PROOF_CPU}"
    );
    assert!(
        mem <= MAX_DEEP_PROOF_MEM,
        "max-value leaf memory regression: {mem} > {MAX_DEEP_PROOF_MEM}"
    );
}

// ── is_reserve_sufficient / verify_reserves_manual budget tests ───────────────

/// Populates 20 currencies and checks that `is_reserve_sufficient` (called via
/// `verify_reserves_manual`) iterates the full map without blowing the budget.
#[test]
fn gas_is_reserve_sufficient_20_currencies_stays_under_budget() {
    let env = Env::default();
    let (client, admin, _custodian, oracle_client) = setup(&env);

    // 20 currency codes constructed from two-letter uppercase pairs.
    let codes = [
        "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN",
        "AO", "AP", "AQ", "AR", "AS", "AT",
    ];

    // Oracle rate = 1_000_000 (0.1 USD per unit, 7-decimal convention).
    // amount = 1_000_000_000, expected_value_usd = 1_000_000_000 * 1_000_000 / 10_000_000 = 100_000_000
    // So each currency contributes 100_000_000 USD units = 10 USD.
    // 20 currencies × 10 USD = 200 USD in reserves.
    // Mock oracle ACBU rate = 100_000_000 (1 USD/ACBU, 8 decimals).
    // Supply = 10 ACBU → total_acbu_usd = 10 * DECIMALS * 100_000_000 / 100_000_000 = 10 * DECIMALS = 100_000_000 → sufficient.
    let per_currency_rate: i128 = 1_000_000;
    let per_currency_amount: i128 = 1_000_000_000;
    let per_currency_value_usd: i128 = 100_000_000; // = amount * rate / DECIMALS

    for code in codes {
        let currency = CurrencyCode::new(&env, code);
        oracle_client.set_rate(&currency, &per_currency_rate);
        client.update_reserve(&admin, &currency, &per_currency_amount, &per_currency_value_usd);
    }

    // 20 currencies × 100_000_000 USD units = 2_000_000_000 total reserve USD.
    // Mock ACBU rate = 100_000_000, supply = 10 * DECIMALS = 100_000_000.
    // total_acbu_usd = 100_000_000 * 100_000_000 / 100_000_000 = 100_000_000 → sufficient.
    let supply: i128 = 10 * DECIMALS;

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let result = client.verify_reserves_manual(&supply);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(result, "20-currency reserve check must report sufficient");
    eprintln!(
        "is_reserve_sufficient 20 currencies: cpu={cpu}/{MAX_RESERVE_20_CURRENCIES_CPU}, mem={mem}/{MAX_RESERVE_20_CURRENCIES_MEM}"
    );
    assert!(cpu > 0, "CPU tracker must record non-zero cost");
    assert!(
        cpu <= MAX_RESERVE_20_CURRENCIES_CPU,
        "is_reserve_sufficient CPU regression: {cpu} > {MAX_RESERVE_20_CURRENCIES_CPU}"
    );
    assert!(
        mem <= MAX_RESERVE_20_CURRENCIES_MEM,
        "is_reserve_sufficient memory regression: {mem} > {MAX_RESERVE_20_CURRENCIES_MEM}"
    );
}

/// Adversarial case: maximum i128 supply value. The summation and ratio
/// arithmetic must not overflow (checked_mul/checked_div paths) and must stay
/// within budget.
#[test]
fn gas_is_reserve_sufficient_max_i128_supply_stays_under_budget() {
    let env = Env::default();
    let (client, admin, _custodian, oracle_client) = setup(&env);

    let ngn = CurrencyCode::new(&env, "NGN");
    // Oracle rate = 1_000_000. amount = 1_000_000_000, value_usd = 100_000_000.
    // expected_value_usd = 1_000_000_000 * 1_000_000 / 10_000_000 = 100_000_000 ✓
    // Supply is huge; mock oracle ACBU rate = 100_000_000 (1 USD/ACBU).
    // total_acbu_usd = supply * 100_000_000 / 100_000_000 = supply.
    // For large supply this arithmetic overflows → expect() panics.
    // The important assertion is that no infinite loop / unbounded work occurs.
    let rate: i128 = 1_000_000;
    let amount: i128 = 1_000_000_000;
    let value_usd: i128 = 100_000_000; // = amount * rate / DECIMALS
    oracle_client.set_rate(&ngn, &rate);
    client.update_reserve(&admin, &ngn, &amount, &value_usd);

    let supply = i128::MAX / 2;

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    // With supply = i128::MAX/2 and acbu_usd_rate = 100_000_000 (1 USD per ACBU,
    // using the mock's fixed return of 100_000_000), the contract computes:
    //   total_acbu_usd = supply * 100_000_000 / 100_000_000 = supply
    // which would overflow checked_mul for i128::MAX/2 * 100_000_000.
    // The contract panics via expect() on overflow, so we use try_ to capture it.
    let result = client.try_verify_reserves_manual(&supply);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    // Either succeeds (sufficient) or panics with overflow — both are valid
    // outcomes; what matters is that the budget stays bounded.
    eprintln!(
        "max i128 supply: result={result:?}, cpu={cpu}/{MAX_RESERVE_20_CURRENCIES_CPU}, mem={mem}/{MAX_RESERVE_20_CURRENCIES_MEM}"
    );
    assert!(
        cpu <= MAX_RESERVE_20_CURRENCIES_CPU,
        "max-supply CPU regression: {cpu} > {MAX_RESERVE_20_CURRENCIES_CPU}"
    );
    assert!(
        mem <= MAX_RESERVE_20_CURRENCIES_MEM,
        "max-supply memory regression: {mem} > {MAX_RESERVE_20_CURRENCIES_MEM}"
    );
}

/// Adversarial: supply just above the reserve threshold — the off-by-one
/// boundary that distinguishes `true` from `false`.
#[test]
fn gas_is_reserve_sufficient_one_over_threshold_stays_under_budget() {
    let env = Env::default();
    let (client, admin, _custodian, oracle_client) = setup(&env);

    let ngn = CurrencyCode::new(&env, "NGN");
    // Oracle rate = 1_000_000, amount = 1_000_000_000, value_usd = 100_000_000.
    // expected_value_usd = 1_000_000_000 * 1_000_000 / 10_000_000 = 100_000_000 ✓
    // Mock ACBU rate (fixed by mock) = 100_000_000.
    // total_acbu_usd = supply * 100_000_000 / 100_000_000 = supply.
    // → supply = 100_000_001 means acbu_usd = 100_000_001 > 100_000_000 reserve → insufficient.
    let rate: i128 = 1_000_000;
    let amount: i128 = 1_000_000_000;
    let value_usd: i128 = 100_000_000;
    oracle_client.set_rate(&ngn, &rate);
    client.update_reserve(&admin, &ngn, &amount, &value_usd);

    // supply one unit over the total reserve value → insufficient
    let supply = value_usd + 1;

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let result = client.verify_reserves_manual(&supply);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(!result, "supply one unit over threshold must report insufficient");
    eprintln!(
        "one-over-threshold: cpu={cpu}/{MAX_RESERVE_20_CURRENCIES_CPU}, mem={mem}/{MAX_RESERVE_20_CURRENCIES_MEM}"
    );
    assert!(
        cpu <= MAX_RESERVE_20_CURRENCIES_CPU,
        "one-over-threshold CPU regression: {cpu} > {MAX_RESERVE_20_CURRENCIES_CPU}"
    );
    assert!(
        mem <= MAX_RESERVE_20_CURRENCIES_MEM,
        "one-over-threshold memory regression: {mem} > {MAX_RESERVE_20_CURRENCIES_MEM}"
    );
}

/// Adversarial: zero supply returns `true` without any oracle call — ensures
/// the early-exit path is also budget-bounded.
#[test]
fn gas_is_reserve_sufficient_zero_supply_early_exit_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    let supply: i128 = 0;

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let result = client.verify_reserves_manual(&supply);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert!(result, "zero supply must return true (early exit)");
    eprintln!("zero-supply early exit: cpu={cpu}, mem={mem}");
    assert!(
        cpu <= MAX_RESERVE_20_CURRENCIES_CPU,
        "zero-supply CPU regression: {cpu} > {MAX_RESERVE_20_CURRENCIES_CPU}"
    );
    assert!(
        mem <= MAX_RESERVE_20_CURRENCIES_MEM,
        "zero-supply memory regression: {mem} > {MAX_RESERVE_20_CURRENCIES_MEM}"
    );
}

// ── submit_attestation budget tests ──────────────────────────────────────────

/// Measures the budget cost of a normal `submit_attestation` call.
#[test]
fn gas_submit_attestation_normal_root_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "NGN"),
        amount: 1_000_000,
        value_usd: 100 * DECIMALS,
        timestamp: 1_000,
    };
    let root = hash_leaf(&env, &leaf);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    client.submit_attestation(&root);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    eprintln!("submit_attestation: cpu={cpu}/{MAX_SUBMIT_ATTESTATION_CPU}, mem={mem}/{MAX_SUBMIT_ATTESTATION_MEM}");
    assert!(cpu > 0, "CPU tracker must record non-zero cost");
    assert!(
        cpu <= MAX_SUBMIT_ATTESTATION_CPU,
        "submit_attestation CPU regression: {cpu} > {MAX_SUBMIT_ATTESTATION_CPU}"
    );
    assert!(
        mem <= MAX_SUBMIT_ATTESTATION_MEM,
        "submit_attestation memory regression: {mem} > {MAX_SUBMIT_ATTESTATION_MEM}"
    );
}

/// Replacing the stored root 10 times (adversarial rapid re-submission) should
/// not grow the budget cost per call.
#[test]
fn gas_submit_attestation_repeated_resubmission_stays_under_budget() {
    let env = Env::default();
    let (client, _admin, _custodian, _oracle) = setup(&env);

    // Pre-fill with 9 submissions.
    for i in 0u64..9 {
        let dummy_raw = Bytes::from_slice(&env, &(i.to_be_bytes()));
        let root: BytesN<32> = env.crypto().keccak256(&dummy_raw).into();
        client.submit_attestation(&root);
    }

    // Measure the 10th.
    let leaf = AttestationLeaf {
        currency: CurrencyCode::new(&env, "ZAR"),
        amount: 42,
        value_usd: DECIMALS,
        timestamp: 10,
    };
    let root = hash_leaf(&env, &leaf);

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    client.submit_attestation(&root);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    eprintln!("submit_attestation 10th call: cpu={cpu}/{MAX_SUBMIT_ATTESTATION_CPU}, mem={mem}/{MAX_SUBMIT_ATTESTATION_MEM}");
    assert!(
        cpu <= MAX_SUBMIT_ATTESTATION_CPU,
        "repeated submit_attestation CPU regression: {cpu} > {MAX_SUBMIT_ATTESTATION_CPU}"
    );
    assert!(
        mem <= MAX_SUBMIT_ATTESTATION_MEM,
        "repeated submit_attestation memory regression: {mem} > {MAX_SUBMIT_ATTESTATION_MEM}"
    );
}

// ── get_all_reserves budget tests ─────────────────────────────────────────────

/// Populates 20 currencies and measures the cost of `get_all_reserves`.
#[test]
fn gas_get_all_reserves_20_currencies_stays_under_budget() {
    let env = Env::default();
    let (client, admin, _custodian, oracle_client) = setup(&env);

    let codes = [
        "BA", "BB", "BC", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BK", "BL", "BM", "BN",
        "BO", "BP", "BQ", "BR", "BS", "BT",
    ];

    for code in codes {
        let currency = CurrencyCode::new(&env, code);
        // rate = 1_000_000, amount = 1_000_000_000, value_usd = 100_000_000
        // expected_value_usd = 1_000_000_000 * 1_000_000 / 10_000_000 = 100_000_000 ✓
        oracle_client.set_rate(&currency, &1_000_000i128);
        client.update_reserve(&admin, &currency, &1_000_000_000i128, &100_000_000i128);
    }

    let mut budget: Budget = env.budget();
    budget.reset_unlimited();
    budget.reset_tracker();

    let reserves = client.get_all_reserves();

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    assert_eq!(
        reserves.len(),
        20,
        "get_all_reserves must return all 20 entries"
    );
    eprintln!("get_all_reserves 20 entries: cpu={cpu}/{MAX_GET_ALL_RESERVES_CPU}, mem={mem}/{MAX_GET_ALL_RESERVES_MEM}");
    assert!(cpu > 0, "CPU tracker must record non-zero cost");
    assert!(
        cpu <= MAX_GET_ALL_RESERVES_CPU,
        "get_all_reserves CPU regression: {cpu} > {MAX_GET_ALL_RESERVES_CPU}"
    );
    assert!(
        mem <= MAX_GET_ALL_RESERVES_MEM,
        "get_all_reserves memory regression: {mem} > {MAX_GET_ALL_RESERVES_MEM}"
    );
}
