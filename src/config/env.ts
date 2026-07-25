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
  BUSINESS_TIMEZONE: z.string().default("Africa/Lagos"),
  USDC_ISSUER_TESTNET: z.string().trim().min(1),
  USDC_ISSUER_MAINNET: z.string().trim().min(1),
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${messages}`);
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.PRISMA_ACCELERATE_URL) {
  throw new Error("Missing required environment variable: PRISMA_ACCELERATE_URL");
}

// #630: JWT_SECRET must not be the documented .env.example placeholder in production.
const JWT_SECRET_EXAMPLE_VALUES = ["dev-jwt-secret-change-me", "change-me-in-production"];
if (
  parsed.data.NODE_ENV === "production" &&
  JWT_SECRET_EXAMPLE_VALUES.includes(parsed.data.JWT_SECRET)
) {
  throw new Error(
    "JWT_SECRET is set to a documented example/placeholder value — generate a unique secret before deploying to production.",
  );
}

// #632: CHALLENGE_TOKEN_SECRET must be explicit in production so a leaked
// JWT_SECRET does not also compromise the 2FA challenge-token trust boundary.
if (parsed.data.NODE_ENV === "production" && !parsed.data.CHALLENGE_TOKEN_SECRET) {
  throw new Error(
    "Missing required environment variable: CHALLENGE_TOKEN_SECRET (must be set explicitly in production, distinct from JWT_SECRET)",
  );
}

const s3ScanWebhookSecret = process.env.S3_SCAN_WEBHOOK_SECRET?.trim() || "change-me-in-production";

if (parsed.data.NODE_ENV === "production" && s3ScanWebhookSecret === "change-me-in-production") {
  throw new Error("Missing required environment variable: S3_SCAN_WEBHOOK_SECRET");
}
// #382: Fintech partner keys must never be absent in production — an empty
// Authorization header would be silently accepted by axios and only fail at
// the first live API call, making the error hard to trace.  Fail at boot
// instead so a misconfigured deployment is caught before it reaches traffic.
if (parsed.data.NODE_ENV === "production") {
  const missingFintechKeys: string[] = [];
  if (!process.env.FLUTTERWAVE_SECRET_KEY) missingFintechKeys.push("FLUTTERWAVE_SECRET_KEY");
  if (!process.env.FLUTTERWAVE_WEBHOOK_SECRET)
    missingFintechKeys.push("FLUTTERWAVE_WEBHOOK_SECRET");
  if (!process.env.PAYSTACK_SECRET_KEY) missingFintechKeys.push("PAYSTACK_SECRET_KEY");
  if (!process.env.BILLS_WEBHOOK_SECRET) missingFintechKeys.push("BILLS_WEBHOOK_SECRET");
  if (missingFintechKeys.length > 0) {
    throw new Error(
      `Missing required fintech API keys in production: ${missingFintechKeys.join(", ")}. ` +
        "Inject these via environment variables — never commit them to source control. " +
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
  maxSigninAttempts: env.MAX_SIGNIN_ATTEMPTS,
  signinLockoutDurationMs: env.SIGNIN_LOCKOUT_DURATION_MS,

  // Rate Limiting Fallback (during cache outages)
  rateLimitFallbackMaxRequests: env.RATE_LIMIT_FALLBACK_MAX_REQUESTS,
  rateLimitCircuitBreakerThreshold: env.RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD,
  rateLimitCircuitBreakerCooldownMs: env.RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN_MS,

  // Redis cache (Sentinel / standalone)
  redis: {
    url: process.env.REDIS_URL?.trim() || undefined,
    sentinels: (() => {
      const raw = process.env.REDIS_SENTINELS || "";
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
    sentinelName: process.env.REDIS_SENTINEL_NAME || "",
    password: process.env.REDIS_PASSWORD || "",
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || "3", 10),
    readonlyRetryAttempts: parseInt(process.env.REDIS_READONLY_RETRY_ATTEMPTS || "3", 10),
    readonlyRetryDelayMs: parseInt(process.env.REDIS_READONLY_RETRY_DELAY_MS || "100", 10),
  },

  // Logging
  logLevel: env.LOG_LEVEL,
  // Per-transport levels keep debug noise out of production aggregators (#398).
  logConsoleLevel:
    process.env.LOG_LEVEL_CONSOLE ?? (env.NODE_ENV === "production" ? "info" : env.LOG_LEVEL),
  logFileLevel:
    process.env.LOG_LEVEL_FILE ?? (env.NODE_ENV === "production" ? "info" : env.LOG_LEVEL),
  logFile: process.env.LOG_FILE || "logs/app.log",

  // Business calendar timezone for salary runs and withdrawal windows (#408)
  businessTimeZone: env.BUSINESS_TIMEZONE,

  // Fintech APIs
  flutterwave: {
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || "",
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY || "",
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY || "",
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || "",
    baseUrl: process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com/v3",
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    baseUrl: process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
  },
  // BE-001: HMAC secret for /v1/webhooks/bills/:provider signature verification.
  bills: {
    webhookSecret: process.env.BILLS_WEBHOOK_SECRET || "",
  },
  mtnMomo: {
    subscriptionKey: process.env.MTN_MOMO_SUBSCRIPTION_KEY || "",
    apiUserId: process.env.MTN_MOMO_API_USER_ID || "",
    apiKey: process.env.MTN_MOMO_API_KEY || "",
    baseUrl:
      process.env.MTN_MOMO_BASE_URL ||
      (process.env.MTN_MOMO_TARGET_ENVIRONMENT === "production"
        ? "https://momodeveloper.mtn.com"
        : "https://sandbox.momodeveloper.mtn.com"),
    targetEnvironment:
      (process.env.MTN_MOMO_TARGET_ENVIRONMENT as "sandbox" | "production") || "sandbox",
  },
  s3: {
    region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET?.trim() || undefined,
    endpoint: process.env.S3_ENDPOINT || "",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "",
    uploadUrlTtlSeconds: parseInt(process.env.S3_UPLOAD_URL_TTL_SECONDS || "900", 10),
    downloadUrlTtlSeconds: parseInt(process.env.S3_DOWNLOAD_URL_TTL_SECONDS || "300", 10),
    scanWebhookSecret: s3ScanWebhookSecret,
  },
  fintech: {
    currencyProviders: ((): Record<string, string> => {
      const raw = process.env.FINTECH_CURRENCY_PROVIDERS;
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
    network: process.env.STELLAR_NETWORK || "testnet",
    horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    /** Soroban RPC (simulate + send). Override if default host fails DNS (e.g. use SDF friendbot list / custom RPC). */
    sorobanRpcUrl: ((): string => {
      const explicit = process.env.STELLAR_SOROBAN_RPC_URL?.trim();
      if (explicit) return explicit;
      const net = process.env.STELLAR_NETWORK || "testnet";
      return net === "mainnet"
        ? "https://soroban-mainnet.stellar.org"
        : "https://soroban-testnet.stellar.org";
    })(),
    secretKey: process.env.STELLAR_SECRET_KEY || "",
    networkPassphrase:
      process.env.STELLAR_NETWORK === "mainnet"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015",
    /** Network-native asset code shown to callers for wallet bootstrap (default XLM, or PI when bootstrap profile says so). */
    nativeAssetCode: ((): string => {
      const explicit = process.env.STELLAR_NATIVE_ASSET_CODE?.trim();
      if (explicit) return explicit.toUpperCase();
      const bootstrapProfile = (process.env.TESTNET_CUSTODIAL_BOOTSTRAP || "").trim().toLowerCase();
      return bootstrapProfile.includes("pi") ? "PI" : "XLM";
    })(),
    /** Wallet activation strategy. Default keeps the current create-account path, but makes it explicit/configurable. */
    activationStrategy: (process.env.WALLET_ACTIVATION_STRATEGY || "create_account_native") as
      | "create_account_native"
      | "disabled",
    /** Optional bootstrap profile from deployment docs/runbooks; used only for config alignment and diagnostics. */
    bootstrapProfile: process.env.TESTNET_CUSTODIAL_BOOTSTRAP || "",
    /** Minimum network-native balance sent to user wallet for activation. */
    activationAmount: ((): string => {
      const raw =
        process.env.WALLET_ACTIVATION_AMOUNT ||
        process.env.WALLET_ACTIVATION_NATIVE ||
        process.env.WALLET_ACTIVATION_XLM ||
        process.env.STELLAR_MIN_BALANCE ||
        "1";
      return raw.trim() || "1";
    })(),
    /** Backwards-compatible numeric alias for older callers/tests that still reference minBalanceXlm. */
    minBalanceXlm: (() => {
      const parsed = Number.parseFloat(
        process.env.WALLET_ACTIVATION_AMOUNT ||
          process.env.WALLET_ACTIVATION_NATIVE ||
          process.env.WALLET_ACTIVATION_XLM ||
          process.env.STELLAR_MIN_BALANCE ||
          "1",
      );
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    })(),
    /** Base transaction fee in stroops used as fallback when dynamic fee fetch is disabled or fails. Default 100. */
    baseFeeStroops: parseInt(process.env.STELLAR_BASE_FEE_STROOPS || "100", 10),
    /** When true, fetches the current recommended base fee from Horizon before each transaction. Falls back to baseFeeStroops on failure. */
    useDynamicFees: process.env.STELLAR_USE_DYNAMIC_FEES === "true",
    /** Maximum total fee per Soroban transaction in stroops (base + resource fees). Default 10M stroops (~50 XLM at base fee 100). */
    sorobanMaxFeeStroops: parseInt(process.env.STELLAR_SOROBAN_MAX_FEE_STROOPS || "10000000", 10),
    /** Minimum total fee per Soroban transaction in stroops to prevent underpricing. Default 5000 stroops. */
    sorobanMinFeeStroops: parseInt(process.env.STELLAR_SOROBAN_MIN_FEE_STROOPS || "5000", 10),
    /** Circle USDC issuer on Stellar testnet, configured via the environment. */
    usdcIssuerTestnet: env.USDC_ISSUER_TESTNET,
    /** Circle USDC issuer on Stellar mainnet, configured via the environment. */
    usdcIssuerMainnet: env.USDC_ISSUER_MAINNET,
    /** Stellar asset code for the USDC-like swap asset on testnet (4–12 alphanumeric). Default `USDC`. */
    usdcAssetCodeTestnet: process.env.USDC_ASSET_CODE_TESTNET || "USDC",
    /** Stellar asset code for the USDC-like swap asset on mainnet. Default `USDC`. */
    usdcAssetCodeMainnet: process.env.USDC_ASSET_CODE_MAINNET || "USDC",
    /** Slippage tolerance for the USDC→XLM DEX swap in basis points. Default 50 = 0.5%. */
    usdcXlmSlippageBps: parseInt(process.env.USDC_XLM_SLIPPAGE_BPS ?? "50", 10),
  },

  // Oracle (40/40/20: central bank, fintech, forex)
  oracle: {
    updateIntervalHours: parseInt(process.env.ORACLE_UPDATE_INTERVAL_HOURS || "6", 10),
    emergencyThreshold: parseFloat(process.env.ORACLE_EMERGENCY_THRESHOLD || "0.05"),
    maxDeviationPerUpdate: parseFloat(process.env.ORACLE_MAX_DEVIATION_PER_UPDATE || "0.05"),
    circuitBreakerThreshold: parseFloat(process.env.ORACLE_CIRCUIT_BREAKER_THRESHOLD || "0.10"),
    forex: {
      baseUrl: process.env.EXCHANGERATE_API_BASE_URL || "https://v6.exchangerate-api.com/v6",
      apiKey: process.env.EXCHANGERATE_API_KEY || "",
    },
    centralBankUrls: ((): Record<string, string> => {
      const raw = process.env.CURRENCY_CENTRAL_BANK_URLS;
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
    minRatio: parseFloat(process.env.RESERVE_MIN_RATIO || "1.02"),
    targetRatio: parseFloat(process.env.RESERVE_TARGET_RATIO || "1.05"),
    alertThreshold: parseFloat(process.env.RESERVE_ALERT_THRESHOLD || "1.02"),
  },

  // Notifications (email / SMS)
  notification: {
    emailProvider: (process.env.NOTIFICATION_EMAIL_PROVIDER || "log") as
      | "sendgrid"
      | "ses"
      | "smtp"
      | "log",
    emailFrom: process.env.NOTIFICATION_FROM_EMAIL || "noreply@acbu.io",
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      maxConnections: parseInt(process.env.SMTP_MAX_CONNECTIONS || "5", 10),
      maxMessages: parseInt(process.env.SMTP_MAX_MESSAGES || "100", 10),
    },
    sendgridApiKey: process.env.SENDGRID_API_KEY || "",
    sesRegion: process.env.AWS_REGION || process.env.AWS_SES_REGION || "us-east-1",
    sesAccessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    sesSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    smsProvider: (process.env.NOTIFICATION_SMS_PROVIDER || "log") as
      | "twilio"
      | "africas_talking"
      | "log",
    alertEmail: process.env.NOTIFICATION_ALERT_EMAIL || "",
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER || "",
    africasTalkingApiKey: process.env.AFRICAS_TALKING_API_KEY || "",
    africasTalkingUsername: process.env.AFRICAS_TALKING_USERNAME || "",
  },

  // Outbound webhooks
  webhook: {
    url: process.env.WEBHOOK_URL || "",
    secret: process.env.WEBHOOK_SECRET || "",
  },

  // Limits
  limits: {
    retail: {
      depositDailyUsd: parseInt(process.env.LIMIT_RETAIL_DEPOSIT_DAILY_USD || "5000", 10),
      depositMonthlyUsd: parseInt(process.env.LIMIT_RETAIL_DEPOSIT_MONTHLY_USD || "50000", 10),
      withdrawalSingleCurrencyDailyUsd: parseInt(
        process.env.LIMIT_RETAIL_WITHDRAWAL_DAILY_USD || "10000",
        10,
      ),
      withdrawalSingleCurrencyMonthlyUsd: parseInt(
        process.env.LIMIT_RETAIL_WITHDRAWAL_MONTHLY_USD || "80000",
        10,
      ),
    },
    business: {
      depositDailyUsd: parseInt(process.env.LIMIT_BUSINESS_DEPOSIT_DAILY_USD || "50000", 10),
      depositMonthlyUsd: parseInt(process.env.LIMIT_BUSINESS_DEPOSIT_MONTHLY_USD || "500000", 10),
      withdrawalSingleCurrencyDailyUsd: parseInt(
        process.env.LIMIT_BUSINESS_WITHDRAWAL_DAILY_USD || "100000",
        10,
      ),
      withdrawalSingleCurrencyMonthlyUsd: parseInt(
        process.env.LIMIT_BUSINESS_WITHDRAWAL_MONTHLY_USD || "800000",
        10,
      ),
    },
    government: {
      depositDailyUsd: parseInt(process.env.LIMIT_GOV_DEPOSIT_DAILY_USD || "500000", 10),
      depositMonthlyUsd: parseInt(process.env.LIMIT_GOV_DEPOSIT_MONTHLY_USD || "5000000", 10),
      withdrawalSingleCurrencyDailyUsd: parseInt(
        process.env.LIMIT_GOV_WITHDRAWAL_DAILY_USD || "500000",
        10,
      ),
      withdrawalSingleCurrencyMonthlyUsd: parseInt(
        process.env.LIMIT_GOV_WITHDRAWAL_MONTHLY_USD || "4000000",
        10,
      ),
    },
    circuitBreaker: {
      reserveWeightThresholdPct: parseFloat(
        process.env.LIMIT_CIRCUIT_BREAKER_RESERVE_WEIGHT_PCT || "10",
      ),
      minReserveRatio: parseFloat(process.env.LIMIT_CIRCUIT_BREAKER_MIN_RATIO || "1.02"),
    },
  },

  // Auth Security
  auth: {
    bruteMaxAttempts: parseInt(process.env.AUTH_BRUTE_MAX_ATTEMPTS || "5", 10),
    bruteLockoutMs: parseInt(process.env.AUTH_BRUTE_LOCKOUT_MS || "900000", 10), // 15 mins
    captchaSecret: process.env.CAPTCHA_SECRET || "",
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
};
