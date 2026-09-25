# Environment Variables

This file documents the environment variables required by the ACBU backend and the defaults used by the runtime.

## ⚠️ Security Guidelines

**CRITICAL:** The `.env` file contains sensitive credentials. Follow these practices:

1. **Never commit `.env` to git** — add it to `.gitignore` (already configured).
2. **Use `.env.example` as a template** — it contains placeholder values only.
3. **Rotate credentials immediately** if `.env` is ever accidentally exposed or committed.
4. **Validate URL syntax** before deployment:
   - `RABBITMQ_URL` — must follow `amqp://user:password@host:port/vhost`
   - `DATABASE_URL` — must be a valid PostgreSQL connection string
   - `MONGODB_URI` — must be a valid MongoDB connection string
5. **Use strong secrets** — `JWT_SECRET` must be at least 32 characters in production.
6. **Production secrets** — use your cloud provider's secrets manager (AWS Secrets Manager, GCP Secret Manager, etc.).
7. **Environment-specific files** — keep separate `.env.production`, `.env.staging` (not in git) with real credentials.

**If credentials are exposed:**
- Rotate all API keys, database passwords, and secrets immediately.
- Audit git history: `git log --all --source --full-history -- .env`
- Force-push to remove sensitive commits (requires admin approval).

## Docker service credentials

These variables are consumed exclusively by `docker-compose.yml` to initialise
the local Postgres, MongoDB, and RabbitMQ containers. There are **no built-in
defaults** — Docker Compose will refuse to start a service if any variable is
absent (`:?` error syntax is used throughout `docker-compose.yml`).

> **Security:** Never reuse the placeholder strings from `.env.example` in any
> shared or long-lived environment. Generate strong random passwords (e.g.
> `openssl rand -base64 32`).

| Variable | Service | Description |
|---|---|---|
| `POSTGRES_USER` | postgres | Database superuser name |
| `POSTGRES_PASSWORD` | postgres | Database superuser password — must be strong |
| `POSTGRES_DB` | postgres | Default database name |
| `MONGO_USER` | mongodb | MongoDB root username |
| `MONGO_PASSWORD` | mongodb | MongoDB root password — must be strong |
| `MONGO_DB` | mongodb | Default MongoDB database name |
| `RABBITMQ_USER` | rabbitmq | RabbitMQ default username |
| `RABBITMQ_PASSWORD` | rabbitmq | RabbitMQ default password — must be strong |

Run `bash scripts/validate-secrets.sh docker` to verify these are set and
do not contain known placeholder values before starting the stack.

## Required variables

- `DATABASE_URL`
  - Direct PostgreSQL connection string for Prisma migrations and local runtime fallback.
  - Must not use `prisma://` or `prisma+postgres://`.
- `MONGODB_URI`
  - MongoDB connection string for the cache layer.
- `RABBITMQ_URL`
  - RabbitMQ connection string for queue-based features.
- `JWT_SECRET`
  - Secret used for JWT signing and verification.
  - Must be at least 32 characters and must not equal the documented `.env.example` placeholder value.
- `BILLS_WEBHOOK_SECRET`
  - HMAC secret for verifying `/v1/webhooks/bills/:provider` signatures. Required in production.

## Runtime database configuration

- `PRISMA_ACCELERATE_URL`
  - Optional for local development.
  - When set, the app uses Prisma Accelerate for runtime queries.
  - Must start with `prisma://` or `prisma+postgres://`.
  - In production, this variable is required.
- `PRISMA_MIGRATION_HISTORY_REPLICATED`
  - Defaults to `false`.
  - In production, set to `true` only after verifying `_prisma_migrations` is replicated to failover targets.
  - The app refuses to run startup migrations in production until this is explicitly acknowledged.

## Optional and configurable variables

### General application

- `NODE_ENV` - defaults to `development`
- `PORT` - defaults to `5000`
- `API_VERSION` - defaults to `v1`
- `CHALLENGE_TOKEN_SECRET` - required explicitly in production (distinct from `JWT_SECRET`); falls back to `JWT_SECRET` outside production
- `JWT_EXPIRES_IN` - defaults to `7d`
- `JWT_CLOCK_TOLERANCE_SECONDS` - defaults to `30`
- `API_KEY_SALT` - defaults to empty string
- `ADMIN_API_KEY` - Single admin key (legacy support)
- `ADMIN_API_KEYS` - Comma-separated list of admin keys or `adminId:key` pairs for multi-admin authentication and attribution
- `LOG_LEVEL` - defaults to `info`
- `LOG_FILE` - defaults to `logs/app.log`

### Rate limiting

- `RATE_LIMIT_WINDOW_MS` - defaults to `60000`
- `RATE_LIMIT_MAX_REQUESTS` - defaults to `100`
- `AUTH_RATE_LIMIT_WINDOW_MS` - defaults to `900000`
- `AUTH_RATE_LIMIT_MAX_REQUESTS` - defaults to `10`
- `ADMIN_RATE_LIMIT_WINDOW_MS` - defaults to `60000`
- `ADMIN_RATE_LIMIT_MAX_REQUESTS` - defaults to `30`
- `RATE_LIMIT_FALLBACK_MAX_REQUESTS` - defaults to `20`
- `RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD` - defaults to `5`
- `RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN_MS` - defaults to `60000`

### Encryption and security

- `PII_ENCRYPTION_KEY`
  - Optional.
  - Must be exactly 64 hex characters (32 bytes).
- `CAPTCHA_SECRET`
- `AUTH_BRUTE_MAX_ATTEMPTS` - defaults to `5`
- `AUTH_BRUTE_LOCKOUT_MS` - defaults to `900000`

