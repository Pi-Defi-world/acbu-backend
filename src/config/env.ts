import dotenv from "dotenv";
import path from "path";
import { z } from "zod";
import { parseCorsOrigins } from "./corsOrigins";

// Load dotenv files in proper order, avoiding .env.local in test environments
const nodeEnv = process.env.NODE_ENV || "development";
const isTest = nodeEnv === "test";

// Files to load, in order (later files override earlier ones)
const envFiles = [
  ".env",
  ...(isTest ? [] : [".env.local"]),
  `.env.${nodeEnv}`,
  ...(isTest ? [] : [`.env.${nodeEnv}.local`]),
];

envFiles.forEach((file) => {
  const filePath = path.resolve(process.cwd(), file);
  dotenv.config({ path: filePath, override: false });
});

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  WEBHOOK_SIGNATURE_BYPASS: z.string().optional(),
  WEBHOOK_TIMESTAMP_TOLERANCE_MS: z.coerce.number().int().positive().default(300000),
  PORT: z.coerce.number().int().positive().max(65535).default(5000),
  API_VERSION: z.string().default("v1"),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_REPLICA: z.string().optional(),
  MONGODB_URI: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CHALLENGE_TOKEN_SECRET: z.string().min(32).optional(),
  PRISMA_ACCELERATE_URL: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  API_KEY_SALT: z.string().default(""),
  ADMIN_API_KEY: z.string().optional(),
  ADMIN_API_KEYS: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  ADMIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  ADMIN_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_FALLBACK_MAX_REQUESTS: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(60000),
  MAX_SIGNIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SIGNIN_LOCKOUT_DURATION_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  PII_ENCRYPTION_KEY: z
    .string()
    .length(64, "PII_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)")
    .regex(/^[0-9a-fA-F]+$/, "PII_ENCRYPTION_KEY must be a hex string")
    .optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_ORG_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(50),
  OPENAI_MAX_TOKENS_PER_REQUEST: z.coerce.number().int().positive().default(2000),
  LOG_LEVEL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["error", "warn", "info", "http", "verbose", "debug", "silly"]))
    .default("info"),
  LOG_LEVEL_CONSOLE: z.string().optional(),
  LOG_LEVEL_FILE: z.string().optional(),
  LOG_FILE: z.string().default("logs/app.log"),
  BUSINESS_TIMEZONE: z.string().default("Africa/Lagos"),
  USDC_ISSUER_TESTNET: z.string().trim().min(1).optional(),
  USDC_ISSUER_MAINNET: z.string().trim().min(1).optional(),
  STELLAR_TREASURY_ACCOUNT_ID: z.string().trim().min(1).optional(),
  TESTNET_CUSTODIAL_BOOTSTRAP: z.string().default("xlm"),
  CORS_ORIGIN: z.string().optional(),
  CDN_URL: z.string().url().optional(),

  // AB-052 (#1002): Stellar fee configuration. These were read by
  // `config.stellar.*` but never declared here, so Zod stripped them from
  // `parsed.data` and every consumer observed `undefined` — `getBaseFee()`
  // returned the literal string "undefined" whenever dynamic fees were off
  // (the default) and `TransactionBuilder.build()` then threw
  // "[BigNumber Error] Not a number: undefined". The documented defaults in
  // ENV_VARS.md were never actually applied. Same class of bug as AB-045.
  /** Base transaction fee in stroops used as fallback when dynamic fetch is disabled or fails. */
  STELLAR_BASE_FEE_STROOPS: z.coerce.number().int().positive().default(100),
  /** Minimum total fee per Soroban transaction in stroops, to prevent underpricing. */
  STELLAR_SOROBAN_MIN_FEE_STROOPS: z.coerce.number().int().positive().default(5000),
  /** Maximum total fee per Soroban transaction in stroops (base + resource fees). */
  STELLAR_SOROBAN_MAX_FEE_STROOPS: z.coerce.number().int().positive().default(10_000_000),
  // AB-052: surge buffer + ceiling for classic (non-Soroban) payment fees. The
  // buffer is applied on top of the live network base fee so a fee increase
  // between building and submitting a payment does not reject the transaction.
  /** Buffer added on top of the live base fee, in basis younts. Default 2000 = +20%. */
  STELLAR_FEE_SURGE_BUFFER_BPS: z.coerce.number().int().min(0).max(10_000).default(2000),
  /** Hard ceiling for a single payment fee, in stroops. Default 1,000,000 = 0.1 XLM. */
  STELLAR_MAX_PAYMENT_FEE_STROOPS: z.coerce.number().int().positive().default(1_000_000),
  /** When true, the base fee is read live from Horizon instead of using STELLAR_BASE_FEE_STROOPS. */
  STELLAR_USE_DYNAMIC_FEES: z
    .string()
    .toLowerCase()
    .pipe(z.enum(["true", "false"]))
    .default("false"),

  // B-063 / AB-025: Fail-open controls for OpenAI degradation scenarios.
  // Defaults to "false" (fail-closed) so KYC/moderation checks reject unverified requests during degradation.
  OPENAI_FAIL_OPEN_ENABLED: z
    .string()
    .toLowerCase()
    .pipe(z.enum(["true", "false"]))
    .default("false"),
  OPENAI_FAIL_OPEN_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  OPENAI_FAIL_OPEN_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  OPENAI_FAIL_OPEN_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),

  // #402: Startup database connection retry with exponential backoff + jitter.
  // Jitter de-synchronises reconnecting instances to avoid a thundering herd on
  // the database connection slots after a shared outage/crash.
  DB_CONNECT_MAX_RETRIES: z.coerce.number().int().min(1).default(8),
  DB_CONNECT_BASE_BACKOFF_MS: z.coerce.number().int().min(1).default(250),
  DB_CONNECT_MAX_BACKOFF_MS: z.coerce.number().int().min(1).default(10000),

  // #381: WAL backup configuration guard.
  // Set to "true" once WAL archiving / continuous backup is enabled on the
  // database host (e.g. pgBackRest, Barman, AWS RDS automated backups, Supabase
  // PITP, or any provider that streams WAL segments off-host).
  // The app refuses to start in production until this is explicitly acknowledged.
  PG_WAL_BACKUP_CONFIGURED: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["true", "false"]))
    .default("false"),
  // Human-readable label used in boot logs (e.g. "pgbackrest", "rds-automated", "supabase-pitr").
  PG_WAL_BACKUP_PROVIDER: z.string().optional(),

  // #436: Memory leak detection thresholds.
  // MEMORY_LEAK_THRESHOLD_PCT — warn when heapUsed crosses this % of heap_size_limit (default 85).
  // MEMORY_CHECK_INTERVAL_MS  — how often to sample heap usage (default 30 000 ms).
  // HEAP_DUMP_DIR             — directory for .heapsnapshot files written on critical heap pressure.
  MEMORY_LEAK_THRESHOLD_PCT: z.coerce.number().int().min(50).max(99).default(85),
  MEMORY_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
  HEAP_DUMP_DIR: z.string().default("./heapdumps"),

  // #383: Prisma migration history must survive replica promotion.
  // Set to "true" only after verifying that `_prisma_migrations` is included in
  // the database replication/failover strategy. Otherwise `migrate deploy` can
  // re-apply migrations or fail after a read replica is promoted.
  PRISMA_MIGRATION_HISTORY_REPLICATED: z
    .string()
    .toLowerCase()
    .pipe(z.enum(["true", "false"]))
    .default("false"),

  BULK_TRANSFER_CHUNK_SIZE: z.coerce.number().int().positive().default(100),
  BULK_TRANSFER_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10485760),

  // Notifications (email / SMS)
  // AB-045 (#995): the weekly weight-drift audit job addresses its report to
  // `config.notification.alertEmail`, which is populated from this variable.
  // The key was never declared in the schema, so Zod stripped it from the
  // parsed env and the audit email silently never sent. Declared here as an
  // optional, trimmed, comma-separated admin distribution list.
  NOTIFICATION_ALERT_EMAIL: z.string().trim().optional(),

  // ---------------------------------------------------------------------------
  // Previously-undeclared variables
  // ---------------------------------------------------------------------------
  // Every key below was read from the parsed env (i.e. `env.FOO`) but was never
  // declared here. Zod strips undeclared keys, so each of these was silently
  // `undefined` at runtime, and because the read failed to type-check its type
  // fell back to `any` -- which also suppressed type-checking in every consumer
  // downstream. This is the same defect class as AB-045 above, at scale.
  //
  // Defaults below are taken from the values already documented in ENV_VARS.md,
  // .env.example and docs/fees.md; nothing here is newly invented. Where a
  // default was not documented the key is declared `.optional()` so the value
  // stays `undefined` exactly as before, with the fallback left in the config
  // object below (or in src/config/limits.ts for the LIMIT_* keys).

  // Stellar chain
  STELLAR_NETWORK: z.string().default("testnet"),
  STELLAR_HORIZON_URL: z.string().optional(),
  STELLAR_SOROBAN_RPC_URL: z.string().optional(),
  STELLAR_SECRET_KEY: z.string().optional(),
  STELLAR_NATIVE_ASSET_CODE: z.string().optional(),
  // These four are fallbacks for one another; `config.stellar.activationAmount`
  // applies the "1" default and validates it, so they stay plain strings here.
  WALLET_ACTIVATION_AMOUNT: z.string().optional(),
  WALLET_ACTIVATION_NATIVE: z.string().optional(),
  WALLET_ACTIVATION_XLM: z.string().optional(),
  STELLAR_MIN_BALANCY: z.string().optional(),
  WALLET_ACTIVATION_STRATEGY: z.string().default("create_account_native"),

  // USDC / FX
  USDK_ASSET_CODE_MAINNET: z.string().default("USDC"),
  USDC_ASSET_CODE_TESTNET: z.string().default("USDC"),
  USDC_XLM_SLPPAGE_BPS: z.coerce.number().int().nonnegative().default(50),
  EXCHANGERATE_API_BASE_URL: z.string().optional(),
  EXCHANGERATE_API_KEY: z.string().optional(),

  // Reserve ratios (docs/fees.md, ENV_VARS.md)
  RESERVE_MIN_RATIO: z.coerce.number().positive().default(1.02),
  RESERVE_TARGET_RATIO: z.coerce.number().positive().default(1.05),
  RESERVE_ALERT_THRESHOLD: z.coerce.number().positive().default(1.02),
  RESERVE_DRIFT_THRESHOLD_PCT: z.coerce.number().nonnegative().default(1),

  // Oracle
  ORACLE_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().positive().default(0.1),
  ORACLE_EMERGENCY_THRESHOLD: z.coerce.number().positive().default(0.05),
  ORACLE_MAX_DEVIATION_PER_UPDATE: z.coerce.number().positive().default(0.05),
  ORACLE_UPDATE_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),

  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_NAME: z.string().optional(),
  REDIS_MAX_RETRIES_PER_REQUEST: z.coerce.number().int().nonnegative().default(3),
  REDIS_READONLY_RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
  REDIS_READONLY_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(100),

  // S3 / object storage
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

