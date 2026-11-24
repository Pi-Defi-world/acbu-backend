#!/bin/bash

# WASM Hash Verification Script
# Verifies integrity of token WASM artifact before build
# Fails fast if hash mismatches to prevent supply chain attacks
# Usage: ./verify_wasm_hash.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WASM_FILE="$PROJECT_ROOT/soroban_token_contract.wasm"

# Expected hash - must match across all contracts
EXPECTED_HASH="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}[WASM Integrity Check]${NC} Verifying token contract artifact..."

# Check if WASM file exists
if [ ! -f "$WASM_FILE" ]; then
    echo -e "${RED}[FAIL]${NC} WASM file not found: $WASM_FILE"
    echo ""
    echo "The artifact is not stored in the repository."
    echo "Download it with:  ./scripts/fetch_token_wasm.sh"
    exit 1
fi

# Calculate actual hash
ACTUAL_HASH=$(sha256sum "$WASM_FILE" | awk '{print $1}')

# Verify hash matches
if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
    echo -e "${RED}[FAIL]${NC} WASM hash mismatch!"
    echo "Expected: $EXPECTED_HASH"
    echo "Actual:   $ACTUAL_HASH"
    echo ""
    echo "Supply chain risk detected:"
    echo "  - Token contract artifact has been modified or replaced"
    echo "  - Build will not proceed to prevent deployment of compromised artifact"
    echo ""
    echo "Resolution:"
    echo "  1. Verify the source of soroban_token_contract.wasm"
    echo "  2. If intentionally updated, run: sha256sum soroban_token_contract.wasm"
    echo "  3. Update EXPECTED_HASH in this script and all contract imports"
    echo "  4. Update: acbu_minting/src/lib.rs, acbu_burning/src/lib.rs, acbu_reserve_tracker/src/lib.rs"
    exit 1
fi

echo -e "${GREEN}[PASS]${NC} WASM hash verified: $ACTUAL_HASH"
echo "Token contract integrity confirmed"
exit 0
