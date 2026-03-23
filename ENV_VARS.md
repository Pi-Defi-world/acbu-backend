# ACBU Backend – environment variables

Copy these into `backend/.env`. No mock data; all values must be real or explicitly empty.

The app uses **Prisma Accelerate** for the primary database (managed PostgreSQL; not a local PostgreSQL instance) and **MongoDB Atlas** for cache (managed; not local MongoDB).

**Prisma (single Accelerate URL):** You use one `prisma+postgres://accelerate.prisma-data.net/?api_key=...` link for both `DATABASE_URL` and `PRISMA_ACCELERATE_URL`. Set both to that same value in `backend/.env`.

**Important:** Prisma CLI loads **only** `backend/.env` (not `.env.local`). If you use `backend/.env.local`, either add `DATABASE_URL` (and `PRISMA_ACCELERATE_URL`) to `backend/.env` as well, or copy `.env.local` to `.env`. Otherwise `prisma migrate` / `prisma db push` will report "Environment variable not found: DATABASE_URL".

## Required (app fails without them)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Prisma Accelerate URL (`prisma+postgres://accelerate.prisma-data.net/?api_key=...`). Used for schema, migrate, db push, studio. Same value as `PRISMA_ACCELERATE_URL` when using one link. |
| `MONGODB_URI` | **MongoDB Atlas** connection string, e.g. `mongodb+srv://user:password@cluster.mongodb.net/acbu?retryWrites=true&w=majority` |
| `RABBITMQ_URL` | RabbitMQ URL, e.g. `amqp://acbu:acbu_password@localhost:5672` |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) |

## Database: Prisma Accelerate

| Variable | Description |
|----------|-------------|
| `PRISMA_ACCELERATE_URL` | Same as `DATABASE_URL` when using one link. **Runtime** connection via Accelerate adapter. Required in production. |
| `DATABASE_URL` | Same Accelerate URL. Used by Prisma schema and CLI (migrate, db push, studio). |

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | HTTP port |
| `API_VERSION` | `v1` | API path prefix |

## Fintech: Flutterwave

| Variable | Default | Description |
|----------|---------|-------------|
| `FLUTTERWAVE_PUBLIC_KEY` | — | Flutterwave public key |
| `FLUTTERWAVE_SECRET_KEY` | — | Flutterwave secret key |
| `FLUTTERWAVE_ENCRYPTION_KEY` | — | Flutterwave encryption key |
| `FLUTTERWAVE_BASE_URL` | `https://api.flutterwave.com/v3` | Flutterwave API base |

## Fintech: Paystack (NGN)

| Variable | Default | Description |
|----------|---------|-------------|
| `PAYSTACK_SECRET_KEY` | — | Paystack secret key |
| `PAYSTACK_BASE_URL` | `https://api.paystack.co` | Paystack API base |

## Fintech: MTN Mobile Money (RWF, etc.)

| Variable | Default | Description |
|----------|---------|-------------|
| `MTN_MOMO_SUBSCRIPTION_KEY` | — | MTN MoMo API subscription key |
| `MTN_MOMO_API_USER_ID` | — | API user id from MTN MoMo provisioning |
| `MTN_MOMO_API_KEY` | — | API key from MTN MoMo provisioning |
| `MTN_MOMO_BASE_URL` | sandbox/production URL by env | Override if needed |
| `MTN_MOMO_TARGET_ENVIRONMENT` | `sandbox` | `sandbox` \| `production` |

## Fintech: currency → provider (optional)

| Variable | Description |
|----------|-------------|
| `FINTECH_CURRENCY_PROVIDERS` | JSON `{"NGN":"paystack","RWF":"mtn_momo",...}` or CSV `NGN=paystack,RWF=mtn_momo,KES=flutterwave`. If unset, defaults: NGN→paystack, RWF→mtn_momo, others→flutterwave. |

