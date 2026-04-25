# Monetary Precision Fix - Number() to Decimal Migration

## Problem Statement
The backend was using `Number()` on user-supplied strings for monetary calculations, which loses precision vs Decimal and can skew fees/limits. This was identified as a high-severity issue affecting financial accuracy.

## Solution Implemented

### 1. Decimal Library Integration
- **Installed**: `decimal.js` library for high-precision monetary calculations
- **Configuration**: Global Decimal settings with 28-digit precision and ROUND_DOWN mode
- **Utilities**: Created `src/utils/decimalUtils.ts` with helper functions

### 2. Core Utility Functions

#### `parseMonetaryString(value, fieldName)`
- Validates input format (rejects scientific notation, enforces max 7 decimal places)
- Parses strings to Decimal with full precision preservation
- Throws descriptive errors for invalid inputs

#### `decimalToContractNumber(decimal, decimals)`
- Converts Decimal to contract-compatible numbers with explicit rounding
- Uses ROUND_DOWN to prevent fee overcharging
- Handles different decimal precisions (7 for ACBU, 2 for fiat)

#### `contractNumberToDecimal(contractNumber, decimals)`
- Converts contract numbers back to Decimal for database storage
- Maintains precision across contract boundaries

#### `calculateFee(amount, feeBps)`
- Calculates fees using Decimal arithmetic
- Prevents precision loss in fee calculations
- Handles edge cases like tiny amounts and high fee rates

### 3. Controller Updates

#### Mint Controller (`mintController.ts`)
- **Before**: `Number(usdc_amount)`, `Number(amount)`
- **After**: `parseMonetaryString()` with Decimal arithmetic
- **Benefits**: Precise fee calculation, accurate limit checking
- **Contract Integration**: Explicit rounding at Soroban boundary

#### Burn Controller (`burnController.ts`)
- **Before**: `Number(acbu_amount)`, manual fee multiplication
- **After**: Decimal parsing with `calculateFee()` utility
- **Benefits**: Accurate burn fees, precise local currency conversion
- **Contract Integration**: Proper handling of 2-decimal fiat contracts

### 4. Validation Improvements

#### Input Schema Updates
- **Enhanced regex**: `/^\d+(\.\d{1,7})?$/` validates decimal format
- **Scientific notation rejection**: Prevents `1e-7` style inputs
- **Precision limits**: Enforces maximum 7 decimal places

#### Error Messages
- **Descriptive**: "must be positive with up to 7 decimal places"
- **Field-specific**: Includes field name in error messages
- **User-friendly**: Clear guidance on valid input formats

### 5. Testing Coverage

#### Golden Tests for Large Fractional Inputs
```typescript
// Maximum precision test
"123456789.1234567" → Full precision preserved
"0.0000001" → Scientific notation handled correctly
```

#### Fee Boundary Tests
```typescript
// Small amount fees
"0.0000001" * 30 bps = "3e-10" (precise calculation)

// Large amount fees  
"999999999.9999999" * 50 bps = "4999999.9999999995" (no overflow)

// Boundary precision
"0.0033333" * 30 bps = "0.0000099999" (exact calculation)
```

#### Precision Loss Prevention Tests
```typescript
// Number() vs Decimal comparison
"9007199254740993.1234567" → Decimal preserves, Number() loses precision

// Cumulative calculations
"0.0000001" + "0.0000002" + "0.0000003" → Decimal = "0.0000006", Number() loses precision
```

### 6. Soroban Boundary Integration

#### Explicit Rounding Strategy
- **Contract Output**: `decimalToContractNumber()` with ROUND_DOWN
- **Contract Input**: `contractNumberToDecimal()` for precise storage
- **Fee Calculations**: Always use Decimal, convert only at boundary

#### Precision Preservation
- **Before**: `Math.round(amount * DECIMALS_7)` could lose precision
- **After**: `decimalToContractNumber()` maintains exact precision
- **Verification**: Tests confirm proper rounding behavior

### 7. Impact Assessment

#### Financial Accuracy
- **Fee Calculations**: Now precise to 28 decimal places
- **Limit Checking**: Accurate enforcement of deposit/withdrawal limits
- **Contract Integration**: No precision loss at Soroban boundary

#### Security Improvements
- **Input Validation**: Stricter format validation prevents malformed inputs
- **Precision Protection**: Prevents fee manipulation through precision errors
- **Consistent Behavior**: Uniform precision handling across all monetary operations

#### Performance Considerations
- **Decimal.js**: Optimized for financial calculations
- **Memory Usage**: Slight increase due to Decimal objects
- **CPU Impact**: Minimal for typical transaction sizes

### 8. Migration Notes

#### Breaking Changes
- **Input Validation**: Stricter validation may reject previously accepted inputs
- **Error Messages**: New error format for invalid monetary strings
- **Precision**: Some values may display differently (scientific notation)

#### Backward Compatibility
- **API Format**: Same JSON request/response structure
- **Database**: No schema changes required
- **Contracts**: Same interface, improved precision

### 9. Verification Checklist

✅ **Decimal Library**: Installed and configured  
✅ **Utility Functions**: Created and tested  
✅ **Controller Updates**: Mint and burn controllers migrated  
✅ **Input Validation**: Enhanced schemas implemented  
✅ **Golden Tests**: Large fractional inputs covered  
✅ **Fee Tests**: Boundary conditions verified  
✅ **Soroban Integration**: Explicit rounding confirmed  
✅ **Precision Tests**: Number() vs Decimal comparison  
✅ **Error Handling**: Descriptive validation errors  

### 10. Future Considerations

#### Monitoring
- **Fee Accuracy**: Monitor fee calculations in production
- **Validation Errors**: Track rejected input patterns
- **Performance**: Monitor Decimal.js impact on response times

#### Extensions
- **Other Controllers**: Consider migrating remaining Number() usage
- **Additional Precisions**: Support for different contract decimal places
- **Batch Operations**: Optimize Decimal operations for bulk processing

## Conclusion

The migration from `Number()` to Decimal for monetary calculations successfully addresses the precision loss issue. The implementation provides:

1. **Exact Precision**: Full preservation of monetary values
2. **Explicit Rounding**: Controlled behavior at contract boundaries  
3. **Comprehensive Testing**: Golden tests verify edge cases
4. **Enhanced Validation**: Stricter input validation prevents errors
5. **Future-Proof**: Scalable for additional precision requirements

This fix ensures financial accuracy and prevents fee/limit skewing due to precision loss, meeting the acceptance criteria for the high-severity monetary precision issue.
