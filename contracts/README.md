# ACBU Soroban Smart Contracts

Soroban (Stellar) smart contracts for the ACBU (African Currency Basket Unit) stablecoin platform.

## Contracts

- **Minting Contract** (`acbu_minting`) — Converts USDC, fiat deposits, and S-token baskets into ACBU
- **Burning Contract** (`acbu_burning`) — Redeems ACBU back to fiat currency or S-tokens
- **Oracle Contract** (`acbu_oracle`) — Aggregates exchange rates from multiple validators
- **Reserve Tracker Contract** (`acbu_reserve_tracker`) — Tracks and verifies reserve balances
- **Savings Vault Contract** (`acbu_savings_vault`) — Interest-bearing savings accounts for ACBU
- **Lending Pool Contract** (`acbu_lending_pool`) — Peer-to-peer ACBU lending
- **Escrow Contract** (`acbu_escrow`) — Conditional and time-locked ACBU transfers
- **Multisig Contract** (`acbu_multisig`) — M-of-N threshold authorization for admin actions

---

## Architecture

The eight contracts are divided into three logical layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER / FRONTEND                          │
└────────────┬────────────┬──────────┬──────────┬────────────────┘
             │            │          │          │
     ┌───────▼──────┐ ┌───▼──────┐ ┌▼────────┐ ┌▼─────────────┐
     │    Minting   │ │  Burning │ │ Savings │ │   Lending    │
     │   Contract   │ │ Contract │ │  Vault  │ │     Pool     │
     └──────┬───────┘ └────┬─────┘ └────┬────┘ └──────┬───────┘
            │              │            │              │
            │         ┌────▼──────────────────────┐   │
            │         │        Escrow Contract    │   │
            │         └───────────────────────────┘   │
            │                                          │
     ┌──────▼──────────────────────────────────────────▼───────┐
     │               INFRASTRUCTURE LAYER                      │
     │  ┌───────────────────┐   ┌───────────────────────────┐  │
     │  │  Oracle Contract  │   │  Reserve Tracker Contract │  │
     │  └───────────────────┘   └───────────────────────────┘  │
     └──────────────────────────────────────────────────────────┘
                             │
     ┌───────────────────────▼──────────────────────────────────┐
     │              SHARED / GOVERNANCE LAYER                   │
     │  ┌────────────────────────┐  ┌──────────────────────┐   │
     │  │   Multisig Contract    │  │   Shared Library     │   │
     │  │  (M-of-N admin auth)   │  │  (types, utilities)  │   │
     │  └────────────────────────┘  └──────────────────────┘   │
     └──────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Minting Flow (USDC → ACBU)

```
User
 │
 │  1. Transfer USDC to MintingContract vault
 ▼
MintingContract
 │  2. Query ACBU/USD rate          ──────────────► OracleContract
 │  3. Verify reserves sufficient   ──────────────► ReserveTrackerContract
 │                                                       │
 │                                      4. Oracle rate ◄─┘
 │  5. Calculate ACBU amount (rate × USDC, minus fee)
 │  6. Mint ACBU to user            ──────────────► ACBU Token Contract
 │  7. Emit MintEvent
 ▼
User receives ACBU
```

### Burning Flow (ACBU → Fiat or S-tokens)

```
User
 │
 │  1. Transfer ACBU to BurningContract
 ▼
BurningContract
 │  2. Query currency/USD rate      ──────────────► OracleContract
 │  3. Verify reserves sufficient   ──────────────► ReserveTrackerContract
 │  4. Burn ACBU from user          ──────────────► ACBU Token Contract
 │  5a. S-token redemption:
 │       transfer_from vault        ──────────────► S-Token Contract (vault allowance)
 │  5b. Fiat redemption:
 │       emit BurnEvent             ──────────────► Off-chain withdrawal processor
 │  6. Emit BurnEvent
 ▼
User receives S-tokens or fiat (via backend)
```

### Oracle Rate Update Flow

```
External Data Sources (e.g. Chainlink, Pyth, CEX APIs)
 │
 │  Each validator submits an independent rate
 ▼
OracleContract.update_rate()  (validator-gated, multisig-authorized)
 │
 │  1. Verify caller is a registered validator
 │  2. Check update interval has elapsed
 │  3. Store new rate from this validator
 │  4. Compute median across ≥3 validator submissions
 │  5. Outlier detection: reject if >3% deviation from median
 │  6. Emergency path: if move >5%, require N-of-M validator consensus
 │  7. Emit RateUpdateEvent (or EmergencyBypassEvent)
 ▼
Consumers: MintingContract, BurningContract, ReserveTrackerContract
```

