#!/usr/bin/env bash
# validate-secrets.sh
#
# Fail-fast guard: ensures required secrets are present and do not contain
# well-known placeholder values before docker-compose or the app server starts.
#
# Usage:
#   bash scripts/validate-secrets.sh          # check all required vars
#   bash scripts/validate-secrets.sh docker   # check Docker service vars only
#   bash scripts/validate-secrets.sh app      # check application vars only
#
# Exit codes:
#   0  All required secrets are present and look valid
#   1  One or more secrets are missing or use a known-bad default

set -euo pipefail

MODE="${1:-all}"

# ---------------------------------------------------------------------------
# Known-bad placeholder values that must never appear in production.
# If any required secret exactly matches one of these strings it is rejected.
# ---------------------------------------------------------------------------
BANNED_VALUES=(
  "acbu_password"
  "change-me"
  "changeme"
  "password"
  "secret"
  "guest"
  "admin"
  "dev-jwt-secret-change-me-min-32-characters-long"
  "your-stellar-secret-key-here"
  "change-me-in-production"
  "change-me-strong-postgres-password"
  "change-me-strong-mongo-password"
  "change-me-strong-rabbitmq-password"
)

# ---------------------------------------------------------------------------
# Required vars split by context
# ---------------------------------------------------------------------------
DOCKER_VARS=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
  MONGO_USER
  MONGO_PASSWORD
  MONGO_DB
  RABBITMQ_USER
  RABBITMQ_PASSWORD
)

APP_VARS=(
  DATABASE_URL
  MONGODB_URI
  RABBITMQ_URL
  JWT_SECRET
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Colour

errors=0

check_var() {
  local var_name="$1"
  local value="${!var_name:-}"

  if [[ -z "$value" ]]; then
    echo -e "${RED}[MISSING]${NC}  $var_name is not set or is empty"
    (( errors++ )) || true
    return
  fi

  for banned in "${BANNED_VALUES[@]}"; do
    if [[ "$value" == "$banned" ]]; then
      echo -e "${RED}[INSECURE]${NC} $var_name uses a known placeholder value ('$banned')"
      (( errors++ )) || true
      return
    fi
  done

  echo -e "${GREEN}[OK]${NC}       $var_name"
}

# ---------------------------------------------------------------------------
# Determine which vars to check
# ---------------------------------------------------------------------------
VARS_TO_CHECK=()

case "$MODE" in
  docker)
    VARS_TO_CHECK=( "${DOCKER_VARS[@]}" )
    ;;
  app)
    VARS_TO_CHECK=( "${APP_VARS[@]}" )
    ;;
  all|*)
    VARS_TO_CHECK=( "${DOCKER_VARS[@]}" "${APP_VARS[@]}" )
    ;;
esac

# ---------------------------------------------------------------------------
# Run checks
# ---------------------------------------------------------------------------
echo ""
echo "========================================================"
echo "  ACBU Secret Validation (mode: $MODE)"
echo "========================================================"
echo ""

for var in "${VARS_TO_CHECK[@]}"; do
  check_var "$var"
done

echo ""

if (( errors > 0 )); then
  echo -e "${RED}✗ $errors secret(s) failed validation. Aborting.${NC}"
  echo ""
  echo -e "${YELLOW}Tip:${NC} Copy .env.example to .env and replace all placeholder values:"
  echo "  cp .env.example .env"
  echo "  # Then edit .env with real credentials"
  echo ""
  exit 1
fi

echo -e "${GREEN}✓ All required secrets are present and look valid.${NC}"
echo ""
exit 0
