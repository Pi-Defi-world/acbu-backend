# Contract Integration Guide

This guide explains how to integrate ACBU Soroban contracts with the backend services.

## Backend Integration

The backend provides TypeScript services for interacting with deployed contracts.

### Setup

1. **Install dependencies:**

   ```bash
   cd backend
   pnpm install
   ```

2. **Set environment variables:**
   ```bash
   export STELLAR_NETWORK="testnet"
   export STELLAR_SECRET_KEY="your-secret-key"
   export STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"
   export CONTRACT_ORACLE_TESTNET="<oracle-contract-id>"
   export CONTRACT_RESERVE_TRACKER_TESTNET="<reserve-tracker-contract-id>"
   export CONTRACT_MINTING_TESTNET="<minting-contract-id>"
   export CONTRACT_BURNING_TESTNET="<burning-contract-id>"
   # Optional (segment features):
   export CONTRACT_SAVINGS_VAULT_TESTNET="<savings-vault-contract-id>"
   export CONTRACT_LENDING_POOL_TESTNET="<lending-pool-contract-id>"
   export CONTRACT_ESCROW_TESTNET="<escrow-contract-id>"
   ```

### Using Contract Services

#### Minting Service (acbuMintingService)

```typescript
import { acbuMintingService } from "./services/contracts";

// Mint ACBU from USDC
const result = await acbuMintingService.mintFromUsdc({
  usdcAmount: "10000000", // 10 USDC (7 decimals)
  recipient: "G...", // Stellar address
});

console.log("Transaction:", result.transactionHash);
console.log("ACBU minted:", result.acbuAmount);

// Check if contract is paused
const isPaused = await acbuMintingService.isPaused();

// Get fee rate
const feeRate = await acbuMintingService.getFeeRate();
```

#### Burning Service (acbuBurningService)

```typescript
import { acbuBurningService } from "./services/contracts";

// Burn ACBU for currency redemption
const result = await acbuBurningService.burnForCurrency({
  acbuAmount: "10000000", // 10 ACBU
  currency: "NGN",
  recipientAccount: {
    accountNumber: "1234567890",
    bankCode: "058",
    accountName: "John Doe",
  },
});

console.log("Transaction:", result.transactionHash);
console.log("Local amount:", result.localAmount);
```

#### Oracle Service (acbuOracleService)

```typescript
import { acbuOracleService } from "./services/contracts";

// Update exchange rate (validator function)
await acbuOracleService.updateRate({
  currency: "NGN",
  rate: "1234567", // 0.1234567 USD per NGN (7 decimals)
  sources: ["1230000", "1235000", "1239000"],
  timestamp: Date.now(),
});

// Get current rate
const rate = await acbuOracleService.getRate("NGN");

// Get ACBU/USD rate
const acbuRate = await acbuOracleService.getAcbuUsdRate();
```

#### Reserve Tracker Service (acbuReserveTrackerService)

```typescript
import { acbuReserveTrackerService } from "./services/contracts";

// Update reserve (backend function)
await acbuReserveTrackerService.updateReserve({
  currency: "NGN",
  amount: "1000000000", // Reserve amount
  valueUsd: "123456700", // Value in USD
});

// Get reserve data
const reserve = await acbuReserveTrackerService.getReserve("NGN");

// Verify reserves
const isValid = await acbuReserveTrackerService.verifyReserves();

// Get total reserve value
const totalValue = await acbuReserveTrackerService.getTotalReserveValue();
```

#### Savings, Lending, Escrow (optional)

When the network-specific `CONTRACT_SAVINGS_VAULT_TESTNET`, `CONTRACT_LENDING_POOL_TESTNET`, or `CONTRACT_ESCROW_TESTNET` variables are set (use `_MAINNET` on mainnet), the backend exposes `acbuSavingsVaultService`, `acbuLendingPoolService`, and `acbuEscrowService`. Segment routes (`/v1/savings`, `/v1/lending`, `/v1/gateway`) call these services. Event listeners `acbu_savings_vault_event_listener.ts`, `acbu_lending_pool_event_listener.ts`, and `acbu_escrow_event_listener.ts` enqueue events to **ACBU_SAVINGS_VAULT_EVENTS**, **ACBU_LENDING_POOL_EVENTS**, and **ACBU_ESCROW_EVENTS** respectively.

### Event Listening

Backend jobs listen to contract events and enqueue for off-chain processing:

- **acbu_minting_event_listener.ts** – MintEvent → USDC_CONVERSION queue
- **acbu_burning_event_listener.ts** – BurnEvent → WITHDRAWAL_PROCESSING queue
- **acbu_savings_vault_event_listener.ts** → ACBU_SAVINGS_VAULT_EVENTS
- **acbu_lending_pool_event_listener.ts** → ACBU_LENDING_POOL_EVENTS
- **acbu_escrow_event_listener.ts** → ACBU_ESCROW_EVENTS

### Error Handling

All contract services throw errors that should be caught:

```typescript
try {
  const result = await acbuMintingService.mintFromUsdc({
    usdcAmount: "10000000",
    recipient: "G...",
  });
} catch (error) {
  if (error.message.includes("Insufficient reserves")) {
    // Handle insufficient reserves
  } else if (error.message.includes("Contract is paused")) {
    // Handle paused contract
  } else {
    // Handle other errors
  }
}
```

## Contract Interaction Flow

### Minting Flow

1. User deposits USDC or fiat
2. Backend calls `acbuMintingService.mintFromUsdc()` or `acbuMintingService.mintFromFiat()`
3. Contract verifies reserves and mints ACBU
4. Contract emits `MintEvent`
5. Backend event listener processes event
6. Backend triggers USDC conversion worker (if needed)

