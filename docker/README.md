# Docker

This directory holds the Dockerfiles for the individual ACBU services. The
infrastructure services (PostgreSQL, MongoDB, RabbitMQ), the backend API, and
the optional application services are all wired together in the root
[`docker-compose.yml`](../docker-compose.yml).

## Files

| File | Service | Purpose |
|------|---------|---------|
| `frontend.Dockerfile` | `frontend` | Multi-stage build for the Next.js app in `acbu-frontend/` |
| [`../Dockerfile`](../Dockerfile) | `backend` | Multi-stage build for the backend API (TypeScript → `dist/`) |

## Compose profiles

The `backend` service runs by default together with the infrastructure
services. The remaining pieces of the complete stack are behind compose
profiles, so a plain `docker compose up` never attempts to build them:

| Profile | Service | Image / Build |
|---------|---------|---------------|
| `frontend` | `frontend` | `docker/frontend.Dockerfile` (context: `acbu-frontend/`) |
| `stellar` | `stellar-sandbox` | `stellar/quickstart:latest` (ephemeral local network) |
| `full` | all optional services | — |

## Common commands

```bash
# Infrastructure + backend API (default)
docker compose up -d --wait

# Frontend on http://localhost:3000 (requires acbu-frontend/ checkout)
docker compose --profile frontend up -d --build

# Local Soroban sandbox (Horizon/RPC/friendbot on http://localhost:8000)
docker compose --profile stellar up -d

# Complete ACBU stack
docker compose --profile full up -d --build --wait
```

## Notes

- **Frontend build context:** the frontend image is built from the
  `acbu-frontend/` directory. It requires a frontend checkout there and
  `output: "standalone"` in the Next.js config (the runner stage serves
  `.next/standalone/server.js`).
- **Stellar sandbox:** the `stellar/quickstart` container runs an ephemeral
  local Stellar network (`--local`). It exposes Horizon on
  `http://localhost:8000`, Soroban RPC on `http://localhost:8000/rpc`, and a
  friendbot faucet on `http://localhost:8000/friendbot`. To point the backend
  at it, set in `.env`:
  - `STELLAR_SOROBAN_RPC_URL=http://stellar-sandbox:8000/rpc`
  - `STELLAR_HORIZON_URL=http://stellar-sandbox:8000`
- **No Redis service:** Redis is intentionally not part of the compose file —
  it is reserved for future use (see `.env.example`).

