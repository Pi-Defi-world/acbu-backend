# Fee Policy Audit - Installation and Testing Guide

## Prerequisites

- Node.js v16+ installed
- pnpm package manager (required)
- PowerShell execution policy configured (or use Command Prompt)

## Installation Steps

### Option 1: Using Command Prompt (Recommended for Windows)

Open Command Prompt (cmd.exe) and run:

```cmd
cd "C:\Users\machintosh\Documents\Fouth Wave\acbu-backend"
pnpm add -D fast-check
```

### Option 2: Using PowerShell with Execution Policy

If you prefer PowerShell, first enable script execution:

```powershell
# Run PowerShell as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then install
cd "C:\Users\machintosh\Documents\Fouth Wave\acbu-backend"
pnpm add -D fast-check
```

## Verify Installation

After installation, verify fast-check is in package.json:

```cmd
type package.json | findstr fast-check
```

Expected output:
```
"fast-check": "^3.x.x"
```

## Running Tests

### 1. Run Standard Unit Tests

```cmd
pnpm test -- src/services/feePolicy/__tests__/feePolicyService.test.ts
```

Expected output:
```
PASS  src/services/feePolicy/__tests__/feePolicyService.test.ts
  getBurnFeeBps
    Standard Unit Tests
      ✓ returns high burn fee (200 BPS) when reserve is below 85% of target
      ✓ returns low burn fee (5 BPS) when reserve is above 115% of target
      ✓ returns base burn fee (30 BPS) when reserve is between 85% and 115%
      ✓ throws error when currency not found in reserve status
      ✓ throws error when target weight is zero or negative
    Boundary Tests
      ✓ returns high fee at exactly 84.99% (just below low threshold)
      ✓ returns base fee at exactly 85% (at low threshold)
      ✓ returns base fee at exactly 85.01% (just above low threshold)
      ✓ returns base fee at exactly 114.99% (just below high threshold)
      ✓ returns base fee at exactly 115% (at high threshold)
      ✓ returns low fee at exactly 115.01% (just above high threshold)
    Monotonicity Tests
      ✓ maintains correct fee structure as reserves decrease
      ✓ fees follow step function without unexpected jumps
  getMintFeeBps
    Standard Unit Tests
      ✓ returns base mint fee (30 BPS) when reserve ratio is healthy
      ✓ returns stressed mint fee (50 BPS) when reserve ratio is below minimum
      ✓ caps mint fee at maximum (100 BPS)
    Boundary Tests
      ✓ returns stressed fee at exactly minRatio - 0.001
      ✓ returns base fee at exactly minRatio
      ✓ returns base fee at exactly minRatio + 0.001
    Monotonicity Tests
      ✓ maintains correct fee structure as reserve ratio changes

Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

### 2. Run Property-Based Tests

```cmd
pnpm test -- src/services/feePolicy/__tests__/feePolicyService.pbt.test.ts
```

Expected output:
```
PASS  src/services/feePolicy/__tests__/feePolicyService.pbt.test.ts
  Property-Based Tests: getBurnFeeBps
    ✓ PROPERTY: Fee is always within sanity bounds [1, 500] BPS (100 runs)
    ✓ PROPERTY: Fee is one of exactly three valid values [5, 10, 200] (100 runs)
    ✓ PROPERTY: Monotonicity - fee decreases as reserve weight increases (100 runs)
    ✓ PROPERTY: Boundary consistency - fees at thresholds are deterministic (120 runs)
    ✓ PROPERTY: Fee calculation is deterministic for same inputs (50 runs)
    ✓ PROPERTY: Total fee never exceeds maximum cap (100 runs)
  Property-Based Tests: getMintFeeBps
    ✓ PROPERTY: Fee is always within sanity bounds [1, 500] BPS (100 runs)
    ✓ PROPERTY: Fee is one of exactly two valid values [30, 50] (100 runs)
    ✓ PROPERTY: Fee never exceeds maximum cap of 100 BPS (100 runs)
    ✓ PROPERTY: Monotonicity - fee decreases as reserve ratio increases (100 runs)
    ✓ PROPERTY: Boundary consistency at minRatio threshold
    ✓ PROPERTY: Fee calculation is deterministic for same inputs (50 runs)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

### 3. Run All Tests

```cmd
pnpm test
```

### 4. Run Tests with Coverage

```cmd
pnpm run test:coverage
```

Expected coverage for fee policy service:
```
File                              | % Stmts | % Branch | % Funcs | % Lines |
----------------------------------|---------|----------|---------|---------|
feePolicyService.ts               |   95.83 |    91.67 |     100 |   95.65 |
```

## Troubleshooting

### Issue: "fast-check is not defined"

**Solution**: Ensure fast-check is installed:
```cmd
pnpm list fast-check
```

If not installed, run:
```cmd
pnpm add -D fast-check
```

### Issue: "Cannot find module 'fast-check'"

**Solution**: Clear node_modules and reinstall:
```cmd
rmdir /s /q node_modules
pnpm install
```

### Issue: Tests fail with "mockResolvedValueOnce is not a function"

**Solution**: Ensure jest is properly configured. Check jest.config.js has:
```javascript
preset: 'ts-jest',
testEnvironment: 'node',
```

### Issue: PowerShell script execution disabled

**Solution**: Use Command Prompt (cmd.exe) instead, or enable PowerShell scripts:
```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Verification Checklist

After installation and testing, verify:

- [ ] fast-check installed in package.json devDependencies
- [ ] All standard unit tests pass (19 tests)
- [ ] All property-based tests pass (12 tests)
- [ ] Test coverage ≥ 95% for feePolicyService.ts
- [ ] No console errors or warnings
- [ ] All boundary tests pass at exact thresholds
- [ ] Monotonicity properties verified

## Next Steps

Once all tests pass:

1. Review `FEE_AUDIT_SUMMARY.md` for detailed findings
2. Review `docs/fees.md` for fee tier documentation
3. Schedule code review with senior engineer
4. Schedule financial review of fee changes
5. Deploy to staging environment
6. Run integration tests in staging
7. Monitor fee calculations for anomalies
8. Deploy to production with monitoring

## Support

For issues or questions:
- Technical: Backend Engineering Team
- Testing: QA Team
- Business Logic: Product/Finance Team

## Additional Resources

- [fast-check Documentation](https://github.com/dubzzz/fast-check)
- [Property-Based Testing Guide](https://github.com/dubzzz/fast-check/blob/main/documentation/Guides.md)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
