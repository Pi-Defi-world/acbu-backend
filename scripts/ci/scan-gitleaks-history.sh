#!/bin/bash
# Scan full git history for secrets using gitleaks
# One-time maintainer action for auditing history and purging leaked values
# Usage: ./scripts/ci/scan-gitleaks-history.sh

set -e

echo "=== Gitleaks Full History Scan ==="
echo "Scanning git history for secrets (one-time maintainer action)"
echo ""

# Install gitleaks if not present
if ! command -v gitleaks &> /dev/null; then
  echo "Installing gitleaks..."
  brew install gitleaks || npm install -g gitleaks || {
    echo "Error: Could not install gitleaks"
    exit 1
  }
fi

# Run gitleaks on full history
echo "Running gitleaks on full repository history..."
gitleaks detect \
  --source . \
  --verbose \
  --exit-code 0 \
  --report-path gitleaks-history-report.json || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 1 ]; then
    echo ""
    echo "⚠️  SECRETS DETECTED IN HISTORY"
    echo "Report saved to: gitleaks-history-report.json"
    echo ""
    echo "Next steps:"
    echo "1. Review the report: cat gitleaks-history-report.json | jq '.'"
    echo "2. Identify which secrets were leaked and need rotation"
    echo "3. Rotate the following secret types (if found):"
    echo "   - JWT_SECRET"
    echo "   - CHALLENGE_TOKEN_SECRET"
    echo "   - API keys (Flutterwave, OpenAI, etc)"
    echo "   - Database credentials"
    echo "   - Webhook secrets"
    echo "4. Use git-filter-repo to remove the commits:"
    echo "   pip install git-filter-repo"
    echo "   git filter-repo --invert-paths --paths-from-file <(echo 'path/to/secret')"
    echo "5. Force push to rewrite history (coordinate with team)"
    echo "6. Verify no new secrets in CI workflow"
    exit $EXIT_CODE
  fi
}

echo ""
echo "✓ No secrets found in full history scan"
echo "History is clean!"
