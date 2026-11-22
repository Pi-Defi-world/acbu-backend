#!/usr/bin/env bash
# =============================================================================
# ACBU Soroban Contracts — Deployment Script
# W2-C-062: guarded deploy pipeline with contract-address registry
#
# Usage:
#   STELLAR_SECRET_KEY=<key> ./scripts/deploy.sh testnet
#   STELLAR_SIGNER=acbu-mainnet-deployer DEPLOY_CONFIRM=deploy ./scripts/deploy.sh mainnet
#
# Non-interactive CI usage (mainnet):
#   STELLAR_SIGNER=<configured-identity> DEPLOY_CONFIRM=deploy ./scripts/deploy.sh mainnet
#
# Initialisation parameters (real addresses — never TODO_/placeholders) are
# read from the environment, or from a file via DEPLOY_ENV_FILE=<path>:
#   ADMIN_ADDRESS, ACBU_TOKEN_ID, USDC_TOKEN_ID, VAULT_ADDRESS,
#   TREASURY_ADDRESS, WITHDRAWAL_PROCESSOR, OPERATOR_ADDRESS,
#   OPERATOR_PUB_KEY, ORACLE_VALIDATORS, ORACLE_MIN_SIGNATURES,
#   MULTISIG_SIGNERS, MULTISIG_THRESHOLD
# Set SKIP_INIT=1 to deploy without initialising (contracts stay inert).
# Full list + defaults: DEPLOYMENT.md § Initialisation parameters.
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

