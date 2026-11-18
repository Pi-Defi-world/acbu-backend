#![cfg(test)]

use shared::{calculate_amount_after_fee, calculate_fee, calculate_deviation, BASIS_POINTS};

#[test]
fn test_calculate_fee_zero_fee_rate() {
    let amount = 10_000_000i128;
    let fee_rate = 0i128;
    assert_eq!(calculate_fee(amount, fee_rate), 0);
}

#[test]
fn test_calculate_fee_zero_amount() {
    let amount = 0i128;
    let fee_rate = 300i128;
    assert_eq!(calculate_fee(amount, fee_rate), 0);
}

#[test]
fn test_calculate_fee_1_percent() {
    let amount = 10_000_000i128;
    let fee_rate = 100i128;
    let expected = 100_000i128;
    assert_eq!(calculate_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_fee_3_percent() {
    let amount = 10_000_000i128;
    let fee_rate = 300i128;
    let expected = 300_000i128;
    assert_eq!(calculate_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_fee_10_percent() {
    let amount = 10_000_000i128;
    let fee_rate = 1_000i128;
    let expected = 1_000_000i128;
    assert_eq!(calculate_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_fee_100_percent() {
    let amount = 10_000_000i128;
    let fee_rate = BASIS_POINTS;
    let expected = 10_000_000i128;
    assert_eq!(calculate_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_fee_large_amount() {
    let amount = 1_000_000_000_000i128;
    let fee_rate = 300i128;
    let expected = 30_000_000_000i128;
    assert_eq!(calculate_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_fee_small_amount() {
    let amount = 1i128;
    let fee_rate = 300i128;
    assert_eq!(calculate_fee(amount, fee_rate), 0);
}

#[test]
fn test_calculate_amount_after_fee_basic() {
    let amount = 10_000_000i128;
    let fee_rate = 300i128;
    let fee = 300_000i128;
    let expected = 9_700_000i128;
    assert_eq!(calculate_amount_after_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_amount_after_fee_zero_fee() {
    let amount = 10_000_000i128;
    let fee_rate = 0i128;
    assert_eq!(calculate_amount_after_fee(amount, fee_rate), amount);
}

#[test]
fn test_calculate_amount_after_fee_zero_amount() {
    let amount = 0i128;
    let fee_rate = 300i128;
    assert_eq!(calculate_amount_after_fee(amount, fee_rate), 0);
}

#[test]
fn test_calculate_amount_after_fee_high_fee() {
    let amount = 10_000_000i128;
    let fee_rate = 5_000i128;
    let expected = 5_000_000i128;
    assert_eq!(calculate_amount_after_fee(amount, fee_rate), expected);
}

#[test]
fn test_calculate_deviation_equal_values() {
    let value1 = 100i128;
    let value2 = 100i128;
    assert_eq!(calculate_deviation(value1, value2), 0);
}

#[test]
fn test_calculate_deviation_value1_greater() {
    let value1 = 150i128;
    let value2 = 100i128;
    assert_eq!(calculate_deviation(value1, value2), 5_000);
}

#[test]
fn test_calculate_deviation_value2_greater() {
    let value1 = 100i128;
    let value2 = 150i128;
    assert_eq!(calculate_deviation(value1, value2), 3_333);
}

#[test]
fn test_calculate_deviation_small_deviation() {
    let value1 = 101i128;
    let value2 = 100i128;
    assert_eq!(calculate_deviation(value1, value2), 100);
}

#[test]
fn test_calculate_deviation_large_deviation() {
    let value1 = 200i128;
    let value2 = 100i128;
    assert_eq!(calculate_deviation(value1, value2), 10_000);
}

#[test]
fn test_calculate_deviation_zero_divisor() {
    let value1 = 100i128;
    let value2 = 0i128;
    assert_eq!(calculate_deviation(value1, value2), i128::MAX);
}

#[test]
fn test_calculate_deviation_both_zero() {
    let value1 = 0i128;
    let value2 = 0i128;
    assert_eq!(calculate_deviation(value1, value2), i128::MAX);
}

#[test]
fn test_calculate_deviation_negative_value1() {
    let value1 = -100i128;
    let value2 = 100i128;
    assert_eq!(calculate_deviation(value1, value2), 20_000);
}

#[test]
fn test_calculate_deviation_7decimal_rates() {
    let value1 = 1_050_000i128;
    let value2 = 1_000_000i128;
    assert_eq!(calculate_deviation(value1, value2), 500);
}
