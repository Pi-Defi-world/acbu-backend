#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$PROJECT_ROOT/soroban_token_contract.wasm"

# SHA-256 of the expected artifact — must match contractimport! sha256 fields.
# Updated to match the vendored artifact (fixes #636).
EXPECTED_HASH="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"

# Stellar / soroban-examples release that ships this exact token contract.
# Only used when --force is passed or the vendored artifact is missing/corrupt.
SOROBAN_EXAMPLES_TAG="v22.0.0"
SOROBAN_EXAMPLES_REPO="https://github.com/stellar/soroban-examples.git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

force=0
for arg in "$@"; do
  [[ "$arg" == "--force" ]] && force=1
done

# ── Use vendored artifact (in-repo copy, no network needed) ─────────────────
# soroban_token_contract.wasm is committed to the repository root and its
# integrity is enforced by EXPECTED_HASH.  Using the in-repo copy makes the
# build fully deterministic and offline-capable (fixes #639).
if [[ -f "$DEST" && "$force" -eq 0 ]]; then
  ACTUAL=$(sha256sum "$DEST" | awk '{print $1}')
  if [[ "$ACTUAL" == "$EXPECTED_HASH" ]]; then
    echo -e "${GREEN}[OK]${NC} soroban_token_contract.wasm present and verified (no network required)."
    exit 0
  fi
  echo -e "${YELLOW}[WARN]${NC} Vendored artifact hash mismatch — falling back to network build."
fi

# ── Network build (fallback / --force only) ─────────────────────────────────
echo -e "${YELLOW}[INFO]${NC} Building soroban_token_contract.wasm from source (network required) ..."

# Create temporary directory for the build
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Clone the soroban-examples repo at the pinned tag
git clone --depth 1 --branch "$SOROBAN_EXAMPLES_TAG" "$SOROBAN_EXAMPLES_REPO" "$TEMP_DIR/soroban-examples" 2>&1 | grep -v "^Cloning" || true

# Verify the token contract directory exists (try both old and new paths)
TOKEN_CONTRACT_DIR="$TEMP_DIR/soroban-examples/token"
if [[ ! -d "$TOKEN_CONTRACT_DIR" ]]; then
  # Fall back to older path structure for compatibility with older tags
  TOKEN_CONTRACT_DIR="$TEMP_DIR/soroban-examples/contracts/tokens/stellar_asset"
  if [[ ! -d "$TOKEN_CONTRACT_DIR" ]]; then
    echo -e "${RED}[FAIL]${NC} Token contract directory not found in soroban-examples@${SOROBAN_EXAMPLES_TAG}"
    echo "Checked paths:"
    echo "  - $TEMP_DIR/soroban-examples/token"
    echo "  - $TEMP_DIR/soroban-examples/contracts/tokens/stellar_asset"
    echo "The repository structure may have changed. Please verify SOROBAN_EXAMPLES_TAG."
    exit 1
  fi
fi

# Build the token contract
cd "$TOKEN_CONTRACT_DIR"
if cargo build --release --target wasm32-unknown-unknown >/dev/null 2>&1; then
  :
else
  echo -e "${RED}[FAIL]${NC} Failed to build soroban_token_contract from source."
  exit 1
fi

# Copy the built WASM to the destination
BUILT_WASM="$TEMP_DIR/soroban-examples/target/wasm32-unknown-unknown/release/soroban_token_contract.wasm"
if [[ ! -f "$BUILT_WASM" ]]; then
  echo -e "${RED}[FAIL]${NC} Built WASM file not found at expected location."
  exit 1
fi

cp "$BUILT_WASM" "$DEST"
cd "$PROJECT_ROOT"

# ── Verify ──────────────────────────────────────────────────────────────────
ACTUAL=$(sha256sum "$DEST" | awk '{print $1}')
if [[ "$ACTUAL" != "$EXPECTED_HASH" ]]; then
  rm -f "$DEST"
  echo -e "${RED}[FAIL]${NC} SHA-256 mismatch — built artifact rejected."
  echo "  expected: $EXPECTED_HASH"
  echo "  actual:   $ACTUAL"
  echo ""
  echo "Do NOT use this artifact. The source or build may have changed."
  echo "Update EXPECTED_HASH and SOROBAN_EXAMPLES_TAG if necessary."
  exit 1
fi

echo "[OK] soroban_token_contract.wasm ready at $DEST"