### Reserve Verification Flow

```
Admin / Custodian
 │
 │  1. Submit reserve attestation (Merkle proof of off-chain reserves)
 ▼
ReserveTrackerContract
 │  2. Verify proof and custodian identity
 │  3. Update reserve balances per currency
 │  4. Cross-check value_usd against Oracle rates   ──► OracleContract
 ▼
MintingContract / BurningContract
 │  5. Call is_sufficient() before each mint or burn
 │     → Ensures reserve_usd ≥ acbu_supply × min_ratio
 ▼
Gate: transaction proceeds only if reserves are adequate
```

### Savings Vault Flow

```
User
 ├─► deposit(amount)          ──► SavingsVault stores balance + timestamp
 ├─► lock(amount, term)       ──► SavingsVault records lock period, higher rate
 └─► withdraw(amount)         ──► SavingsVault calculates accrued interest,
                                   transfers principal + interest to user
```

### Lending Pool Flow

```
Lender
 └─► deposit(amount)          ──► LendingPool records lender liquidity

Borrower + Lender (dual authorization)
 └─► borrow(lender, amount)   ──► LendingPool transfers ACBU to borrower,
                                   records LoanData (uncollateralized)

Borrower
 └─► repay(loan_id, amount)   ──► LendingPool transfers ACBU back,
                                   updates loan balance

Lender
 └─► withdraw(amount)         ──► LendingPool transfers principal + interest
```

### Escrow Flow

```
Creator
 └─► create_escrow(beneficiary, amount, conditions)
          │
          ▼
     EscrowContract holds ACBU
          │
    ┌─────┴─────────────────────┐
    │ Admin / condition met      │ Admin cancels
    ▼                           ▼
release_escrow()          cancel_escrow()
    │                           │
    ▼                           ▼
Beneficiary receives ACBU   Creator refunded
```

### Multisig Authorization Flow

```
Proposer (any signer)
 └─► propose(action, params)   ──► MultisigContract stores proposal + nonce

Signers (M-of-N required)
 └─► approve(proposal_id)      ──► MultisigContract records approvals

Any signer (once threshold met)
 └─► execute(proposal_id)      ──► MultisigContract dispatches admin action
                                    to target contract (e.g. add_validator,
                                    set_fee_rate, upgrade contract)
```

---

## Contract Interaction Patterns

### Cross-Contract Calls (Read)

| Caller              | Callee              | Method                  | Purpose                              |
|---------------------|---------------------|-------------------------|--------------------------------------|
| MintingContract     | OracleContract      | `get_acbu_usd_rate`     | ACBU/USD rate for mint calculation   |
| MintingContract     | OracleContract      | `get_rate`              | Per-currency rate for basket mints   |
| MintingContract     | ReserveTracker      | `is_sufficient`         | Reserve adequacy check before mint   |
| BurningContract     | OracleContract      | `get_rate`              | Per-currency rate for burn payout    |
| BurningContract     | ReserveTracker      | `is_sufficient`         | Reserve adequacy check before burn   |
| ReserveTracker      | OracleContract      | `get_rate`              | Validate reserve value_usd integrity |
| ReserveTracker      | ACBU Token          | `total_supply`          | Compare supply against reserves      |

### Cross-Contract Calls (Write / Token Transfers)

| Caller              | Callee              | Action                       | Direction                   |
|---------------------|---------------------|------------------------------|-----------------------------|
| MintingContract     | ACBU Token          | `mint(user, amount)`         | Creates new ACBU            |
| BurningContract     | ACBU Token          | `burn(user, amount)`         | Destroys ACBU               |
| BurningContract     | S-Token Vault       | `transfer_from(vault, user)` | Vault allowance pull model  |
| MintingContract     | USDC Token          | receive deposit (push model) | User pushes USDC in advance |

### Authorization Matrix

| Contract            | Admin actions gated by | Validator actions gated by |
|---------------------|------------------------|----------------------------|
| OracleContract      | Multisig (timelock)    | Validator allowlist        |
| ReserveTracker      | Multisig (timelock)    | Custodian address          |
| MintingContract     | Multisig (timelock)    | Operator address           |
| BurningContract     | Multisig (timelock)    | n/a                        |
| SavingsVault        | Admin address          | n/a                        |
| LendingPool         | Admin address          | n/a                        |
| EscrowContract      | Admin address          | n/a                        |
| MultisigContract    | M-of-N signers         | n/a                        |

### Shared Library Dependencies