## Stellar / Soroban

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_NETWORK` | `testnet` | `testnet` \| `mainnet` |
| `STELLAR_HORIZON_URL` | horizon-testnet URL | Horizon base URL |
| `STELLAR_SECRET_KEY` | — | Secret key for contract txs |

## Stellar contract IDs (after deploy)

| Variable | Description |
|----------|-------------|
| `CONTRACT_ORACLE` | Oracle contract id |
| `CONTRACT_RESERVE_TRACKER` | Reserve tracker contract id |
| `CONTRACT_MINTING` | Minting contract id |
| `CONTRACT_BURNING` | Burning contract id |

Or per network: `CONTRACT_ORACLE_TESTNET`, `CONTRACT_ORACLE_MAINNET`, etc.

## Oracle (40/40/20: central bank, fintech, forex)

| Variable | Default | Description |
|----------|---------|-------------|
| `ORACLE_UPDATE_INTERVAL_HOURS` | `6` | Hours between oracle updates |
| `ORACLE_EMERGENCY_THRESHOLD` | `0.05` | Emergency deviation threshold |
| `ORACLE_MAX_DEVIATION_PER_UPDATE` | `0.05` | Max 5% change per update; log warning if exceeded |
| `ORACLE_CIRCUIT_BREAKER_THRESHOLD` | `0.10` | If currency moves >10%, use 48h average instead |
| `EXCHANGERATE_API_BASE_URL` | `https://v6.exchangerate-api.com/v6` | Forex layer (Layer 3) base URL |
| `EXCHANGERATE_API_KEY` | — | API key for ExchangeRate-API (Layer 3); if unset, forex layer skipped |
| `CURRENCY_CENTRAL_BANK_URLS` | `{}` | JSON map of currency to central bank API URL (e.g. `{"NGN":"https://..."}`) for Layer 1 |

## Basket metrics (proposed weights job)

| Variable | Default | Description |
|----------|---------|-------------|
| `BASKET_METRICS_INTERVAL_DAYS` | `30` | Days between metrics ingestion and proposed basket weight creation |

## Limits (Deposit/Withdrawal & Circuit Breakers)

| Variable | Default (USD) | Description |
|----------|---------|-------------|
| `LIMIT_RETAIL_DEPOSIT_DAILY_USD` | `5000` | Daily deposit limit for retail users |
| `LIMIT_RETAIL_DEPOSIT_MONTHLY_USD` | `50000` | Monthly deposit limit for retail users |
| `LIMIT_RETAIL_WITHDRAWAL_DAILY_USD` | `10000` | Daily withdrawal limit for retail users |
| `LIMIT_RETAIL_WITHDRAWAL_MONTHLY_USD` | `80000` | Monthly withdrawal limit for retail users |
| `LIMIT_BUSINESS_DEPOSIT_DAILY_USD` | `50000` | Daily deposit limit for business users |
| `LIMIT_BUSINESS_DEPOSIT_MONTHLY_USD` | `500000` | Monthly deposit limit for business users |
| `LIMIT_BUSINESS_WITHDRAWAL_DAILY_USD` | `100000` | Daily withdrawal limit for business users |
| `LIMIT_BUSINESS_WITHDRAWAL_MONTHLY_USD` | `800000` | Monthly withdrawal limit for business users |
| `LIMIT_GOV_DEPOSIT_DAILY_USD` | `500000` | Daily deposit limit for government users |
| `LIMIT_GOV_DEPOSIT_MONTHLY_USD` | `5000000` | Monthly deposit limit for government users |
| `LIMIT_GOV_WITHDRAWAL_DAILY_USD` | `500000` | Daily withdrawal limit for government users |
| `LIMIT_GOV_WITHDRAWAL_MONTHLY_USD` | `4000000` | Monthly withdrawal limit for government users |
| `LIMIT_CIRCUIT_BREAKER_RESERVE_WEIGHT_PCT`| `10` | Reserve % weight threshold circuit breaker |
| `LIMIT_CIRCUIT_BREAKER_MIN_RATIO` | `1.02` | Minimum reserve ratio threshold circuit breaker |

