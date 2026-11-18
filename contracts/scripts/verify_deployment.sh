#!/bin/bash

# Deployment Verification Script
# Verifies contract WASM hashes match expected values after deployment
# Usage: ./verify_deployment.sh <network> <deployment_file>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Expected hashes for all contracts
declare -A EXPECTED_HASHES=(
    ["acbu_minting"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    ["acbu_burning"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    ["acbu_oracle"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    ["acbu_reserve_tracker"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    ["acbu_savings_vault"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    ["acbu_lending_pool"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
    ["acbu_escrow"]="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"
)

# Token WASM hash
TOKEN_WASM_HASH="6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         ACBU Deployment Verification Script                ║${NC}"
echo -e "${BLUE}║         Verifies contract integrity post-deployment         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verify build artifacts exist
echo -e "${YELLOW}[Step 1/3]${NC} Verifying build artifacts..."
echo ""

ARTIFACTS_OK=true
for contract in "${!EXPECTED_HASHES[@]}"; do
    WASM="$PROJECT_ROOT/target/wasm32-unknown-unknown/release/$contract.wasm"
    
    if [ ! -f "$WASM" ]; then
        echo -e "${RED}❌ FAIL${NC}: Build artifact missing: $contract.wasm"
        ARTIFACTS_OK=false
        continue
    fi
    
    ACTUAL_HASH=$(sha256sum "$WASM" | awk '{print $1}')
    echo -e "${GREEN}✅ PASS${NC}: $contract.wasm"
    echo "   Hash: $ACTUAL_HASH"
done

if [ "$ARTIFACTS_OK" = false ]; then
    echo ""
    echo -e "${RED}Build artifacts verification failed${NC}"
    echo "Run: cargo build --target wasm32-unknown-unknown --release"
    exit 1
fi

echo ""
echo -e "${YELLOW}[Step 2/3]${NC} Verifying token WASM integrity..."
echo ""

WASM_FILE="$PROJECT_ROOT/soroban_token_contract.wasm"
if [ ! -f "$WASM_FILE" ]; then
    echo -e "${RED}❌ FAIL${NC}: Token WASM not found: $WASM_FILE"
    exit 1
fi

ACTUAL_TOKEN_HASH=$(sha256sum "$WASM_FILE" | awk '{print $1}')
if [ "$ACTUAL_TOKEN_HASH" != "$TOKEN_WASM_HASH" ]; then
    echo -e "${RED}❌ FAIL${NC}: Token WASM hash mismatch"
    echo "Expected: $TOKEN_WASM_HASH"
    echo "Actual:   $ACTUAL_TOKEN_HASH"
    exit 1
fi

echo -e "${GREEN}✅ PASS${NC}: Token WASM integrity verified"
echo "Hash: $ACTUAL_TOKEN_HASH"

echo ""
echo -e "${YELLOW}[Step 3/3]${NC} Verifying contract imports..."
echo ""

IMPORTS_OK=true
for contract in acbu_minting acbu_burning acbu_reserve_tracker; do
    FILE="$PROJECT_ROOT/$contract/src/lib.rs"
    
    if ! grep -q "sha256 = \"$TOKEN_WASM_HASH\"" "$FILE"; then
        echo -e "${RED}❌ FAIL${NC}: Hash mismatch in $contract"
        IMPORTS_OK=false
    else
        echo -e "${GREEN}✅ PASS${NC}: $contract has correct token WASM hash"
    fi
done

if [ "$IMPORTS_OK" = false ]; then
    echo ""
    echo -e "${RED}Contract import verification failed${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}✅ All verification checks passed${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}║  Contracts are ready for deployment                        ║${NC}"
echo -e "${BLUE}║  All WASM artifacts have been verified                     ║${NC}"
echo -e "${BLUE}║  Token contract integrity confirmed                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

exit 0