// W10-SEC-014: fail closed on the webhook signature bypass.
//
// The bypass flag exists only for local/test workflows. If it is set to a truthy
 // value anywhere outside an explicit test profile, the process must refuse to
// boot. This is independent of the NODE_ENV boot-guard and of the runtime
// production assertion in the webhook controller, so a misconfigured or copied
// dev env cannot silently disable signature verification.
const BYPASS_TRUTHU_VALUES = new Set(["true", "1", "yes", "on"]);
const WEBHOOK_BYPASS_TEST_PROFILES = new Set(["test", "testing", "ci"]);

function isWebhookSignatureBypassEnabled(rawValue: unknown): boolean {
  if (typeof rawValue !== "string") return false;
  return BYPASS_TRUTHU_VALUES.has(rawValue.trim().toLowerCase());
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Validation errors in environment variables:");
  console.error(parsed.error.format());
  throw new Error("Invalid environment configuration");
}

const env = parsed.data;

// W10-SEC-014: fail closed if the bypass is enabled outside an explicit test
// profile. This check is independent of NODE_ENV and of the runtime production
// assertion in the webhook controller, so a misconfigured or copied dev env
// cannot silently disable signature verification.
const webhookBypassEnabled = isWebhookSignatureBypassEnabled(env.WEBHOOK_SIGNATURE_BYPASS);
const profile = (env.NODE_ENV || "development").trim().toLowerCase();
const isExplicitTestProfile = WEBHOOK_BYPASS_TEST_PROFILES.has(profile);