### Fintech providers

- `FLUTTERWAVE_PUBLIC_KEY`
- `FLUTTERWAVE_SECRET_KEY`
- `FLUTTERWAVE_ENCRYPTION_KEY`
- `FLUTTERWAVE_WEBHOOK_SECRET`
- `FLUTTERWAVE_BASE_URL`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_BASE_URL`
- `MTN_MOMO_SUBSCRIPTION_KEY`
- `MTN_MOMO_API_USER_ID`
- `MTN_MOMO_API_KEY`
- `MTN_MOMO_BASE_URL`
- `MTN_MOMO_TARGET_ENVIRONMENT`
- `FINTECH_CURRENCY_PROVIDERS`

### AWS / S3

- `AWS_REGION` or `S3_REGION`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `AWS_ACCESS_KEY_ID` or `S3_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY` or `S3_SECRET_ACCESS_KEY`
- `S3_UPLOAD_URL_TTL_SECONDS` - defaults to `900`
- `S3_DOWNLOAD_URL_TTL_SECONDS` - defaults to `300`
- `S3_SCAN_WEBHOOK_SECRET`

### Stellar

- `STELLAR_NETWORK` - defaults to `testnet`
- `STELLAR_HORIZON_URL`
- `STELLAR_SOROBAN_RPC_URL`
- `STELLAR_SECRET_KEY`
- `STELLAR_NATIVE_ASSET_CODE`
- `WALLET_ACTIVATION_STRATEGY` - defaults to `create_account_native`
- `TESTNET_CUSTODIAL_BOOTSTRAP`
- `WALLET_ACTIVATION_AMOUNT` / `WALLET_ACTIVATION_NATIVE` / `WALLET_ACTIVATION_XLM` / `STELLAR_MIN_BALANCE`
- `STELLAR_BASE_FEE_STROOPS` - defaults to `100`
- `STELLAR_USE_DYNAMIC_FEES`
- `STELLAR_SOROBAN_MIN_FEE_STROOPS` - defaults to `5000`
- `STELLAR_SOROBAN_MAX_FEE_STROOPS` - defaults to `10000000`
- `USDC_ISSUER_TESTNET`
- `USDC_ISSUER_MAINNET`
- `USDC_ASSET_CODE_TESTNET` - defaults to `USDC`
- `USDC_ASSET_CODE_MAINNET` - defaults to `USDC`
- `USDC_XLM_SLIPPAGE_BPS` - defaults to `50`

### Oracle

- `ORACLE_UPDATE_INTERVAL_HOURS` - defaults to `6`
- `ORACLE_EMERGENCY_THRESHOLD` - defaults to `0.05`
- `ORACLE_MAX_DEVIATION_PER_UPDATE` - defaults to `0.05`
- `ORACLE_CIRCUIT_BREAKER_THRESHOLD` - defaults to `0.10`
- `EXCHANGERATE_API_BASE_URL` - defaults to `https://v6.exchangerate-api.com/v6`
- `EXCHANGERATE_API_KEY`
- `CURRENCY_CENTRAL_BANK_URLS`

### Reserve

- `RESERVE_MIN_RATIO` - defaults to `1.02`
- `RESERVE_TARGET_RATIO` - defaults to `1.05`
- `RESERVE_ALERT_THRESHOLD` - defaults to `1.02`

### Notifications

- `NOTIFICATION_EMAIL_PROVIDER` - defaults to `log`
- `NOTIFICATION_FROM_EMAIL` - defaults to `noreply@acbu.io`
- `SENDGRID_API_KEY`
- `AWS_SES_REGION`
- `NOTIFICATION_SMS_PROVIDER` - defaults to `log`
- `NOTIFICATION_ALERT_EMAIL`
  - Optional. Comma-separated list of email addresses that receive reserve-alert
    emails and the weekly weight-drift audit report
    (`src/jobs/weightDriftAuditJob.ts`, read as `config.notification.alertEmail`).
  - Example: `ops@example.com` or `ops@example.com,admin@example.com`
  - When absent or empty, the audit job still runs and persists the audit
    record — it simply skips sending the email notification.
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `AFRICAS_TALKING_API_KEY`
- `AFRICAS_TALKING_USERNAME`

### Webhooks

- `WEBHOOK_URL`
- `WEBHOOK_SECRET`

### OpenAI

- `OPENAI_API_KEY`
- `OPENAI_ORG_MONTHLY_BUDGET_USD` - defaults to `50`
- `OPENAI_MAX_TOKENS_PER_REQUEST` - defaults to `2000`
- `OPENAI_FAIL_OPEN_ENABLED` - defaults to `false` (fail-closed for security/KYC compliance; set to `true` to fail open during service degradation)
- `OPENAI_FAIL_OPEN_TIMEOUT_MS` - defaults to `2000` (timeout per request attempt in ms)
- `OPENAI_FAIL_OPEN_MAX_RETRIES` - defaults to `2` (retry attempts on transient errors)
- `OPENAI_FAIL_OPEN_RETRY_BASE_MS` - defaults to `500` (exponential backoff base in ms)

### CORS

- `CORS_ORIGIN`
  - Comma-separated list of allowed origins.

## Notes

- In production, `PRISMA_ACCELERATE_URL` is required.
- `DATABASE_URL` should always be a direct PostgreSQL URL for migrations.
- `PRISMA_ACCELERATE_URL` should be used for runtime database queries when set.
- `PRISMA_MIGRATION_HISTORY_REPLICATED=true` confirms promoted replicas retain Prisma migration history.
- If you need the exact runtime schema, refer to `src/config/env.ts`.