# Logs go to stderr so that $(...) command substitutions around helpers
# (e.g. deploy_contract) only capture the helper's real stdout payload.
info()  { echo -e "${GREEN}[deploy]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*" >&2; }
error() { echo -e "${RED}[deploy] ERROR:${NC} $*" >&2; exit 1; }
step()  { echo -e "${BLUE}[deploy]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Argument / env validation
# ---------------------------------------------------------------------------
NETWORK="${1:-testnet}"

if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
    error "Invalid network '${NETWORK}'. Must be 'testnet' or 'mainnet'."
fi

if [[ "$NETWORK" == "mainnet" ]]; then
    if [[ -n "${STELLAR_SECRET_KEY:-}" ]]; then
        error "Raw STELLAR_SECRET_KEY values are forbidden for mainnet. Configure an MPC/HSM, hardware-wallet, or quorum-controlled Stellar CLI identity and pass its name via STELLAR_SIGNER."
    fi
    [[ -n "${STELLAR_SIGNER:-}" ]] || error "STELLAR_SIGNER is required for mainnet."
    DEPLOY_SOURCE_ACCOUNT="$STELLAR_SIGNER"
else
    DEPLOY_SOURCE_ACCOUNT="${STELLAR_SIGNER:-${STELLAR_SECRET_KEY:-}}"
    [[ -n "$DEPLOY_SOURCE_ACCOUNT" ]] || error "Set STELLAR_SIGNER or STELLAR_SECRET_KEY before deploying to testnet."
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
# Initialisation parameters — sourced from env / secrets, never placeholders
#
# Everything is validated BEFORE any XLM is spent on deployments, so a
# misconfigured run fails fast instead of leaving initialised-less contracts
# on chain.  See DEPLOYMENT.md § Initialisation parameters.
# ---------------------------------------------------------------------------
if [[ -n "${DEPLOY_ENV_FILE:-}" ]]; then
    if [[ ! -f "$DEPLOY_ENV_FILE" ]]; then
        error "DEPLOY_ENV_FILE points to a missing file: $DEPLOY_ENV_FILE"
    fi
    set -a
    # shellcheck disable=SC1090
    source "$DEPLOY_ENV_FILE"
    set +a
    info "Loaded initialisation parameters from: $DEPLOY_ENV_FILE"
fi

SKIP_INIT="${SKIP_INIT:-0}"

# Numeric defaults (override via env) — documented in DEPLOYMENT.md.
[[ -n "${ORACLE_CURRENCIES:-}" ]]         || ORACLE_CURRENCIES='["NGN","KES","RWF","GHS","UGX","TZS","ZAR","EGP"]'
[[ -n "${ORACLE_BASKET_WEIGHTS:-}" ]]     || ORACLE_BASKET_WEIGHTS='{"NGN":1800,"KES":1200,"RWF":800,"GHS":900,"UGX":700,"TZS":600,"ZAR":1500,"EGP":1500}'
[[ -n "${MIN_RESERVE_RATIO_BPS:-}" ]]     || MIN_RESERVE_RATIO_BPS="10200"
[[ -n "${MINT_FEE_RATE_BPS:-}" ]]         || MINT_FEE_RATE_BPS="30"
[[ -n "${MINT_FEE_SINGLE_BPS:-}" ]]       || MINT_FEE_SINGLE_BPS="50"
[[ -n "${BURN_FEE_RATE_BPS:-}" ]]         || BURN_FEE_RATE_BPS="30"
[[ -n "${BURN_FEE_SINGLE_REDEEM_BPS:-}" ]] || BURN_FEE_SINGLE_REDEEM_BPS="100"
[[ -n "${SAVINGS_FEE_RATE_BPS:-}" ]]      || SAVINGS_FEE_RATE_BPS="0"
[[ -n "${SAVINGS_YIELD_RATE_BPS:-}" ]]    || SAVINGS_YIELD_RATE_BPS="500"
[[ -n "${LENDING_FEE_RATE_BPS:-}" ]]      || LENDING_FEE_RATE_BPS="300"

INIT_ERRORS=()
add_error() { INIT_ERRORS+=("$1"); }

# Reject empty values, `<...>` angle-bracket placeholders and TODO_/TBD/… text.
is_placeholder() {
    local value="$1"
    if [[ -z "$value" || "$value" == \<*\> ]]; then
        return 0
    fi
    printf '%s' "$value" | grep -qiE '(^|[^a-z])(todo|tbd|placeholder|changeme|replace[-_]?me|xxx)([^a-z]|$)'
}

# Stellar contract IDs / account addresses are 56-char base32 strings.
validate_address() {
    local name="$1" value="$2" kind="${3:-account or contract}"
    local re='^[CG][A-Z2-7]{55}$'
    if [[ "$kind" == "contract" ]]; then
        re='^C[A-Z2-7]{55}$'
    elif [[ "$kind" == "account" ]]; then
        re='^G[A-Z2-7]{55}$'
    fi

    if [[ -z "$value" ]]; then
        add_error "${name} is not set"
    elif [[ "$value" =~ $re ]]; then
        return 0
    elif is_placeholder "$value"; then
        add_error "${name} is a placeholder ('${value}') — provide the real address"
    else
        add_error "${name} ('${value}') is not a valid Stellar ${kind} address"
    fi
}

validate_uint() {
    local name="$1" value="$2"
    if [[ -z "$value" ]]; then
        add_error "${name} is not set"
    elif ! [[ "$value" =~ ^[0-9]+$ ]]; then
        add_error "${name} ('${value}') must be a non-negative integer"
    fi
}

# A JSON array whose every element is a Stellar address (G…/C…).
validate_address_array() {
    local name="$1" value="$2"
    if [[ -z "$value" ]]; then
        add_error "${name} is not set"
        return 0
    fi
    local compact total valid
    compact="$(printf '%s' "$value" | tr -d '[:space:]')"
    if [[ "$compact" != \[*\] ]]; then
        if is_placeholder "$compact"; then
            add_error "${name} is a placeholder ('${value}') — provide the real JSON array"
        else
            add_error "${name} must be a JSON array of addresses, e.g. [\"G…\",\"C…\"]"
        fi
        return 0
    fi
    total=$(printf '%s' "$compact" | grep -o '"[^"]*"' | wc -l | tr -d ' ' || true)
    valid=$(printf '%s' "$compact" | grep -oE '"[CG][A-Z2-7]{55}"' | wc -l | tr -d ' ' || true)
    if [[ "$total" -eq 0 || "$total" -ne "$valid" ]]; then
        add_error "${name} must contain only Stellar addresses — got '${value}'"
    fi
}

if [[ "$SKIP_INIT" == "1" ]]; then
    warn "SKIP_INIT=1 — contracts will be deployed but NOT initialised."
    warn "They will stay inert until initialised (see DEPLOYMENT.md)."
else
    # Addresses supplied by ops / secrets (external token + treasury plumbing).
    validate_address "ADMIN_ADDRESS"           "${ADMIN_ADDRESS:-}"           "account or contract"
    validate_address "ACBU_TOKEN_ID"           "${ACBU_TOKEN_ID:-}"           "contract"
    validate_address "USDC_TOKEN_ID"           "${USDC_TOKEN_ID:-}"           "contract"
    validate_address "VAULT_ADDRESS"           "${VAULT_ADDRESS:-}"           "account or contract"
    validate_address "TREASURY_ADDRESS"        "${TREASURY_ADDRESS:-}"        "account or contract"
    validate_address "WITHDRAWAL_PROCESSOR"    "${WITHDRAWAL_PROCESSOR:-}"    "account or contract"
    validate_address "OPERATOR_ADDRESS"        "${OPERATOR_ADDRESS:-}"        "account or contract"

    if [[ -z "${OPERATOR_PUB_KEY:-}" ]]; then
        add_error "OPERATOR_PUB_KEY is not set"
    elif ! [[ "$OPERATOR_PUB_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
        add_error "OPERATOR_PUB_KEY must be a 32-byte ed25519 public key (64 hex chars)"
    fi

    validate_address_array "ORACLE_VALIDATORS" "${ORACLE_VALIDATORS:-}"
    validate_uint          "ORACLE_MIN_SIGNATURES" "${ORACLE_MIN_SIGNATURES:-}"
    validate_address_array "MULTISIG_SIGNERS"  "${MULTISIG_SIGNERS:-}"
    validate_uint          "MULTISIG_THRESHOLD" "${MULTISIG_THRESHOLD:-}"

    for numeric_var in MIN_RESERVE_RATIO_BPS MINT_FEE_RATE_BPS MINT_FEE_SINGLE_BPS \
                       BURN_FEE_RATE_BPS BURN_FEE_SINGLE_REDEEM_BPS \
                       SAVINGS_FEE_RATE_BPS SAVINGS_YIELD_RATE_BPS LENDING_FEE_RATE_BPS; do
        validate_uint "$numeric_var" "${!numeric_var}"
    done

    if [[ ${#INIT_ERRORS[@]} -gt 0 ]]; then
        error "Invalid initialisation configuration (${#INIT_ERRORS[@]} problem(s)):\n$(printf '  - %s\n' "${INIT_ERRORS[@]}")\nFix the values (env vars or DEPLOY_ENV_FILE) — see DEPLOYMENT.md § Initialisation parameters."
    fi

    # Cross-parameter sanity checks.
    validator_count=$(printf '%s' "$ORACLE_VALIDATORS" | grep -oE '"[CG][A-Z2-7]{55}"' | wc -l | tr -d ' ' || true)
    if (( ORACLE_MIN_SIGNATURES < 1 || ORACLE_MIN_SIGNATURES > validator_count )); then
        error "ORACLE_MIN_SIGNATURES (${ORACLE_MIN_SIGNATURES}) must be between 1 and the validator count (${validator_count})."
    fi

    signer_count=$(printf '%s' "$MULTISIG_SIGNERS" | grep -oE '"[CG][A-Z2-7]{55}"' | wc -l | tr -d ' ' || true)
    if (( MULTISIG_THRESHOLD < 1 || MULTISIG_THRESHOLD > signer_count )); then
        error "MULTISIG_THRESHOLD (${MULTISIG_THRESHOLD}) must be between 1 and the signer count (${signer_count})."
    fi

    if [[ "$ADMIN_ADDRESS" == "$OPERATOR_ADDRESS" ]]; then
        error "ADMIN_ADDRESS and OPERATOR_ADDRESS must differ (minting enforces role separation)."
    fi

    info "Initialisation parameters validated (no placeholders)."
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
            --source-account "$DEPLOY_SOURCE_ACCOUNT" \
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
# Initialise contracts — arguments come exclusively from the validated env
# config above (never TODO_* / <placeholders>).
# ---------------------------------------------------------------------------
invoke_initialize() {
    local name="$1" contract_id="$2"
    shift 2

    step "Initialising ${name} (${contract_id})..."
    local output
    if ! output=$("$STELLAR_CLI" contract invoke \
            --id "$contract_id" \
            --source-account "$DEPLOY_SOURCE_ACCOUNT" \
            --network-passphrase "$NETWORK_PASSPHRASE" \
            --rpc-url "$RPC_URL" \
            -- initialize "$@" 2>&1); then
        error "Initialisation of ${name} failed:\n${output}\nThe deployment record was still written to ${NETWORK_FILE}."
    fi
    info "${name} initialised."
}

if [[ "$SKIP_INIT" == "1" ]]; then
    warn "Initialisation skipped (SKIP_INIT=1)."
else
    step "Initialising 8 contracts in dependency order..."

    invoke_initialize "Oracle" "$ORACLE_ID" \
        --admin "$ADMIN_ADDRESS" \
        --validators "$ORACLE_VALIDATORS" \
        --min_signatures "$ORACLE_MIN_SIGNATURES" \
        --currencies "$ORACLE_CURRENCIES" \
        --basket_weights "$ORACLE_BASKET_WEIGHTS"

    invoke_initialize "Reserve Tracker" "$RESERVE_ID" \
        --admin "$ADMIN_ADDRESS" \
        --oracle "$ORACLE_ID" \
        --acbu_token "$ACBU_TOKEN_ID" \
        --min_reserve_ratio_bps "$MIN_RESERVE_RATIO_BPS"

    invoke_initialize "Multisig" "$MULTISIG_ID" \
        --signers "$MULTISIG_SIGNERS" \
        --threshold "$MULTISIG_THRESHOLD"

    MINTING_CONFIG_JSON=$(printf \
        '{"admin":"%s","oracle":"%s","reserve_tracker":"%s","acbu_token":"%s","usdc_token":"%s","vault":"%s","treasury":"%s","fee_rate_bps":%s,"fee_single_bps":%s,"operator":"%s","operator_pub_key":"%s"}' \
        "$ADMIN_ADDRESS" "$ORACLE_ID" "$RESERVE_ID" "$ACBU_TOKEN_ID" "$USDC_TOKEN_ID" \
        "$VAULT_ADDRESS" "$TREASURY_ADDRESS" "$MINT_FEE_RATE_BPS" "$MINT_FEE_SINGLE_BPS" \
        "$OPERATOR_ADDRESS" "$OPERATOR_PUB_KEY")

    invoke_initialize "Minting" "$MINTING_ID" --config "$MINTING_CONFIG_JSON"

    invoke_initialize "Burning" "$BURNING_ID" \
        --admin "$ADMIN_ADDRESS" \
        --oracle "$ORACLE_ID" \
        --reserve_tracker "$RESERVE_ID" \
        --acbu_token "$ACBU_TOKEN_ID" \
        --withdrawal_processor "$WITHDRAWAL_PROCESSOR" \
        --vault "$VAULT_ADDRESS" \
        --fee_rate_bps "$BURN_FEE_RATE_BPS" \
        --fee_single_redeem_bps "$BURN_FEE_SINGLE_REDEEM_BPS"

    invoke_initialize "Savings Vault" "$SAVINGS_ID" \
        --admin "$ADMIN_ADDRESS" \
        --acbu_token "$ACBU_TOKEN_ID" \
        --fee_rate_bps "$SAVINGS_FEE_RATE_BPS" \
        --yield_rate_bps "$SAVINGS_YIELD_RATE_BPS"

    invoke_initialize "Lending Pool" "$LENDING_ID" \
        --admin "$ADMIN_ADDRESS" \
        --acbu_token "$ACBU_TOKEN_ID" \
        --fee_rate_bps "$LENDING_FEE_RATE_BPS"

    invoke_initialize "Escrow" "$ESCROW_ID" \
        --admin "$ADMIN_ADDRESS" \
        --acbu_token "$ACBU_TOKEN_ID"
fi

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
if [[ "$SKIP_INIT" == "1" ]]; then
    echo "  Initialisation: SKIPPED (SKIP_INIT=1)"
    echo ""
    echo "  Next steps:"
    echo "    1. Initialise each contract — see DEPLOYMENT.md § Contract initialisation."
    echo "    2. Commit deployments/ to git (or let CI do it via the deploy workflow)."
else
    echo "  Initialisation: complete (8/8 contracts)"
    echo ""
    echo "  Next steps:"
    echo "    1. Commit deployments/ to git (or let CI do it via the deploy workflow)."
    echo "    2. For testnet, see DEPLOYMENT.md § Post-deploy verification."
fi
