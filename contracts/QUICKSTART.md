# ACBU Soroban Contracts - Quick Start

This is a quick start guide to get you up and running with ACBU Soroban contracts.

## What's Included

- **8 Contracts** (all deployed by `scripts/deploy.sh`, see [DEPLOYMENT.md](DEPLOYMENT.md)):
  - Minting Contract - USDC/Fiat → ACBU
  - Burning Contract - ACBU → Fiat
  - Oracle Contract - Exchange rate aggregation
  - Reserve Tracker Contract - Reserve verification
  - Savings Vault Contract - Term deposits / yield on ACBU
  - Lending Pool Contract - Peer-to-peer ACBU lending
  - Escrow Contract - Conditional and time-locked transfers
  - Multisig Contract - M-of-N governance for admin actions

- **Backend Integration:**
  - Stellar SDK client
  - Contract interaction services
  - Event listeners
  - TypeScript services for all contracts

## Quick Setup

### 1. Install Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Soroban CLI
cargo install --locked soroban-cli
```

### 2. Build Contracts

The vendored token WASM (`soroban_token_contract.wasm`) is committed to the repo root and verified automatically by `build.rs`.

```bash
# From the repository root
cargo build
```

### 3. Deploy to Testnet

`scripts/deploy.sh` deploys **all 8 contracts** and initialises them, so it
needs the initialisation parameters (real addresses — no `TODO_*`/`<...>`
placeholders) in addition to the secret key.  See
[DEPLOYMENT.md](DEPLOYMENT.md) § Initialisation parameters for the full list
(`ADMIN_ADDRESS`, `ACBU_TOKEN_ID`, `USDC_TOKEN_ID`, `VAULT_ADDRESS`,
`TREASURY_ADDRESS`, `WITHDRAWAL_PROCESSOR`, `OPERATOR_ADDRESS`,
`OPERATOR_PUB_KEY`, `ORACLE_VALIDATORS`, `ORACLE_MIN_SIGNATURES`,
`MULTISIG_SIGNERS`, `MULTISIG_THRESHOLD`).

```bash
export STELLAR_SECRET_KEY="your-testnet-secret-key"
export DEPLOY_ENV_FILE=.deploy.env     # or export each variable directly
chmod +x scripts/deploy_testnet.sh
./scripts/deploy_testnet.sh
```

Savings Vault and Multisig are part of this run — see
[DEPLOYMENT.md](DEPLOYMENT.md) § Contract initialisation for their
`initialize` sequences.

### 4. Set Backend Environment Variables

```bash
export STELLAR_NETWORK="testnet"
export STELLAR_SECRET_KEY="your-secret-key"
export CONTRACT_ORACLE_TESTNET="<oracle-contract-id>"
export CONTRACT_RESERVE_TRACKER_TESTNET="<reserve-tracker-contract-id>"
export CONTRACT_MINTING_TESTNET="<minting-contract-id>"
export CONTRACT_BURNING_TESTNET="<burning-contract-id>"
export CONTRACT_SAVINGS_VAULT_TESTNET="<savings-vault-contract-id>"
export CONTRACT_LENDING_POOL_TESTNET="<lending-pool-contract-id>"
export CONTRACT_ESCROW_TESTNET="<escrow-contract-id>"
export CONTRACT_MULTISIG_TESTNET="<multisig-contract-id>"
```

### 5. Use in Backend

```typescript
import { mintingService } from './services/contracts';

// Mint ACBU from USDC
const result = await mintingService.mintFromUsdc({
  usdcAmount: '10000000', // 10 USDC
  recipient: 'G...',
});
```

## Next Steps

- Read [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions
- Read [INTEGRATION.md](INTEGRATION.md) for backend integration guide
- Read individual contract READMEs for contract-specific documentation

## Project Structure

```
.
├── acbu_minting/
├── acbu_burning/
├── acbu_oracle/
├── acbu_reserve_tracker/
├── acbu_savings_vault/
├── acbu_lending_pool/
├── acbu_escrow/
├── acbu_multisig/
├── shared/
├── scripts/
├── docs/
├── tests/
└── README.md
```

## Support

For issues or questions:
1. Check the documentation files
2. Review contract READMEs
3. Check deployment logs
4. Verify environment variables