### Burning Flow

1. User requests ACBU redemption
2. Backend calls `acbuBurningService.burnForCurrency()` or `acbuBurningService.burnForBasket()`
3. Contract burns ACBU and emits `BurnEvent`
4. Backend event listener processes event
5. Backend triggers withdrawal processor
6. Fiat is disbursed to user's account

### Oracle Update Flow

1. Validator fetches rates from multiple sources
2. Validator calls `acbuOracleService.updateRate()`
3. Contract calculates median and updates rate
4. Contract emits `RateUpdateEvent`
5. Backend updates database with new rates

### Reserve Update Flow

1. Backend tracks reserves from fintech partners
2. Backend calls `acbuReserveTrackerService.updateReserve()`
3. Contract stores reserve data
4. Backend verifies reserves using `acbuReserveTrackerService.verifyReserves()`

## Testing

### Unit Tests

```typescript
import { acbuMintingService } from "./services/contracts";

describe("acbuMintingService", () => {
  it("should mint ACBU from USDC", async () => {
    const result = await acbuMintingService.mintFromUsdc({
      usdcAmount: "10000000",
      recipient: "G...",
    });

    expect(result.transactionHash).toBeDefined();
    expect(result.acbuAmount).toBeDefined();
  });
});
```

### Integration Tests

Test full flows with deployed contracts:

```typescript
describe('Mint-Burn Flow', () => {
  it('should complete full mint and burn cycle', async () => {
    // Mint
    const mintResult = await acbuMintingService.mintFromUsdc({...});

    // Burn
    const burnResult = await acbuBurningService.burnForCurrency({...});

    expect(mintResult.transactionHash).toBeDefined();
    expect(burnResult.transactionHash).toBeDefined();
  });
});
```

## Best Practices

1. **Always check contract state** before operations (paused, fee rates, etc.)
2. **Handle errors gracefully** with appropriate user feedback
3. **Monitor events** for off-chain processing
4. **Verify reserves** before minting operations
5. **Use proper error handling** for all contract calls
6. **Log all transactions** for audit purposes
7. **Test thoroughly** on testnet before mainnet

## Security Considerations

1. **Never expose secret keys** in client-side code
2. **Validate all inputs** before calling contracts
3. **Use rate limiting** for contract operations
4. **Monitor for suspicious activity**
5. **Implement circuit breakers** for contract failures
6. **Use multisig** for admin operations

## ZK Compliance Integration

### Current Status

The ACBU platform includes ZK compliance infrastructure:

- **ZK Verifier Contract** (`contracts/zk_verifier`): On-chain ZK proof verification for KYC compliance
- **ZK Gate Contract** (`contracts/zk_gate`): Compliance gate with `chk(account)` method

**Important:** ZK compliance checks are **not currently wired** into mint/burn/oracle/reserve contract entrypoints. Compliance enforcement relies on off-chain backend validation.

### Integration Options

#### Option 1: On-Chain Enforcement (Future Enhancement)

To enforce on-chain compliance, integrate `ZkComplyGate::chk(user)` into sensitive contract operations:

```rust
// Example integration in minting contract
pub fn mint_from_usdc(env: Env, user: Address, amount: i128) {
    user.require_auth();

    // ZK compliance check
    let zk_gate: Address = env.storage().instance().get(&DataKey::ZkGate).unwrap();
    let is_compliant: bool = env.invoke_contract(
        &zk_gate,
        &symbol_short!("chk"),
        Vec::from_array(&env, [user.clone().into_val(&env)])
    );

    if !is_compliant {
        env.panic_with_error(Error::ComplianceCheckFailed);
    }

    // Continue with mint operation...
}
```

Integration points:

- `acbu_minting::mint_from_usdc` / `mint_from_fiat` / `mint_from_basket`
- `acbu_burning::burn_for_currency` / `burn_for_basket`
- `acbu_savings_vault::open_deposit`
- `acbu_lending_pool::borrow`

#### Option 2: Off-Chain Enforcement (Current Approach)

Backend validates compliance before submitting transactions:

```typescript
import { zkComplianceService } from "./services/zk-compliance";

// Check compliance before minting
async function mintWithCompliance(user: string, amount: string) {
  // Backend verifies KYC/compliance
  const isCompliant = await zkComplianceService.checkCompliance(user);

  if (!isCompliant) {
    throw new Error("User failed compliance check");
  }

  // Proceed with mint
  return await acbuMintingService.mintFromUsdc({
    recipient: user,
    usdcAmount: amount,
  });
}
```

### Choosing an Approach

**On-Chain Enforcement:**

- Pros: Trustless, cannot be bypassed, fully decentralized
- Cons: Gas costs, contract complexity, deployment coordination

**Off-Chain Enforcement:**

- Pros: Flexible, lower costs, easier to update policies
- Cons: Requires trusted backend, potential bypass if backend compromised

**Recommendation:** Document explicitly which approach is in scope for the current deployment. If on-chain compliance is out of scope, update documentation to reflect that compliance is handled by the trusted backend layer.

### Configuration

To enable on-chain ZK compliance in the future:

1. Deploy `zk_gate` contract
2. Configure `zk_gate` with `zk_verifier` address
3. Update minting/burning contracts to include `zk_gate` address in storage
4. Add `chk()` calls to sensitive entrypoints
5. Update contract tests to mock ZK compliance checks
6. Document the compliance policy and verification flow
