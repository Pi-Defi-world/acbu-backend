#!/usr/bin/env bash
# =============================================================================
# ACBU Soroban Contracts — Deployment Script
# W2-C-062: guarded deploy pipeline with contract-address registry
#
# Usage:
#   STELLAR_SECRET_KEY=<key> ./scripts/deploy.sh testnet
#   STELLAR_SECRET_KEY=<key> DEPLOY_CONFIRM=deploy ./scripts/deploy.sh mainnet
#
# Non-interactive CI usage (mainnet):
#   STELLAR_SECRET_KEY=<key> DEPLOY_CONFIRM=deploy ./scripts/deploy.sh mainnet
#
# The script writes a deployment record to:
#   deployments/<network>.json          — network-specific snapshot
#   deployments/registry.json           — combined registry (all networks)
#
# Invoke scripts/update_registry.sh afterwards to commit the registry.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
error() { echo -e "${RED}[deploy] ERROR:${NC} $*" >&2; exit 1; }
step()  { echo -e "${BLUE}[deploy]${NC} $*"; }

# ---------------------------------------------------------------------------
# Argument / env validation
# ---------------------------------------------------------------------------
NETWORK="${1:-testnet}"

if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
    error "Invalid network '${NETWORK}'. Must be 'testnet' or 'mainnet'."
fi

if [[ -z "${STELLAR_SECRET_KEY:-}" ]]; then
    error "STELLAR_SECRET_KEY is not set. Export it before running this script."
fi

# ---------------------------------------------------------------------------
# Mainnet guard — non-interactive; set DEPLOY_CONFIRM=deploy to proceed
# ---------------------------------------------------------------------------
if [[ "$NETWORK" == "mainnet" ]]; then
    warn "==================================================================="
    warn "  *** MAINNET DEPLOYMENT — THIS WILL USE REAL XLM ***"
    warn "  Pre-requisites:"
    warn "    1. All testnet smoke tests passed"
    warn "    2. Security audit signed off"
    warn "    3. Admin secret key backed up"
    warn "    4. Team approval obtained"
    warn "==================================================================="
    DEPLOY_CONFIRM="${DEPLOY_CONFIRM:-}"
    if [[ "$DEPLOY_CONFIRM" != "deploy" ]]; then
        error "Mainnet deploy requires DEPLOY_CONFIRM=deploy to be set. Aborted."
    fi
    info "Mainnet confirmation accepted. Proceeding..."
fi

# ---------------------------------------------------------------------------
# Tool check
# ---------------------------------------------------------------------------
STELLAR_CLI=""
if command -v stellar &>/dev/null; then
    STELLAR_CLI="stellar"
elif command -v soroban &>/dev/null; then
    STELLAR_CLI="soroban"
else
    error "Neither 'stellar' nor 'soroban' CLI found. Install with:\n  cargo install --locked stellar-cli"
fi
info "Using CLI: $(command -v $STELLAR_CLI) ($($STELLAR_CLI --version 2>&1 | head -1))"

# ---------------------------------------------------------------------------
# Network config
# ---------------------------------------------------------------------------
if [[ "$NETWORK" == "testnet" ]]; then
    NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
    RPC_URL="https://soroban-testnet.stellar.org"
    HORIZON_URL="https://horizon-testnet.stellar.org"
else
    NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
    RPC_URL="https://soroban-rpc.stellar.org"
    HORIZON_URL="https://horizon.stellar.org"
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
step "Building all contracts (--locked --release)..."
cd "$PROJECT_ROOT"
cargo build --locked --target wasm32-unknown-unknown --release
info "Build complete."

WASM_DIR="$PROJECT_ROOT/target/wasm32-unknown-unknown/release"

# ---------------------------------------------------------------------------
# Helper: deploy one contract and return the contract ID
# The stellar CLI prints just the contract ID on stdout (no label).
# ---------------------------------------------------------------------------
deploy_contract() {
    local name="$1"    # human-readable name for logging
    local wasm="$2"    # path to .wasm file

    if [[ ! -f "$wasm" ]]; then
        error "WASM artifact not found: $wasm (did the build succeed?)"
    fi

    step "Deploying ${name}..."
    local contract_id
    contract_id=$(
        "$STELLAR_CLI" contract deploy \
            --wasm "$wasm" \
            --source-account "$STELLAR_SECRET_KEY" \
            --network-passphrase "$NETWORK_PASSPHRASE" \
            --rpc-url "$RPC_URL" \
            2>/dev/null
    )

    # Validate: Stellar contract IDs are 56-char base32 (G... or C...) strings
    if [[ -z "$contract_id" ]] || ! echo "$contract_id" | grep -qE '^[A-Z0-9]{56}$'; then
        error "Unexpected output for ${name} deploy: '${contract_id}'. Check CLI version and credentials."
    fi

    info "${name} deployed: ${contract_id}"
    echo "$contract_id"
}

