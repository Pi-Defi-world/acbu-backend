# ACBU Smart Contracts — Deployment Guide

> **W2-C-062** — Guarded deploy workflow with contract-address registry.  
> All deploys are scripted, non-interactive, and recorded.  Manual ad-hoc
> `soroban contract deploy` calls are discouraged.

---

## Quick reference

| Method | Command / location |
|--------|-------------------|
| **CI (preferred)** | GitHub Actions → *Deploy Contracts* → *Run workflow* |
| **Local testnet** | `STELLAR_SECRET_KEY=<key> make deploy-testnet` |
| **Local mainnet** | `STELLAR_SIGNER=<hardware-or-MPC-identity> DEPLOY_CONFIRM=deploy make deploy-mainnet` |
| **Registry** | `deployments/registry.json` (committed to git after every deploy) |

---

## Architecture

```
scripts/deploy.sh               — master deploy script (testnet & mainnet)
scripts/deploy_testnet.sh       — thin wrapper → deploy.sh testnet
scripts/deploy_mainnet.sh       — thin wrapper → deploy.sh mainnet (DEPLOY_CONFIRM required)
scripts/update_registry.sh      — merges per-network JSON into deployments/registry.json
.github/actions/rust-toolchain/ — composite action: installs the toolchain pinned in rust-toolchain.toml
.github/workflows/deploy.yml    — CI workflow (manual trigger only)
deployments/
  registry.json                 — canonical contract-address registry (all networks)
  testnet.json                  — per-deploy snapshot for testnet
  mainnet.json                  — per-deploy snapshot for mainnet
```

---

## Prerequisites

### Toolchain

```bash
# Rust (version pinned in rust-toolchain.toml)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI (or legacy soroban-cli)
cargo install --locked stellar-cli --version 21.5.0
# — or —
cargo install --locked soroban-cli
```

`rust-toolchain.toml` is the single source of truth for the Rust version,
components and targets.  All CI jobs install it via the
`.github/actions/rust-toolchain` composite action — no workflow hard-codes a
toolchain version.

### Stellar account

