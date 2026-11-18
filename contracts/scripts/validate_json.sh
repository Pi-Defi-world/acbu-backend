#!/usr/bin/env bash
# validate_json.sh – validate config JSON files against their schemas.
# Requires: Node 20 LTS (see .nvmrc / .node-version)
# Uses npx to run ajv-cli on-demand; no global install needed.
# Usage: ./scripts/validate_json.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

check_dep() {
    if ! command -v npx &>/dev/null; then
        echo "ERROR: npx not found. Install Node 20 LTS (https://nodejs.org)."
        exit 1
    fi
}

validate() {
    local schema="$1"
    local data="$2"
    echo "Validating $(basename "$data") ..."
    if npx --yes ajv-cli validate -s "$schema" -d "$data" --spec=draft7 2>&1; then
        echo "  ✓ $(basename "$data") is valid"
    else
        echo "  ✗ $(basename "$data") FAILED validation"
        exit 1
    fi
}

check_dep

validate "$REPO_ROOT/schemas/validators.schema.json"              "$REPO_ROOT/validators.json"
validate "$REPO_ROOT/schemas/weights.schema.json"                 "$REPO_ROOT/weights.json"
validate "$REPO_ROOT/schemas/oracle_basket_currencies.schema.json" "$REPO_ROOT/scripts/oracle_basket_currencies.json"
validate "$REPO_ROOT/schemas/oracle_basket_weights_bps.schema.json" "$REPO_ROOT/scripts/oracle_basket_weights_bps.json"

echo ""
echo "All JSON files passed schema validation."
