#!/usr/bin/env bash
# =============================================================================
# submit_fixes.sh  —  ACBU smart contract fixes (#355, #357, #361, #362)
# Usage: chmod +x submit_fixes.sh && ./submit_fixes.sh
# Run this from the ROOT of your local acbu-smart-contract clone.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BRANCH="fix/issues-355-357-361-362"
REMOTE="origin"
BASE_BRANCH="dev"           # change to "main" if your repo uses main

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v git  >/dev/null 2>&1 || die "git not found"
command -v curl >/dev/null 2>&1 || warn "curl not found — skipping GitHub CLI check"

[ -f "Cargo.toml" ] || die "Run this script from the root of the acbu-smart-contract repo"

# Ensure working tree is clean before we start
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree has uncommitted changes. Stash or commit them first."
fi

# ── Fetch & branch ────────────────────────────────────────────────────────────
info "Fetching latest '$BASE_BRANCH' from $REMOTE..."
git fetch "$REMOTE" "$BASE_BRANCH"

info "Creating branch '$BRANCH' from $REMOTE/$BASE_BRANCH..."
if git show-ref --quiet "refs/heads/$BRANCH"; then
  warn "Branch '$BRANCH' already exists locally — checking it out"
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH" "$REMOTE/$BASE_BRANCH"
fi

# ── Copy fixed files ──────────────────────────────────────────────────────────
FIXES_DIR="$(dirname "$0")/acbu-fixes"   # adjust path if needed

copy_if_exists() {
  local src="$1" dst="$2"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    info "Copied: $dst"
  else
    warn "Source not found, skipping: $src"
  fi
}

info "Copying fixed source files..."
copy_if_exists "$FIXES_DIR/acbu_escrow/src/lib.rs"  "acbu_escrow/src/lib.rs"
copy_if_exists "$FIXES_DIR/acbu_minting/src/lib.rs" "acbu_minting/src/lib.rs"
copy_if_exists "$FIXES_DIR/shared/src/errors.rs"    "shared/src/errors.rs"

# ── Stage & commit ────────────────────────────────────────────────────────────
info "Staging changes..."
git add \
  acbu_escrow/src/lib.rs \
  acbu_minting/src/lib.rs \
  shared/src/errors.rs

# Only commit if there is actually something staged
if git diff --cached --quiet; then
  warn "Nothing new to commit — files may already be up to date"
else
  info "Committing..."
  git commit -m "fix: address issues #355 #357 #361 #362

#357 — add AlreadyInitialized guard to initialize() in escrow & minting
  Prevents re-initialisation from silently overwriting admin, fee rate,
  and token addresses.

#361 — add #[allow(dead_code)] to emit-only event structs
  Suppresses spurious lint warnings on event types that are only emitted,
  so real dead-code warnings elsewhere are not masked.

#355 — differentiate token_client transfer errors
  Switch from transfer() (panics) to try_transfer() (Result).
  TokenXferFailed  → token contract rejected the call
  TransferFailed   → internal disbursement step failed
  Callers no longer need verbose re-runs to diagnose which leg failed.

#362 — deduplicate require_auth when user == admin
  Introduce require_auth_dedup() helper in MintingContract.
  When both addresses are identical Soroban auth is charged only once."
fi

# ── Push ──────────────────────────────────────────────────────────────────────
info "Pushing branch to $REMOTE..."
git push -u "$REMOTE" "$BRANCH"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✓ Branch pushed successfully.${NC}"
echo ""
echo "  Next steps:"
echo "  1. Open a PR on GitHub:"
echo "     https://github.com/Pi-Defi-world/acbu-smart-contract/compare/$BASE_BRANCH...$BRANCH"
echo "  2. Use the PR description below (copy from FIX_SUMMARY.md)."
echo ""
echo "  Or if you have the GitHub CLI (gh) installed, run:"
echo "  gh pr create --base $BASE_BRANCH --head $BRANCH \\"
echo "    --title 'fix: address issues #355 #357 #361 #362' \\"
echo "    --body-file acbu-fixes/FIX_SUMMARY.md"