| Network  | How to fund |
|----------|-------------|
| Testnet  | [Stellar Friendbot](https://friendbot.stellar.org/?addr=<your-public-key>) |
| Mainnet  | Purchase XLM; each contract deploy costs ~1–2 XLM in fees |

---

## Reproducible builds

`Cargo.lock` is committed.  Always build with `--locked` so the pinned
dependency graph is used without fetching from the internet.

```bash
cargo build --locked --target wasm32-unknown-unknown --release
```

The CI workflow enforces this.  `.github/workflows/deps-guard.yml` also
rejects any PR that upgrades dependencies without updating `Cargo.lock`.

---

## Local deployment

### Testnet

```bash
export STELLAR_SECRET_KEY="S..."   # your testnet secret key (starts with S)
make deploy-testnet
```

### Mainnet

```bash
export STELLAR_SIGNER="acbu-mainnet-deployer" # preconfigured hardware/MPC identity
export DEPLOY_CONFIRM=deploy                 # explicit opt-in guard
make deploy-mainnet
```

The mainnet guard also exists inside `scripts/deploy.sh` itself:  if
`DEPLOY_CONFIRM` is not exactly `"deploy"`, the script exits before touching
the network.

### What the script does

1. Validates the signer (`STELLAR_SECRET_KEY` or `STELLAR_SIGNER` on testnet;
   hardware/MPC-backed `STELLAR_SIGNER` plus `DEPLOY_CONFIRM` on mainnet).
2. Loads and validates initialisation parameters (see
   [Initialisation parameters](#initialisation-parameters)) **before** any XLM
   is spent — empty or `TODO_*` / `<...>` placeholder values abort the run.
3. Runs `cargo build --locked --target wasm32-unknown-unknown --release`.
4. Deploys 8 contracts in dependency order:
   ```
   acbu_oracle          → infrastructure
   acbu_reserve_tracker → infrastructure
   acbu_multisig        → governance
   acbu_minting         → user-facing
   acbu_burning         → user-facing
   acbu_savings_vault   → user-facing
   acbu_lending_pool    → user-facing
   acbu_escrow          → user-facing
   ```
5. Writes `deployments/<network>.json` (contract IDs + metadata).
6. Calls `initialize` on all 8 deployed contracts using the validated
   parameters (`SKIP_INIT=1` skips this step and leaves the contracts inert).
7. Calls `scripts/update_registry.sh` to merge into `deployments/registry.json`.

---

## Initialisation parameters

`scripts/deploy.sh` never hardcodes addresses.  Every value comes from the
environment (or from a file passed as `DEPLOY_ENV_FILE=<path>`, which is
`source`d before validation — use it to keep secrets/addresses out of the
shell history).

```bash
# Either export the variables…
export ACBU_TOKEN_ID=C… USDC_TOKEN_ID=C… …
STELLAR_SIGNER=acbu-mainnet-deployer DEPLOY_CONFIRM=deploy ./scripts/deploy.sh mainnet

# …or keep them in a file (e.g. an untracked/secrets-managed file):
STELLAR_SIGNER=acbu-mainnet-deployer DEPLOY_ENV_FILE=.deploy.env DEPLOY_CONFIRM=deploy ./scripts/deploy.sh mainnet
```

Validation runs **before** the build/deploy phase and rejects:

- missing values,
- placeholders (`TODO_*`, `TBD`, `PLACEHOLDER`, `CHANGEME`, `<anything>`),
- values that are not valid Stellar addresses / contract IDs,
- `ORACLE_MIN_SIGNATURES` / `MULTISIG_THRESHOLD` outside `1..=list length`,
- `ADMIN_ADDRESS == OPERATOR_ADDRESS` (minting requires role separation).

### Required

| Variable | Format | Used by |
|----------|--------|---------|
| `ADMIN_ADDRESS` | `G…`/`C…` address | all contracts |
| `ACBU_TOKEN_ID` | `C…` contract ID | reserve, minting, burning, savings, lending, escrow |
| `USDC_TOKEN_ID` | `C…` contract ID | minting |
| `VAULT_ADDRESS` | `G…`/`C…` address | minting, burning |
| `TREASURY_ADDRESS` | `G…`/`C…` address | minting |
| `WITHDRAWAL_PROCESSOR` | `G…`/`C…` address | burning |
| `OPERATOR_ADDRESS` | `G…`/`C…` address | minting (≠ `ADMIN_ADDRESS`) |
| `OPERATOR_PUB_KEY` | 64 hex chars (ed25519 pubkey) | minting |
| `ORACLE_VALIDATORS` | JSON array of addresses | oracle |
| `ORACLE_MIN_SIGNATURES` | integer `1..=validators.len()` | oracle |
| `MULTISIG_SIGNERS` | JSON array of addresses | multisig |
| `MULTISIG_THRESHOLD` | integer `1..=signers.len()` | multisig |

### Optional (defaults shown)

| Variable | Default |
|----------|---------|
| `ORACLE_CURRENCIES` | `["NGN","KES","RWF","GHS","UGX","TZS","ZAR","EGP"]` |
| `ORACLE_BASKET_WEIGHTS` | `{"NGN":1800,"KES":1200,"RWF":800,"GHS":900,"UGX":700,"TZS":600,"ZAR":1500,"EGP":1500}` |
| `MIN_RESERVE_RATIO_BPS` | `10200` |
| `MINT_FEE_RATE_BPS` / `MINT_FEE_SINGLE_BPS` | `30` / `50` |
| `BURN_FEE_RATE_BPS` / `BURN_FEE_SINGLE_REDEEM_BPS` | `30` / `100` |
| `SAVINGS_FEE_RATE_BPS` / `SAVINGS_YIELD_RATE_BPS` | `0` / `500` |
| `LENDING_FEE_RATE_BPS` | `300` |
| `SKIP_INIT` | unset — set to `1` to deploy without initialising |

### CI / GitHub Environment setup

The **Deploy Contracts** workflow passes the required parameters from GitHub
Actions *environment variables* (`vars.*`), e.g. `vars.ACBU_TOKEN_ID`,
`vars.ADMIN_ADDRESS`, … Configure them per environment
(**Settings → Environments → `<network>` → Variables**).  If any required
value is missing (or still a placeholder), `deploy.sh` fails fast before
deploying anything.

---

## CI deployment (GitHub Actions)

### Setup (one-time, per environment)

1. Go to **Settings → Environments** in the GitHub repo.
2. Create two environments: `testnet` and `mainnet`.
3. For `mainnet`: add **Required reviewers** and a **Deployment branch filter** (e.g. `main`).
4. In `testnet`, add the environment secret:
   ```
   STELLAR_SECRET_KEY = <testnet stellar secret key>
   ```
5. Register a self-hosted runner with the `mainnet-signer` label. Configure a
   Stellar CLI identity backed by an MPC/HSM, hardware wallet, or enforced
   signer quorum; do not place its seed in GitHub. Set the mainnet environment
   variable `MAINNET_SIGNER_IDENTITY` to that identity name.

### Running a deploy

1. Go to **Actions → Deploy Contracts → Run workflow**.
2. Choose **network**: `testnet` or `mainnet`.
3. For mainnet, type `deploy` in the **confirm** field.
4. Click **Run workflow**.

The workflow:

- **guard** job — validates the confirmation input before any compute starts.
- **deploy** job — runs behind the selected GitHub Environment approval,
  installs a pinned checksummed Stellar CLI, signs the WASM checksum manifest,
  uses the dedicated signer runner for mainnet, builds with `--locked`,
  runs `scripts/deploy.sh`, commits the updated registry back to the
  source branch (`[skip ci]` tag prevents an infinite loop), and uploads
  `deployments/*.json` as a 90-day run artifact.

### Workflow outputs

| Output | Description |
|--------|-------------|
| Job summary | Formatted table of all deployed contract IDs |
| Run artifact | `deployment-<network>-run<id>` — `deployments/*.json` files |
| Registry commit | `deployments/registry.json` updated on the source branch |

---

## Contract-address registry

`deployments/registry.json` is the single source of truth for deployed
contract addresses.  It is committed to git and updated automatically by
`scripts/update_registry.sh` after every deploy.

Example structure:

```json
{
  "_comment": "Auto-generated by scripts/update_registry.sh — do not edit by hand.",
  "_schema": "1",
  "networks": {
    "testnet": {
      "deployed_at": "2026-08-27T22:00:00Z",
      "git_sha": "abc1234...",
      "git_ref": "main",
      "network_passphrase": "Test SDF Network ; September 2015",
      "rpc_url": "https://soroban-testnet.stellar.org",
      "contracts": {
        "oracle":          "C...",
        "reserve_tracker": "C...",
        "multisig":        "C...",
        "minting":         "C...",
        "burning":         "C...",
        "savings_vault":   "C...",
        "lending_pool":    "C...",
        "escrow":          "C..."
      }
    },
    "mainnet": { "..." : "..." }
  }
}
```

### Reading the registry from backend / scripts

```bash
# Get the testnet minting contract address
python3 -c "
import json
r = json.load(open('deployments/registry.json'))
print(r['networks']['testnet']['contracts']['minting'])
"
```

---

## Contract initialisation

`scripts/deploy.sh` runs the `initialize` calls listed below automatically,
using the validated values from [Initialisation parameters](#initialisation-parameters).
The commands are kept here for reference and for recovering a deployment that
ran with `SKIP_INIT=1`. These calls require the configured deployer identity
(`STELLAR_SIGNER`) or, on testnet only, `STELLAR_SECRET_KEY`.

> **Note:** Replace all `<...>` placeholders with real addresses from the
> registry or your token infrastructure — never commit them.

### Oracle

```bash
stellar contract invoke \
  --id $(cat deployments/testnet.json | python3 -c "import json,sys; print(json.load(sys.stdin)['contracts']['oracle'])") \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --admin <admin-address> \
  --validators '["<validator-1>","<validator-2>","<validator-3>"]' \
  --min_signatures 3 \
  --currencies '["NGN","KES","RWF","GHS","UGX","TZS","ZAR","EGP"]' \
  --basket_weights '{"NGN":1800,"KES":1200,"RWF":800,"GHS":900,"UGX":700,"TZS":600,"ZAR":1500,"EGP":1500}'
```

### Reserve Tracker

```bash
stellar contract invoke \
  --id <reserve-tracker-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --admin <admin-address> \
  --oracle <oracle-id> \
  --acbu_token <acbu-token-id> \
  --min_reserve_ratio_bps 10200
```

### Minting

`initialize` takes a single `MintingConfig` struct, passed as JSON:

```bash
stellar contract invoke \
  --id <minting-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --config '{
    "admin": "<admin-address>",
    "oracle": "<oracle-id>",
    "reserve_tracker": "<reserve-tracker-id>",
    "acbu_token": "<acbu-token-id>",
    "usdc_token": "<usdc-token-id>",
    "vault": "<vault-address>",
    "treasury": "<treasury-address>",
    "fee_rate_bps": 30,
    "fee_single_bps": 50,
    "operator": "<operator-address>",
    "operator_pub_key": "<64-hex-char-ed25519-pubkey>"
  }'
```

`admin` and `operator` must be different addresses.

### Burning

```bash
stellar contract invoke \
  --id <burning-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --admin <admin-address> \
  --oracle <oracle-id> \
  --reserve_tracker <reserve-tracker-id> \
  --acbu_token <acbu-token-id> \
  --withdrawal_processor <withdrawal-processor-address> \
  --vault <vault-address> \
  --fee_rate_bps 30 \
  --fee_single_redeem_bps 100
```

### Savings Vault

```bash
stellar contract invoke \
  --id <savings-vault-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --admin <admin-address> \
  --acbu_token <acbu-token-id> \
  --fee_rate_bps 0 \
  --yield_rate_bps 500
```

### Lending Pool

```bash
stellar contract invoke \
  --id <lending-pool-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --admin <admin-address> \
  --acbu_token <acbu-token-id> \
  --fee_rate_bps 300
```

### Escrow

```bash
stellar contract invoke \
  --id <escrow-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --admin <admin-address> \
  --acbu_token <acbu-token-id>
```

### Multisig

```bash
stellar contract invoke \
  --id <multisig-id> \
  --source-account "$STELLAR_SECRET_KEY" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- initialize \
  --signers '["<signer-1>","<signer-2>","<signer-3>","<signer-4>","<signer-5>"]' \
  --threshold 3
```

---

## Post-deploy verification

```bash
# Verify WASM artifacts match expected hashes
bash scripts/verify_deployment.sh testnet

# Check a contract is live on the network
stellar contract invoke \
  --id <contract-id> \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  -- get_fee_rate

# View on Stellar Expert
# Testnet: https://stellar.expert/explorer/testnet/contract/<contract-id>
# Mainnet: https://stellar.expert/explorer/public/contract/<contract-id>
```

---

## Troubleshooting

| Error | Likely cause | Fix |
|-------|--------------|-----|
| `Set STELLAR_SIGNER or STELLAR_SECRET_KEY` | Missing testnet signer | Configure either a CLI identity or a testnet-only seed |
| `STELLAR_SIGNER is required for mainnet` | Missing protected signer identity | Configure the MPC/HSM or hardware-backed CLI identity on the `mainnet-signer` runner |
| `DEPLOY_CONFIRM is not set` | Mainnet guard triggered | `export DEPLOY_CONFIRM=deploy` |
| `Unexpected output for Oracle deploy` | CLI version mismatch or invalid key | Check `stellar --version`; validate key is a valid secret (starts with `S`) |
| `WASM artifact not found` | Build didn't produce .wasm | Run `cargo build --locked --target wasm32-unknown-unknown --release` first |
| `Insufficient balance` | Not enough XLM for fees | Fund account via Friendbot (testnet) or purchase XLM (mainnet) |
| `Contract already initialized` | Re-initialization attempted | Deploy a new contract instance |
| `Unauthorized` | Wrong admin signer | Ensure the configured signer identity matches the initialised admin address |

---

## Security notes

1. **Never commit secret keys.** Mainnet deployment rejects raw keys and uses a protected signer identity.
2. `deployments/registry.json` contains **only contract IDs** — no secrets.
3. Use the **multisig contract** for all admin operations in production.
4. The `.soroban/` directory is gitignored — only `deployments/` is tracked.
5. **Mainnet deploys require `DEPLOY_CONFIRM=deploy`** — both locally and in CI
   (CI also requires the GitHub Environment approval gate on the `mainnet` env).
6. Run `make test` and testnet smoke tests before every mainnet deploy.