All contracts import from the `shared` crate:

```
shared/
├── ContractError       — common error enum
├── CurrencyCode        — currency type (e.g. "USD", "NGN")
├── RateData            — oracle rate struct
├── ReserveData         — reserve balance struct
├── reentrancy_guard    — re-entrancy protection helper
├── MintEvent           — standardised mint event type
├── BurnEvent           — standardised burn event type
└── constants           — DECIMALS, BASIS_POINTS, MAX_VALIDATORS, …
```

---

## Prerequisites

- Rust 1.88.0 (pinned in `rust-toolchain.toml`)
- `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Soroban CLI (`cargo install --locked soroban-cli`)
- Stellar account with XLM for deployment fees
- **Nargo 0.38.0** (pinned — required to build/test ZK circuits in `zk/`)

  ```bash
  # Install the pinned Nargo version (Linux/macOS)
  curl -sSL https://github.com/noir-lang/noir/releases/download/v0.38.0/nargo-x86_64-unknown-linux-gnu.tar.gz \
    | tar -xz -C /usr/local/bin
  nargo --version   # expected: nargo version = 0.38.0
  ```

  > The Nargo version is enforced by `compiler_version = "=0.38.0"` in
  > `zk/circuits/*/Nargo.toml` and by `NARGO_VERSION` in
  > `.github/workflows/circuit-tests.yml`. See [`zk/README.md`](zk/README.md)
  > for details on upgrading.

> **WASM target** — this project exclusively targets `wasm32-unknown-unknown`.
> Do **not** use `wasm32v1-none` or any other WASM target; Soroban contracts
> require `wasm32-unknown-unknown` and the CI pipeline, `rust-toolchain.toml`,
> `Makefile`, and all build scripts are pinned to that target.
>
> ```bash
> rustup target add wasm32-unknown-unknown
> ```

## Vendored WASM Artifact

The file `soroban_token_contract.wasm` at the repository root is a **vendored dependency** — it is committed to the repo and required at compile time by the minting, burning, and reserve-tracker contracts via `contractimport!`. Its SHA-256 integrity is verified automatically by `build.rs` during every `cargo build`.

Fresh clones receive this file via `git clone`. If it is ever missing or corrupted, `build.rs` will attempt to re-fetch it automatically via `scripts/fetch_token_wasm.sh`. You can also run the fetch script manually:

```bash
./scripts/fetch_token_wasm.sh
```

## Building

```bash
# Build all contracts in the workspace
make build
# or
cargo build

# Build a specific contract
make build-minting
```

You can use the `Makefile` for common commands. Run `make help` to see all targets.

## Testing

```bash
# Run all tests in the workspace
make test

# Run tests for a specific contract
make test-minting
```

## Deployment

### Testnet

```bash
export STELLAR_SECRET_KEY="your-secret-key"
make deploy-testnet
```

### Mainnet

```bash
export STELLAR_SECRET_KEY="your-secret-key"
make deploy-mainnet
```

## Git Hooks Setup

After cloning, run:
```bash
make setup-hooks
```

This configures the pre-commit hook for WASM integrity checks.

## Contract Addresses

After deployment, contract addresses are saved to `.soroban/deployment_{network}.json`

## Development

### Project Structure

```
.
├── acbu_minting/           # Minting contract
├── acbu_burning/           # Burning contract
├── acbu_oracle/            # Oracle contract
├── acbu_reserve_tracker/   # Reserve tracker contract
├── acbu_savings_vault/     # Savings vault contract
├── acbu_lending_pool/      # Lending pool contract
├── acbu_escrow/            # Escrow contract
├── acbu_multisig/          # Multisig shared contract
├── shared/                 # Shared types and utilities
├── scripts/                # Deployment scripts
├── docs/                   # Documentation
└── tests/                  # Integration tests
```

### Adding a New Contract

1. Create contract directory: `mkdir new_contract`
2. Add to workspace `Cargo.toml` members
3. Create `Cargo.toml` and `src/lib.rs`
4. Update deployment scripts

## Security

- All admin functions require multisig (3 of 5)
- Rate limits on transactions
- Circuit breakers for anomalies
- Time locks for critical operations

## Documentation

- [docs/CONTRACTS.md](docs/CONTRACTS.md) — detailed per-contract function reference
- [docs/ERROR_CODES.md](docs/ERROR_CODES.md) — full error code listing
- [DEPLOYMENT.md](DEPLOYMENT.md) — deployment instructions
- [INTEGRATION.md](INTEGRATION.md) — integration guide for external consumers
