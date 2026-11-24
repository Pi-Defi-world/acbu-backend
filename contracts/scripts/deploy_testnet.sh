#!/usr/bin/env bash
# Thin wrapper — delegates to the main deploy script.
# Usage: STELLAR_SECRET_KEY=<key> ./scripts/deploy_testnet.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy.sh" testnet "$@"
