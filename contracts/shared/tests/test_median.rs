#![cfg(test)]

use shared::median;
use soroban_sdk::{testutils::budget::Budget, Env, Vec};

fn make_vec(env: &Env, values: &[i128]) -> Vec<i128> {
    let mut v = Vec::new(env);
    for &x in values {
        v.push_back(x);
    }
    v
}

#[test]
fn test_median_empty_returns_none() {
    let env = Env::default();
    let v: Vec<i128> = Vec::new(&env);
    assert_eq!(median(v), None, "median(v) should equal None");
}

#[test]
fn test_median_single_element() {
    let env = Env::default();
    let v = make_vec(&env, &[42]);
    assert_eq!(median(v), Some(42), "median(v) should equal Some(42)");
}

#[test]
fn test_median_odd_count_sorted() {
    let env = Env::default();
    let v = make_vec(&env, &[1, 3, 5]);
    assert_eq!(median(v), Some(3), "median(v) should equal Some(3)");
}

#[test]
fn test_median_odd_count_unsorted() {
    let env = Env::default();
    let v = make_vec(&env, &[5, 1, 3]);
    assert_eq!(median(v), Some(3), "median(v) should equal Some(3)");
}

#[test]
fn test_median_five_elements_unsorted() {
    let env = Env::default();
    // sorted: [1, 2, 3, 4, 5] → median = 3
    let v = make_vec(&env, &[3, 1, 4, 2, 5]);
    assert_eq!(median(v), Some(3), "median(v) should equal Some(3)");
}

#[test]
fn test_median_even_count_sorted() {
    let env = Env::default();
    // sorted: [1, 3, 5, 7] → median = (3 + 5) / 2 = 4
    let v = make_vec(&env, &[1, 3, 5, 7]);
    assert_eq!(median(v), Some(4), "median(v) should equal Some(4)");
}

#[test]
fn test_median_even_count_unsorted() {
    let env = Env::default();
    let v = make_vec(&env, &[7, 1, 5, 3]);
    assert_eq!(median(v), Some(4), "median(v) should equal Some(4)");
}

#[test]
fn test_median_two_elements() {
    let env = Env::default();
    let v = make_vec(&env, &[10, 20]);
    assert_eq!(median(v), Some(15), "median(v) should equal Some(15)");
}

#[test]
fn test_median_even_count_add_overflow_returns_none() {
    let env = Env::default();
    // Even-length path averages the two middle values; i128::MAX + i128::MAX overflows.
    let v = make_vec(&env, &[i128::MAX, i128::MAX]);
    assert_eq!(
        median(v),
        None,
        "median of [i128::MAX, i128::MAX] must return None on checked_add overflow"
    );
}

#[test]
fn test_median_all_equal() {
    let env = Env::default();
    let v = make_vec(&env, &[7, 7, 7, 7, 7]);
    assert_eq!(median(v), Some(7), "median(v) should equal Some(7)");
}

#[test]
fn test_median_large_7decimal_rates() {
    let env = Env::default();
    // Simulate oracle source rates at 7 decimals
    let v = make_vec(
        &env,
        &[1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000],
    );
    assert_eq!(median(v), Some(3_000_000), "median(v) should equal Some(3_000_000)");
}

#[test]
fn test_median_six_elements_even_count() {
    let env = Env::default();
    // sorted: [1, 2, 3, 4, 5, 6] → (3 + 4) / 2 = 3
    let v = make_vec(&env, &[4, 1, 6, 3, 2, 5]);
    assert_eq!(median(v), Some(3), "median(v) should equal Some(3)");
}

#[test]
fn test_median_reverse_sorted() {
    let env = Env::default();
    let v = make_vec(&env, &[9, 7, 5, 3, 1]);
    assert_eq!(median(v), Some(5), "median(v) should equal Some(5)");
}

fn measured_median_budget(values: &[i128]) -> (u64, u64) {
    let env = Env::default();
    let v = make_vec(&env, values);

    let mut budget: Budget = env.budget();
    budget.reset_default();
    budget.reset_tracker();

    assert_eq!(median(v), Some(1_000_000), "median(v) should equal Some(1_000_000)");

    (budget.cpu_instruction_cost(), budget.memory_bytes_cost())
}

#[test]
fn test_median_max_source_budget_regression() {
    let values = [
        900_000, 1_050_000, 1_010_000, 970_000, 1_030_000, 980_000, 1_020_000, 960_000, 1_040_000,
        990_000, 1_000_000,
    ];
    let (cpu, mem) = measured_median_budget(&values);

    assert!(cpu > 0, "median budget tracker did not record CPU usage");
    assert!(mem > 0, "median budget tracker did not record memory usage");

    // Native Rust tests underestimate WASM metering, so this is a regression ceiling rather
    // than an exact mainnet fee quote. It still fails if the median path becomes materially
    // more expensive for the largest quorum-sized source set we submit in oracle tests.
    assert!(
        cpu <= 50_000,
        "median CPU budget regression: consumed {cpu}, limit 50_000"
    );
    assert!(
        mem <= 10_000,
        "median memory budget regression: consumed {mem}, limit 10_000"
    );
}