# ---------------------------------------------------------------------------
# Deploy all 8 contracts in dependency order
# ---------------------------------------------------------------------------
# Infrastructure layer first
ORACLE_ID=$(deploy_contract     "Oracle"          "$WASM_DIR/acbu_oracle.wasm")
RESERVE_ID=$(deploy_contract    "Reserve Tracker" "$WASM_DIR/acbu_reserve_tracker.wasm")

# Governance layer
MULTISIG_ID=$(deploy_contract   "Multisig"        "$WASM_DIR/acbu_multisig.wasm")

# User-facing layer
MINTING_ID=$(deploy_contract    "Minting"         "$WASM_DIR/acbu_minting.wasm")
BURNING_ID=$(deploy_contract    "Burning"         "$WASM_DIR/acbu_burning.wasm")
SAVINGS_ID=$(deploy_contract    "Savings Vault"   "$WASM_DIR/acbu_savings_vault.wasm")
LENDING_ID=$(deploy_contract    "Lending Pool"    "$WASM_DIR/acbu_lending_pool.wasm")
ESCROW_ID=$(deploy_contract     "Escrow"          "$WASM_DIR/acbu_escrow.wasm")

# ---------------------------------------------------------------------------
# Write per-network deployment record
# ---------------------------------------------------------------------------
DEPLOY_DIR="$PROJECT_ROOT/deployments"
mkdir -p "$DEPLOY_DIR"

DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_SHA="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
GIT_REF="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"

NETWORK_FILE="$DEPLOY_DIR/${NETWORK}.json"

cat > "$NETWORK_FILE" <<EOF
{
  "network": "${NETWORK}",
  "network_passphrase": "${NETWORK_PASSPHRASE}",
  "rpc_url": "${RPC_URL}",
  "deployed_at": "${DEPLOYED_AT}",
  "git_sha": "${GIT_SHA}",
  "git_ref": "${GIT_REF}",
  "contracts": {
    "oracle":          "${ORACLE_ID}",
    "reserve_tracker": "${RESERVE_ID}",
    "multisig":        "${MULTISIG_ID}",
    "minting":         "${MINTING_ID}",
    "burning":         "${BURNING_ID}",
    "savings_vault":   "${SAVINGS_ID}",
    "lending_pool":    "${LENDING_ID}",
    "escrow":          "${ESCROW_ID}"
  }
}
EOF

info "Deployment record written to: ${NETWORK_FILE}"

# ---------------------------------------------------------------------------
# Update combined registry
# ---------------------------------------------------------------------------
"$SCRIPT_DIR/update_registry.sh" "$NETWORK" "$NETWORK_FILE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}===== Deployment complete (${NETWORK}) =====${NC}"
echo ""
printf "  %-20s %s\n" "Oracle:"          "$ORACLE_ID"
printf "  %-20s %s\n" "Reserve Tracker:" "$RESERVE_ID"
printf "  %-20s %s\n" "Multisig:"        "$MULTISIG_ID"
printf "  %-20s %s\n" "Minting:"         "$MINTING_ID"
printf "  %-20s %s\n" "Burning:"         "$BURNING_ID"
printf "  %-20s %s\n" "Savings Vault:"   "$SAVINGS_ID"
printf "  %-20s %s\n" "Lending Pool:"    "$LENDING_ID"
printf "  %-20s %s\n" "Escrow:"          "$ESCROW_ID"
echo ""
echo "  Registry:  ${DEPLOY_DIR}/registry.json"
echo "  Snapshot:  ${NETWORK_FILE}"
echo ""
echo "  Next steps:"
echo "    1. Commit deployments/ to git (or let CI do it via the deploy workflow)."
echo "    2. Initialise each contract — see DEPLOYMENT.md § Contract Initialization."
echo "    3. For testnet, see DEPLOYMENT.md § Post-Deploy Verification."
