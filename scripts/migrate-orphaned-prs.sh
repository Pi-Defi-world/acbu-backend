#!/usr/bin/env bash
#
# Replay the open pull requests stranded when acbu-smart-contract and
# acbu-frontend are archived (W11-MIG-010 / #1338).
#
# Each source PR is expressed against its standalone repository, so this tool
# fetches the PR head and its base commit, filters local-only/generated files,
# and rewrites the diff paths into the monorepo layout (`contracts/` or
# `frontend/`). It can export the result for preservation or apply it to a
# per-PR feature branch.
#
# Usage:
#   scripts/migrate-orphaned-prs.sh                  # print the plan (no network)
#   scripts/migrate-orphaned-prs.sh --check 1083     # validate against this tree
#   scripts/migrate-orphaned-prs.sh --apply 1083     # port onto port/pr-1083
#   scripts/migrate-orphaned-prs.sh --export /tmp/patches
#
# The inventory and per-PR checklist live in docs/monorepo/ORPHANED_PRS.md.

set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
cd "$ROOT_DIR"

CONTRACTS_REPO="Pi-Defi-world/acbu-smart-contract"
FRONTEND_REPO="Pi-Defi-world/acbu-frontend"

# PRs in inventory order. Keep in sync with docs/monorepo/ORPHANED_PRS.md.
ALL_PRS=(
  1088 1087 1086 1084 1083 1081 1080 1074 1072 1071
  1070 1069 1068 942 912 911 909 571
  751
)

# Local-only, generated, or known-malicious paths must never be replayed.
EXCLUDES=(
  ':(exclude).env'
  ':(exclude).env.*'
  ':(exclude).vscode/*'
  ':(exclude).claude/*'
  ':(exclude)dist/setup.js'
  ':(exclude)*.woff2'
  ':(exclude)*.llf'
  ':(exclude)node_modules/*'
  ':(exclude)target/*'
  ':(exclude)build'
  ':(exclude)error*.txt'
  ':(exclude)final.txt'
  ':(exclude)*.bat'
  ':(exclude)nodemon.json'
)

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

port_target() {
  case "$1" in
    751) printf '%s|%s\n' "frontend" "$FRONTEND_REPO" ;;
    1088|1087|1086|1084|1083|1081|1080|1074|1072|1071|1070|1069|1068|942|912|911|909|571)
      printf '%s|%s\n' "contracts" "$CONTRACTS_REPO" ;;
    *) return 1 ;;
  esac
}

MODE="plan"
EXPORT_DIR=""
REQUESTED=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --check) MODE="check" ;;
    --export)
      MODE="export"
      EXPORT_DIR="${2:-}"
      if [ -z "$EXPORT_DIR" ]; then
        echo "error: --export needs a target directory" >&2
        exit 2
      fi
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "error: unknown option $1" >&2
      usage >&2
      exit 2
      ;;
    *) REQUESTED+=("$1") ;;
  esac
  shift
done

if [ "${#REQUESTED[@]}" -eq 0 ]; then
  REQUESTED=("${ALL_PRS[@]}")
fi

for n in "${REQUESTED[@]}"; do
  if ! port_target "$n" >/dev/null; then
    echo "error: PR #$n is not in the migration inventory" >&2
    exit 2
  fi
done

START_REF=$(git rev-parse --abbrev-ref HEAD)
START_SHA=$(git rev-parse HEAD)
WORK_ROOT=$(mktemp -d)
trap 'rm -rf "$WORK_ROOT"' EXIT

# Emit the PR diff with monorepo path prefixes so the patch applies from the
# repository root, regardless of whether it is applied or only exported.
generate_patch() {
  local repo=$1 pr=$2 dest=$3 work=$4
  local url="https://github.com/${repo}.git"
  local base_sha base_branch

  base_sha=$(gh api "repos/$repo/pulls/$pr" --jq '.base.sha')
  base_branch=$(gh api "repos/$repo/pulls/$pr" --jq '.base.ref')

  rm -rf "$work"
  git init -q "$work"
  git -C "$work" remote add origin "$url"
  git -C "$work" fetch -q --depth=1 origin "refs/pull/$pr/head:refs/heads/pr"

  # Prefer the exact base commit. Fall back to the base branch tip if the
  # server refuses a direct SHA fetch.
  if ! git -C "$work" fetch -q --depth=1 origin "$base_sha"; then
    git -C "$work" fetch -q --depth=1 origin \
      "refs/heads/$base_branch:refs/heads/base"
    base_sha="refs/heads/base"
  fi

  git -C "$work" diff \
    --src-prefix="a/$dest/" \
    --dst-prefix="b/$dest/" \
    "$base_sha" refs/heads/pr -- . "${EXCLUDES[@]}"
}

