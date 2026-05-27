#!/usr/bin/env bash
set -euo pipefail

# Run tests locally with Docker Compose for required services (Postgres, Mongo).
# Usage: bash ./scripts/run-tests-local.sh

command -v docker >/dev/null 2>&1 || { echo "docker CLI not found. Install Docker and ensure it's running." >&2; exit 1; }

echo "Starting Docker Compose services..."
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
else
  docker-compose up -d
fi

echo "Waiting for Postgres to be ready..."
MAX=120
i=0
while [ $i -lt $MAX ]; do
  if docker exec acbu-postgres pg_isready -U "${POSTGRES_USER:-acbu}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  i=$((i + 1))
done
if [ $i -ge $MAX ]; then
  echo "Postgres did not become ready in time." >&2
  exit 1
fi

echo "Ensuring test database exists (acbu_test)..."
EXISTS=$(docker exec -i acbu-postgres psql -U "${POSTGRES_USER:-acbu}" -tAc "SELECT 1 FROM pg_database WHERE datname='acbu_test'" 2>/dev/null || true)
if [ -z "$EXISTS" ]; then
  docker exec -i acbu-postgres psql -U "${POSTGRES_USER:-acbu}" -c "CREATE DATABASE acbu_test;"
  echo "Created acbu_test database."
else
  echo "acbu_test database already exists."
fi

echo "Pushing Prisma schema and generating client..."
pnpm prisma:push
pnpm prisma:generate

echo "Running tests (Jest)..."
pnpm test -i --runInBand
