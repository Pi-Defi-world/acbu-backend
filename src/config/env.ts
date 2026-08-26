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
  CORS_ORIGIN: z.string().optional(),
  CDN_URL: z.string().url().optional(),

  // B-063: Fail-open controls for OpenAI degradation scenarios.
  OPENAI_FAIL_OPEN_ENABLED: z.string().default("true"),
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
  // PITR, or any provider that streams WAL segments off-host).
  // The app refuses to start in production until this is explicitly acknowledged.
  PG_WAL_BACKUP_CONFIGURED: z
    .string()
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${messages}`);
}

const isJestTest =
  typeof (globalThis as any).jest !== "undefined" ||
  process.env.JEST_WORKER_ID !== undefined;

if (parsed.data.NODE_ENV === "production" && !isJestTest && !parsed.data.PRISMA_ACCELERATE_URL) {
  throw new Error("Missing required environment variable: PRISMA_ACCELERATE_URL");
}

// #630: JWT_SECRET must not be the documented .env.example placeholder in production.
const JWT_SECRET_EXAMPLE_VALUES = ["dev-jwt-secret-change-me", "change-me-in-production"];
if (
  parsed.data.NODE_ENV === "production" &&
  !isJestTest &&
  JWT_SECRET_EXAMPLE_VALUES.includes(parsed.data.JWT_SECRET)
) {
  throw new Error(
    "JWT_SECRET is set to a documented example/placeholder value — generate a unique secret before deploying to production.",
  );
}

// #632: CHALLENGE_TOKEN_SECRET must be explicit in production so a leaked
// JWT_SECRET does not also compromise the 2FA challenge-token trust boundary.
if (parsed.data.NODE_ENV === "production" && !isJestTest && !parsed.data.CHALLENGE_TOKEN_SECRET) {
  throw new Error(
    "Missing required environment variable: CHALLENGE_TOKEN_SECRET (must be set explicitly in production, distinct from JWT_SECRET)",
  );
}

// #632: CHALLENGE_TOKEN_SECRET and JWT_SECRET must be distinct in production
if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.CHALLENGE_TOKEN_SECRET === parsed.data.JWT_SECRET
) {
  throw new Error(
    "CHALLENGE_TOKEN_SECRET must be distinct from JWT_SECRET in production to maintain 2FA trust boundary",
  );
}

// #751: USDC issuers required in production only — relaxed for local dev/test so .env.local boots without them
if (parsed.data.NODE_ENV === "production" && !isJestTest && !parsed.data.USDC_ISSUER_TESTNET) {
  throw new Error("Missing required environment variable: USDC_ISSUER_TESTNET");
}
if (parsed.data.NODE_ENV === "production" && !isJestTest && !parsed.data.USDC_ISSUER_MAINNET) {
  throw new Error("Missing required environment variable: USDC_ISSUER_MAINNET");
}

const s3ScanWebhookSecret = process.env.S3_SCAN_WEBHOOK_SECRET?.trim() || "change-me-in-production";

if (parsed.data.NODE_ENV === "production" && !isJestTest && s3ScanWebhookSecret === "change-me-in-production") {
  throw new Error("Missing required environment variable: S3_SCAN_WEBHOOK_SECRET");
}
// #382: Fintech partner keys must never be absent in production — an empty
// Authorization header would be silently accepted by axios and only fail at
// the first live API call, making the error hard to trace.  Fail at boot
// instead so a misconfigured deployment is caught before it reaches traffic.
if (parsed.data.NODE_ENV === "production" && !isJestTest) {
  const missingFintechKeys: string[] = [];
  if (!process.env.FLUTTERWAVE_SECRET_KEY) missingFintechKeys.push("FLUTTERWAVE_SECRET_KEY");
  if (!process.env.FLUTTERWAVE_WEBHOOK_SECRET)
    missingFintechKeys.push("FLUTTERWAVE_WEBHOOK_SECRET");
  if (!process.env.PAYSTACK_SECRET_KEY) missingFintechKeys.push("PAYSTACK_SECRET_KEY");
  if (!process.env.BILLS_WEBHOOK_SECRET) missingFintechKeys.push("BILLS_WEBHOOK_SECRET");
  if (missingFintechKeys.length > 0) {
    throw new Error(
      `Missing or placeholder required fintech API keys in production: ${invalidFintechKeys.join(", ")}. ` +
        "Inject valid API keys via environment variables — never commit them to source control. " +
        "Rotate any key that may have been exposed before redeploying.",
    );
  }
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  apiVersion: env.API_VERSION,
  databaseUrl: env.DATABASE_URL,
  databaseUrlReplica: env.DATABASE_URL_REPLICA,
  prismaAccelerateUrl: env.PRISMA_ACCELERATE_URL,
  mongodbUri: env.MONGODB_URI,
  rabbitmqUrl: env.RABBITMQ_URL,
  jwtSecret: env.JWT_SECRET,
  challengeTokenSecret: env.CHALLENGE_TOKEN_SECRET || env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  jwtClockToleranceSeconds: env.JWT_CLOCK_TOLERANCE_SECONDS,
  apiKeySalt: env.API_KEY_SALT,
  adminApiKey: env.ADMIN_API_KEY,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  authRateLimitWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  authRateLimitMaxRequests: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
  adminRateLimitWindowMs: env.ADMIN_RATE_LIMIT_WINDOW_MS,
  adminRateLimitMaxRequests: env.ADMIN_RATE_LIMIT_MAX_REQUESTS,
  maxSigninAttempts: env.MAX_SIGNIN_ATTEMPTS,
  signinLockoutDurationMs: env.SIGNIN_LOCKOUT_DURATION_MS,

  // Rate Limiting Fallback (during cache outages)
  rateLimitFallbackMaxRequests: env.RATE_LIMIT_FALLBACK_MAX_REQUESTS,
  rateLimitCircuitBreakerThreshold: env.RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD,
  rateLimitCircuitBreakerCooldownMs: env.RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN_MS,

  // Redis cache (Sentinel / standalone)
  redis: {
    url: env.REDIS_URL?.trim() || undefined,
    sentinels: (() => {
      const raw = env.REDIS_SENTINELS || "";
      if (!raw) return [];
      return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [host, port] = entry.split(":");
          return {
            host,
            port: parseInt(port || "26379", 10),
          };
        });
    })(),
    sentinelName: env.REDIS_SENTINEL_NAME,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: env.REDIS_MAX_RETRIES_PER_REQUEST,
    readonlyRetryAttempts: env.REDIS_READONLY_RETRY_ATTEMPTS,
    readonlyRetryDelayMs: env.REDIS_READONLY_RETRY_DELAY_MS,
  },

  // Logging
  logLevel: env.LOG_LEVEL,
  // Per-transport levels keep debug noise out of production aggregators (#398).
  logConsoleLevel:
    env.LOG_LEVEL_CONSOLE ?? (env.NODE_ENV === "production" ? "info" : env.LOG_LEVEL),
  logFileLevel: env.LOG_LEVEL_FILE ?? (env.NODE_ENV === "production" ? "info" : env.LOG_LEVEL),
  logFile: env.LOG_FILE,

  // Business calendar timezone for salary runs and withdrawal windows (#408)
  businessTimeZone: env.BUSINESS_TIMEZONE,

  // Fintech APIs
  flutterwave: {
    publicKey: isPlaceholderKey(env.FLUTTERWAVE_PUBLIC_KEY)
      ? ""
      : env.FLUTTERWAVE_PUBLIC_KEY!.trim(),
    secretKey: isPlaceholderKey(env.FLUTTERWAVE_SECRET_KEY)
      ? ""
      : env.FLUTTERWAVE_SECRET_KEY!.trim(),
    encryptionKey: isPlaceholderKey(env.FLUTTERWAVE_ENCRYPTION_KEY)
      ? ""
      : env.FLUTTERWAVE_ENCRYPTION_KEY!.trim(),
    webhookSecret: isPlaceholderKey(env.FLUTTERWAVE_WEBHOOK_SECRET)
      ? ""
      : env.FLUTTERWAVE_WEBHOOK_SECRET!.trim(),
    baseUrl: env.FLUTTERWAVE_BASE_URL,
  },
  paystack: {
    secretKey: isPlaceholderKey(env.PAYSTACK_SECRET_KEY) ? "" : env.PAYSTACK_SECRET_KEY!.trim(),
    baseUrl: env.PAYSTACK_BASE_URL,
  },
  // BE-001: HMAC secret for /v1/webhooks/bills/:provider signature verification.
  bills: {
    webhookSecret: isPlaceholderKey(env.BILLS_WEBHOOK_SECRET)
      ? ""
      : env.BILLS_WEBHOOK_SECRET!.trim(),
  },
  mtnMomo: {
    subscriptionKey: isPlaceholderKey(env.MTN_MOMO_SUBSCRIPTION_KEY)
      ? ""
      : env.MTN_MOMO_SUBSCRIPTION_KEY!.trim(),
    apiUserId: isPlaceholderKey(env.MTN_MOMO_API_USER_ID) ? "" : env.MTN_MOMO_API_USER_ID!.trim(),
    apiKey: isPlaceholderKey(env.MTN_MOMO_API_KEY) ? "" : env.MTN_MOMO_API_KEY!.trim(),
    baseUrl:
      env.MTN_MOMO_BASE_URL ||
      (env.MTN_MOMO_TARGET_ENVIRONMENT === "production"
        ? "https://momodeveloper.mtn.com"
        : "https://sandbox.momodeveloper.mtn.com"),
    targetEnvironment: env.MTN_MOMO_TARGET_ENVIRONMENT,
  },
  s3: {
    region: env.AWS_REGION || env.S3_REGION || "us-east-1",
    bucket: env.S3_BUCKET?.trim() || undefined,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY,
    uploadUrlTtlSeconds: env.S3_UPLOAD_URL_TTL_SECONDS,
    downloadUrlTtlSeconds: env.S3_DOWNLOAD_URL_TTL_SECONDS,
    scanWebhookSecret: env.S3_SCAN_WEBHOOK_SECRET,
  },
  fintech: {
    currencyProviders: ((): Record<string, string> => {
      const raw = env.FINTECH_CURRENCY_PROVIDERS;
      if (raw) {
        try {
          if (raw.startsWith("{")) return JSON.parse(raw) as Record<string, string>;
          return Object.fromEntries(
            raw.split(",").map((p) => {
              const [k, v] = p.split("=").map((s) => s.trim());
              return [k, v];
            }),
          );
        } catch {
          /* ignore */
        }
      }
      return {
        NGN: "paystack",
        KES: "flutterwave",
        RWF: "mtn_momo",
        ZAR: "flutterwave",
        GHS: "flutterwave",
        EGP: "flutterwave",
        MAD: "flutterwave",
        TZS: "flutterwave",
        UGX: "flutterwave",
        XOF: "flutterwave",
      };
    })(),
  },

  // Stellar
  stellar: {
    network: env.STELLAR_NETWORK,
    horizonUrl: env.STELLAR_HORIZON_URL,
    /** Soroban RPC (simulate + send). Override if default host fails DNS (e.g. use SDF friendbot list / custom RPC). */
    sorobanRpcUrl: ((): string => {
      const explicit = env.STELLAR_SOROBAN_RPC_URL?.trim();
      if (explicit) return explicit;
      return env.STELLAR_NETWORK === "mainnet"
        ? "https://soroban-mainnet.stellar.org"
        : "https://soroban-testnet.stellar.org";
    })(),
    secretKey: env.STELLAR_SECRET_KEY,
    networkPassphrase:
      env.STELLAR_NETWORK === "mainnet"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015",
    /** Network-native asset code shown to callers for wallet bootstrap (default XLM, or PI when bootstrap profile says so). */
    nativeAssetCode: ((): string => {
      const explicit = env.STELLAR_NATIVE_ASSET_CODE?.trim();
      if (explicit) return explicit.toUpperCase();
      const bootstrapProfile = env.TESTNET_CUSTODIAL_BOOTSTRAP.trim().toLowerCase();
      return bootstrapProfile.includes("pi") ? "PI" : "XLM";
    })(),
    /** Wallet activation strategy. Default keeps the current create-account path, but makes it explicit/configurable. */
    activationStrategy: env.WALLET_ACTIVATION_STRATEGY,
    /** Optional bootstrap profile from deployment docs/runbooks; used only for config alignment and diagnostics. */
    bootstrapProfile: env.TESTNET_CUSTODIAL_BOOTSTRAP,
    /** Minimum network-native balance sent to user wallet for activation. */
    activationAmount: ((): string => {
      const raw =
        env.WALLET_ACTIVATION_AMOUNT ||
        env.WALLET_ACTIVATION_NATIVE ||
        env.WALLET_ACTIVATION_XLM ||
        env.STELLAR_MIN_BALANCE ||
        "1";
      return raw.trim() || "1";
    })(),
    /** Backwards-compatible numeric alias for older callers/tests that still reference minBalanceXlm. */
    minBalanceXlm: (() => {
      const parsed = Number.parseFloat(
        env.WALLET_ACTIVATION_AMOUNT ||
          env.WALLET_ACTIVATION_NATIVE ||
          env.WALLET_ACTIVATION_XLM ||
          env.STELLAR_MIN_BALANCE ||
          "1",
      );
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    })(),
    /** Base transaction fee in stroops used as fallback when dynamic fee fetch is disabled or fails. Default 100. */
    baseFeeStroops: env.STELLAR_BASE_FEE_STROOPS,
    /** When true, fetches the current recommended base fee from Horizon before each transaction. Falls back to baseFeeStroops on failure. */
    useDynamicFees: env.STELLAR_USE_DYNAMIC_FEES === "true",
    /** Maximum total fee per Soroban transaction in stroops (base + resource fees). Default 10M stroops (~50 XLM at base fee 100). */
    sorobanMaxFeeStroops: env.STELLAR_SOROBAN_MAX_FEE_STROOPS,
    /** Minimum total fee per Soroban transaction in stroops to prevent underpricing. Default 5000 stroops. */
    sorobanMinFeeStroops: env.STELLAR_SOROBAN_MIN_FEE_STROOPS,
    /** Circle USDC issuer on Stellar testnet, configured via the environment. */
    usdcIssuerTestnet: env.USDC_ISSUER_TESTNET,
    /** Circle USDC issuer on Stellar mainnet, configured via the environment. */
    usdcIssuerMainnet: env.USDC_ISSUER_MAINNET,
    /** Stellar asset code for the USDC-like swap asset on testnet (4–12 alphanumeric). Default `USDC`. */
    usdcAssetCodeTestnet: env.USDC_ASSET_CODE_TESTNET,
    /** Stellar asset code for the USDC-like swap asset on mainnet. Default `USDC`. */
    usdcAssetCodeMainnet: env.USDC_ASSET_CODE_MAINNET,
    /** Slippage tolerance for the USDC→XLM DEX swap in basis points. Default 50 = 0.5%. */
    usdcXlmSlippageBps: env.USDC_XLM_SLIPPAGE_BPS,
  },

  // Bulk Transfer (#441)
  bulkTransfer: {
    chunkSize: env.BULK_TRANSFER_CHUNK_SIZE,
    maxFileSizeBytes: env.BULK_TRANSFER_MAX_FILE_SIZE_BYTES,
  },

  // Smart Contracts
  contracts: {
    oracle: env.CONTRACT_ORACLE || "",
    reserveTracker: env.CONTRACT_RESERVE_TRACKER || "",
    minting: env.CONTRACT_MINTING || "",
    burning: env.CONTRACT_BURNING || "",
    savingsVault: env.CONTRACT_SAVINGS_VAULT || "",
    lendingPool: env.CONTRACT_LENDING_POOL || "",
    escrow: env.CONTRACT_ESCROW || "",
  },

  // Bulk transfer CSV upload processing
  bulkTransfer: {
    /** Rows per transaction chunk. Default 100. */
    chunkSize: parseInt(process.env.BULK_TRANSFER_CHUNK_SIZE || "100", 10),
    /** Upload size limit in bytes. Default 10485760 (10 MiB). */
    maxFileSizeBytes: parseInt(process.env.BULK_TRANSFER_MAX_FILE_SIZE_BYTES || "10485760", 10),
  },

  // Oracle (40/40/20: central bank, fintech, forex)
  oracle: {
    updateIntervalHours: env.ORACLE_UPDATE_INTERVAL_HOURS,
    emergencyThreshold: env.ORACLE_EMERGENCY_THRESHOLD,
    maxDeviationPerUpdate: env.ORACLE_MAX_DEVIATION_PER_UPDATE,
    circuitBreakerThreshold: env.ORACLE_CIRCUIT_BREAKER_THRESHOLD,
    forex: {
      baseUrl: env.EXCHANGERATE_API_BASE_URL,
      apiKey: env.EXCHANGERATE_API_KEY,
    },
    centralBankUrls: ((): Record<string, string> => {
      const raw = env.CURRENCY_CENTRAL_BANK_URLS;
      if (raw) {
        try {
          return JSON.parse(raw) as Record<string, string>;
        } catch {
          /* ignore */
        }
      }
      return {};
    })(),
  },

  // Reserve
  reserve: {
    minRatio: env.RESERVE_MIN_RATIO,
    targetRatio: env.RESERVE_TARGET_RATIO,
    alertThreshold: env.RESERVE_ALERT_THRESHOLD,
    // #627: Percentage drift threshold above which a currency is considered over/underweight
    // and triggers rebalancing instructions. Default 1 (1%). Set via RESERVE_DRIFT_THRESHOLD_PCT.
    driftThresholdPct: env.RESERVE_DRIFT_THRESHOLD_PCT,
  },

  // Notifications (email / SMS)
  notification: {
    emailProvider: env.NOTIFICATION_EMAIL_PROVIDER,
    emailFrom: env.NOTIFICATION_FROM_EMAIL,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === "true",
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      maxConnections: env.SMTP_MAX_CONNECTIONS,
      maxMessages: env.SMTP_MAX_MESSAGES,
    },
    sendgridApiKey: env.SENDGRID_API_KEY,
    sesRegion: env.AWS_REGION || env.AWS_SES_REGION || "us-east-1",
    sesAccessKeyId: env.AWS_ACCESS_KEY_ID,
    sesSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    smsProvider: env.NOTIFICATION_SMS_PROVIDER,
    alertEmail: env.NOTIFICATION_ALERT_EMAIL,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    twilioFromNumber: env.TWILIO_FROM_NUMBER,
    africasTalkingApiKey: env.AFRICAS_TALKING_API_KEY,
    africasTalkingUsername: env.AFRICAS_TALKING_USERNAME,
  },

  // Outbound webhooks
  webhook: {
    url: env.WEBHOOK_URL,
    secret: env.WEBHOOK_SECRET,
  },

  // Limits
  limits: {
    retail: {
      depositDailyUsd: env.LIMIT_RETAIL_DEPOSIT_DAILY_USD,
      depositMonthlyUsd: env.LIMIT_RETAIL_DEPOSIT_MONTHLY_USD,
      withdrawalSingleCurrencyDailyUsd: env.LIMIT_RETAIL_WITHDRAWAL_DAILY_USD,
      withdrawalSingleCurrencyMonthlyUsd: env.LIMIT_RETAIL_WITHDRAWAL_MONTHLY_USD,
    },
    business: {
      depositDailyUsd: env.LIMIT_BUSINESS_DEPOSIT_DAILY_USD,
      depositMonthlyUsd: env.LIMIT_BUSINESS_DEPOSIT_MONTHLY_USD,
      withdrawalSingleCurrencyDailyUsd: env.LIMIT_BUSINESS_WITHDRAWAL_DAILY_USD,
      withdrawalSingleCurrencyMonthlyUsd: env.LIMIT_BUSINESS_WITHDRAWAL_MONTHLY_USD,
    },
    government: {
      depositDailyUsd: env.LIMIT_GOV_DEPOSIT_DAILY_USD,
      depositMonthlyUsd: env.LIMIT_GOV_DEPOSIT_MONTHLY_USD,
      withdrawalSingleCurrencyDailyUsd: env.LIMIT_GOV_WITHDRAWAL_DAILY_USD,
      withdrawalSingleCurrencyMonthlyUsd: env.LIMIT_GOV_WITHDRAWAL_MONTHLY_USD,
    },
    circuitBreaker: {
      reserveWeightThresholdPct: env.LIMIT_CIRCUIT_BREAKER_RESERVE_WEIGHT_PCT,
      minReserveRatio: env.LIMIT_CIRCUIT_BREAKER_MIN_RATIO,
    },
  },

  // Auth Security
  auth: {
    bruteMaxAttempts: env.AUTH_BRUTE_MAX_ATTEMPTS,
    bruteLockoutMs: env.AUTH_BRUTE_LOCKOUT_MS,
    captchaSecret: env.CAPTCHA_SECRET,
  },

  openai: {
    apiKey: env.OPENAI_API_KEY || "",
    orgMonthlyBudgetUsd: env.OPENAI_ORG_MONTHLY_BUDGET_USD,
    maxTokensPerRequest: env.OPENAI_MAX_TOKENS_PER_REQUEST,
    // Fail-open behaviour: if true, downstream callers will be allowed to continue
    // when the OpenAI service is degraded (timeouts, rate limits, network issues).
    failOpenEnabled: env.OPENAI_FAIL_OPEN_ENABLED === "true",
    failOpenTimeoutMs: env.OPENAI_FAIL_OPEN_TIMEOUT_MS,
    failOpenMaxRetries: env.OPENAI_FAIL_OPEN_MAX_RETRIES,
    failOpenRetryBaseMs: env.OPENAI_FAIL_OPEN_RETRY_BASE_MS,
  },

  // PII encryption key for KYC and sensitive field encryption
  piiEncryptionKey: env.PII_ENCRYPTION_KEY,

  // Startup database connection retry (#402)
  database: {
    connectMaxRetries: env.DB_CONNECT_MAX_RETRIES,
    connectBaseBackoffMs: env.DB_CONNECT_BASE_BACKOFF_MS,
    connectMaxBackoffMs: env.DB_CONNECT_MAX_BACKOFF_MS,
  },

  // #381: WAL / continuous backup configuration
  walBackup: {
    configured: env.PG_WAL_BACKUP_CONFIGURED === "true",
    provider: env.PG_WAL_BACKUP_PROVIDER || "",
  },

  // #383: Migration table replication / promotion safety.
  prismaMigrationHistory: {
    replicated: env.PRISMA_MIGRATION_HISTORY_REPLICATED === "true",
  },

  // CORS — explicit origins only; wildcard * is rejected (incompatible with credentials)
  corsOrigin: parseCorsOrigins(env.CORS_ORIGIN, env.NODE_ENV),

  // CDN — when set, DNS prefetch is enabled so browsers can resolve the CDN domain early
  cdnUrl: env.CDN_URL ?? null,

  // #436: Memory leak detection configuration
  memory: {
    leakThresholdPct: env.MEMORY_LEAK_THRESHOLD_PCT,
    checkIntervalMs: env.MEMORY_CHECK_INTERVAL_MS,
    heapDumpDir: env.HEAP_DUMP_DIR,
  },

  bulkTransfer: {
    chunkSize: env.BULK_TRANSFER_CHUNK_SIZE,
    maxFileSizeBytes: env.BULK_TRANSFER_MAX_FILE_SIZE_BYTES,
  },
};