need_network_tools() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "error: gh CLI is required for $MODE mode" >&2
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "error: gh is not authenticated (run: gh auth login)" >&2
    exit 1
  fi
}

if [ "$MODE" != "plan" ]; then
  need_network_tools
fi

if [ "$MODE" = "export" ]; then
  mkdir -p "$EXPORT_DIR"
  : >"$EXPORT_DIR/MANIFEST.txt"
fi

failures=0

for pr in "${REQUESTED[@]}"; do
  IFS='|' read -r dest repo <<<"$(port_target "$pr")"
  url="https://github.com/${repo}/pull/${pr}"

  if [ "$MODE" = "plan" ]; then
    printf '#%-4s  %-9s  %s  (%s)\n' "$pr" "$dest/" "$url" "$repo"
    continue
  fi

  work="$WORK_ROOT/work-$pr"
  patch="$WORK_ROOT/pr-$pr.patch"

  if [ "$MODE" = "apply" ] || [ "$MODE" = "check" ]; then
    if [ ! -d "$dest" ]; then
      echo "#$pr skipped: $dest/ is not present in this tree; land the monorepo import first or use --export" >&2
      failures=$((failures + 1))
      continue
    fi
  fi

  echo "#$pr: fetching $repo ..." >&2
  generate_patch "$repo" "$pr" "$dest" "$work" >"$patch"

  if [ ! -s "$patch" ]; then
    echo "#$pr skipped: the PR has no changes outside the excluded paths" >&2
    failures=$((failures + 1))
    continue
  fi

  case "$MODE" in
    export)
      head_sha=$(gh api "repos/$repo/pulls/$pr" --jq '.head.sha')
      head_ref=$(gh api "repos/$repo/pulls/$pr" --jq '.head.ref')
      cp "$patch" "$EXPORT_DIR/pr-$pr.patch"
      printf 'pr=%s repo=%s ref=%s sha=%s dest=%s file=pr-%s.patch\n' \
        "$pr" "$repo" "$head_ref" "$head_sha" "$dest/" "$pr" \
        >>"$EXPORT_DIR/MANIFEST.txt"
      echo "#$pr exported to $EXPORT_DIR/pr-$pr.patch" >&2
      ;;
    check)
      if git apply --check --whitespace=nowarn "$patch" 2>"$work/apply.log"; then
        echo "#$pr applies cleanly" >&2
      else
        echo "#$pr does NOT apply cleanly:" >&2
        sed 's/^/    /' "$work/apply.log" >&2
        failures=$((failures + 1))
      fi
      ;;
    apply)
      branch="port/pr-$pr"
      base="$START_SHA"
      if ! git checkout -q -B "$branch" "$base"; then
        echo "#$pr failed: could not create $branch" >&2
        failures=$((failures + 1))
        continue
      fi
      if git apply --3way --whitespace=nowarn "$patch" 2>"$work/apply.log"; then
        git add -A
        git commit -q -m "port: replay ${repo}#${pr} into ${dest}/"
        echo "#$pr applied on $branch (review before opening the PR)" >&2
      else
        echo "#$pr does NOT apply cleanly; branch reset:" >&2
        sed 's/^/    /' "$work/apply.log" >&2
        git reset -q --hard "$base"
        git checkout -q "$START_REF"
        failures=$((failures + 1))
      fi
      ;;
  esac
done

if [ "$MODE" = "export" ]; then
  echo "Manifest: $EXPORT_DIR/MANIFEST.txt" >&2
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures PR(s) need manual attention; see docs/monorepo/ORPHANED_PRS.md" >&2
  exit 1
fi