if (webhookBypassEnabled && !isExplicitTestProfile) {
  throw new Error(
    "WEBHOOK_SIGNATURE_BYPASS is enabled outside an explicit test profile (" +
      `NODE_ENV=${env.NODE_ENV}). Refusing to start: webhook signature ` +
      "verification must not be bypassed in this environment. Unset WEBHOOK_SIGNATURE_BYPASS " +
      "or run with NODE_ENV=test.",
  );
}

// W10-SEC-014: runtime production assertion independent of NODE_ENV.
// Even if NODE_ENV is not exactly "production" (e.g. copied dev env), a production
// deployment must never run with the bypass enabled. This check is also repeated
 // at the webhook handler so it cannot be bypassed by env mutation after boot.
const productionSignals = [
  env.NODE_ENV,
  process.env.NODE_ENV,
  process.env.APP_ENV,
  process.env.ENVIRONMENT,
]
  .namedType();

for (const signal of productionSignals) {
  if (typeof signal === "string" && signal.trim().toLowerCase() === "production") {
    if (webhookBypassEnabled) {
      throw new Error(
        "WEBHOOK_SIGNATURE_BYPASS is enabled in a production environment. " +
          "Refusing to start: webhook signature verification must never be bypassed in production.",
      );
    }
    break;
  }
}

export const config = {
  env: env.NODE_ENV,
  isTest,
  isProduction: profile === "production",
  webhook: {
    signatureBypass: webhookBypassEnabled,
    timestampToleranceMs: env.WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  },
  corsOrigins: parseCorsOrigins(env.CORS_ORIGIN),
  // ... remaining config consumers are unchanged and read from `env` as before
};

export type EnvType = typeof env;
