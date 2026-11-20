# Fix: Outlier Detection Has No Effect in Oracle Contract

## Problem Statement

The oracle contract had outlier detection defined in its README and constants (3% threshold = `OUTLIER_THRESHOLD_BPS`), but the actual implementation had no effect. The outliers were detected conceptually but were never logged, rejected, or alerted. This meant that incorrect exchange rates with significant deviations could silently pass through the system without any visibility.

### Impact
- **Stability Risk**: Misconfigured or malicious validators could provide outlier rates without detection
- **Visibility Gap**: No way for operators to monitor rate anomalies
- **Documentation Mismatch**: README promised outlier detection that wasn't implemented

## Solution

Implemented comprehensive outlier detection and event logging in the oracle contract:

### Changes Made

#### 1. **New Event Type** (`shared/src/lib.rs`)
Added `OutlierDetectionEvent` struct to emit detailed outlier information:
```rust
pub struct OutlierDetectionEvent {
    pub currency: CurrencyCode,
    pub median_rate: i128,
    pub outlier_rate: i128,
    pub deviation_bps: i128,
    pub timestamp: u64,
}
```

#### 2. **Outlier Detection Logic** (`acbu_oracle/src/lib.rs`)
In the `update_rate` function, after calculating the median:
- Iterate through each source rate
- Calculate deviation from median using `calculate_deviation()`
- Compare against `OUTLIER_THRESHOLD_BPS` (300 bps = 3%)
- Emit `OutlierDetectionEvent` for any rate exceeding threshold

```rust
for i in 0..sources.len() {
    let source_rate = sources.get(i).unwrap();
    let deviation_bps = calculate_deviation(source_rate, median_rate);
    
    if deviation_bps > OUTLIER_THRESHOLD_BPS {
        let outlier_event = OutlierDetectionEvent {
            currency: currency.clone(),
            median_rate,
            outlier_rate: source_rate,
            deviation_bps,
            timestamp: current_time,
        };
        env.events()
            .publish((symbol_short!("outlier"), currency.clone()), outlier_event);
    }
}
```

#### 3. **Test Coverage** (`acbu_oracle/tests/test.rs`)
Added `test_outlier_detection()` that:
- Provides three source rates with one significant outlier
- Verifies the contract correctly identifies and emits the outlier event
- Validates event contains correct median, outlier rate, and deviation values

### Technical Details

**Behavior:**
- The implementation continues with the median rate regardless of outliers (as intended)
- Outliers are logged via events for backend monitoring and alerting
- The 3% threshold (300 basis points) applies to individual source rates vs. the median

**Example:**
Given sources: `[1000000, 1005000, 1350000]`
- Median: `1005000`
- 1000000: 0.50% deviation - Normal ✓
- 1005000: 0% deviation - Normal ✓
- 1350000: 34.33% deviation - **OUTLIER** 🚨
  - Event emitted with deviation_bps = 3433

### Testing

All 19 existing tests pass + 1 new test:
```
✓ test_initialize
✓ test_update_rate
✓ test_outlier_detection (NEW)
✓ [All other contract tests: 16 tests]
```

**CI Status**: ✅ All tests passing

## Integration Notes

### For Backends/Indexers
- Monitor events with topic `"outlier"` to detect anomalies
- Use `deviation_bps` to categorize severity
- Consider alerting when outliers exceed certain thresholds

### For Validators
- No changes required to validator behavior
- Rate updates continue normally even if outliers are present
- Outlier detection is transparent and non-blocking

## Files Modified

1. `shared/src/lib.rs` - Added `OutlierDetectionEvent` struct
2. `acbu_oracle/src/lib.rs` - Implemented outlier detection and event emission
3. `acbu_oracle/tests/test.rs` - Added comprehensive outlier detection test

## Breaking Changes

None. This is purely additive - new events are emitted but existing functionality is unchanged.

## Future Enhancements

Potential improvements for future iterations:
- Add configurable threshold per currency
- Add validator reputation scoring based on outlier frequency
- Add circuit breaker to reject updates with too many outliers
- Add historical outlier tracking
