#!/usr/bin/env bash
# W11-CAR-001: Verify soroban-sdk provenance across all workspace member Cargo.toml files.
#
# Rules enforced:
#   1. The workspace root must pin soroban-sdk with an exact crates.io version
#      (i.e. "=X.Y.Z" — no caret, no tilde, no git source).
#   2. Every member Cargo.toml that references soroban-sdk must use
#      { workspace = true } — never a local version string or git URL.
#
# A floating git rev or mismatched version between crates causes:
#   - Build nondeterminism (Cargo.lock divergence across machines/CI runs).
#   - Runtime contract traps due to Soroban host-function ABI differences
#     between crates.io releases and arbitrary git commits.
#
# Exit codes: 0 = all checks pass, 1 = at least one violation found.

set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"
ROOT_CARGO="$CONTRACTS_DIR/Cargo.toml"
ERRORS=0

echo "=== W11-CAR-001: soroban-sdk provenance guard ==="
echo "Workspace root: $ROOT_CARGO"
echo ""

# ── 1. Workspace root must pin soroban-sdk with exact crates.io version ──────
echo "[1/2] Checking workspace root pin..."

ROOT_SDK_LINE=$(grep -E '^\s*soroban-sdk\s*=' "$ROOT_CARGO" | head -1 || true)
if [[ -z "$ROOT_SDK_LINE" ]]; then
  echo "ERROR: soroban-sdk not found in [workspace.dependencies] in $ROOT_CARGO"
  ERRORS=$((ERRORS + 1))
elif echo "$ROOT_SDK_LINE" | grep -qE '"git"\s*=|git\s*='; then
  echo "ERROR: soroban-sdk in workspace root uses a git source — must use crates.io exact pin."
  echo "  Found: $ROOT_SDK_LINE"
  ERRORS=$((ERRORS + 1))
elif ! echo "$ROOT_SDK_LINE" | grep -qE '"=\s*[0-9]+\.[0-9]+\.[0-9]+"'; then
  echo "ERROR: soroban-sdk in workspace root is not an exact pin (must use \"=X.Y.Z\" syntax)."
  echo "  Found: $ROOT_SDK_LINE"
  ERRORS=$((ERRORS + 1))
else
  echo "  OK: $ROOT_SDK_LINE"
fi

# ── 2. All member Cargo.toml files must use workspace = true ─────────────────
echo ""
echo "[2/2] Checking member crates..."

# Find all Cargo.toml files in the workspace, excluding the root and target dir
mapfile -t MEMBER_TOMLS < <(
  find "$CONTRACTS_DIR" -name "Cargo.toml" \
    ! -path "$ROOT_CARGO" \
    ! -path "*/target/*" \
    | sort
)

for TOML in "${MEMBER_TOMLS[@]}"; do
  RELATIVE="${TOML#"$(cd "$CONTRACTS_DIR/.." && pwd)/"}"

  # Skip if this file doesn't mention soroban-sdk at all
  if ! grep -q "soroban-sdk" "$TOML"; then
    continue
  fi

  # Check for any soroban-sdk line that is NOT workspace = true
  VIOLATIONS=$(grep -nE 'soroban-sdk\s*=' "$TOML" | grep -vE 'workspace\s*=\s*true' || true)
  if [[ -n "$VIOLATIONS" ]]; then
    echo "ERROR: $RELATIVE — soroban-sdk is not declared as { workspace = true }:"
    while IFS= read -r line; do
      echo "  $line"
    done <<< "$VIOLATIONS"
    ERRORS=$((ERRORS + 1))
  else
    echo "  OK: $RELATIVE"
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -gt 0 ]]; then
  echo "FAIL: $ERRORS violation(s) found."
  echo ""
  echo "Fix: set soroban-sdk = { workspace = true } in member Cargo.toml files"
  echo "and ensure the workspace root pins with an exact crates.io version:"
  echo "  soroban-sdk = \"=X.Y.Z\""
  exit 1
else
  echo "PASS: All soroban-sdk references are consistent with the workspace pin."
fi