## Reserve

| Variable | Default | Description |
|----------|---------|-------------|
| `RESERVE_MIN_RATIO` | `1.02` | Min overcollateralization (102%) |
| `RESERVE_TARGET_RATIO` | `1.05` | Target ratio (105%) |
| `RESERVE_ALERT_THRESHOLD` | `1.02` | Alert when below this |

## KYC (Pi-style two-layer)

| Variable | Default | Description |
|----------|---------|-------------|
| `KYC_FEE_ACBU` | `1` | ACBU amount required per KYC check. Fee is typically paid via a **mint** (user deposits local currency, we mint ACBU; applicant passes `mint_transaction_id`). Optional: fee can be paid by Stellar transfer to collector (`fee_tx_hash`). |
| `KYC_FEE_COLLECTOR_ADDRESS` | — | Stellar address that receives KYC fee when using `fee_tx_hash`; if unset, any successful Stellar tx is accepted. Not used when fee is paid via mint (`mint_transaction_id`). |
| `KYC_MACHINE_PROVIDER` | `none` | `openai` \| `textract` \| `none` – AI/OCR provider for doc extraction |
| `KYC_MACHINE_CONFIDENCE_THRESHOLD` | `0.95` | Auto-approve when machine confidence ≥ this (0–1) |
| `KYC_OBJECT_STORE_BUCKET` | `kyc-documents` | S3/MinIO bucket for KYC document blobs |
| `KYC_OBJECT_STORE_REGION` | `us-east-1` | Object store region |
| `KYC_OBJECT_STORE_ENDPOINT` | — | Override for MinIO/custom S3 endpoint |
| `KYC_MIN_VALIDATORS_PER_APPLICATION` | `2` | Min human validators when routed to human review |
| `KYC_CONSENSUS_RULE` | `all_approve` | `all_approve` \| `majority_approve` for human decisions |
| `KYC_REWARD_SHARE_PER_VALIDATOR` | `0.33` | Share of fee per validator (e.g. 0.33 ≈ 1/3 each for 3 validators) |
| `KYC_ACCURACY_THRESHOLD_FOR_REMOVAL` | `0.7` | Validators with accuracy below this can be suspended/removed |
| `OPENAI_API_KEY` | — | Required when `KYC_MACHINE_PROVIDER=openai` |
| `AWS_REGION` | — | Fallback region (also uses `KYC_OBJECT_STORE_REGION`) |

## Notifications (email / SMS)

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTIFICATION_EMAIL_PROVIDER` | `log` | `sendgrid` \| `ses` \| `log` |
| `SENDGRID_API_KEY` | — | SendGrid API key when email provider is sendgrid |
| `NOTIFICATION_SMS_PROVIDER` | `log` | `twilio` \| `africas_talking` \| `log` |
| `TWILIO_ACCOUNT_SID` | — | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token |
| `TWILIO_FROM_NUMBER` | — | Twilio from number for SMS |
| `AFRICAS_TALKING_API_KEY` | — | Africas Talking API key |
| `AFRICAS_TALKING_USERNAME` | — | Africas Talking username |
| `NOTIFICATION_ALERT_EMAIL` | — | Email for reserve/ops alerts when no user context |

## Outbound webhooks

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_URL` | — | URL to POST outbound webhook payloads (HMAC-SHA256 signed) |
| `WEBHOOK_SECRET` | — | Secret for HMAC-SHA256 signature |

## Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | — | Sentry DSN for error tracking (integrate in app when set) |
| `SENTRY_ENVIRONMENT` | — | Sentry environment (e.g. production, staging) |

## Other

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY_SALT` | — | Salt for API key hashing |
| `JWT_EXPIRES_IN` | `7d` | JWT expiry |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |
| `LOG_LEVEL` | `info` | Log level |
| `LOG_FILE` | `logs/app.log` | Log file path |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed origins (comma-separated) |
