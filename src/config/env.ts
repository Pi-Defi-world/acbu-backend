import dotenv from "dotenv";

dotenv.config();

// ── Validate required env vars BEFORE building config ────────────────────────
// This ensures the app fails fast with a clear message instead of starting
// with empty strings and failing later in an unpredictable way.
const requiredEnvVars = [
  "DATABASE_URL",
  "MONGODB_URI",
  "RABBITMQ_URL",
  "JWT_SECRET",
];

if (process.env.NODE_ENV === "production") {
  requiredEnvVars.push("PRISMA_ACCELERATE_URL");
}

const missing = requiredEnvVars.filter((v) => !process.env[v]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(", ")}`,
  );
}

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "5000", 10),
  apiVersion: process.env.API_VERSION || "v1",

  // Database
  databaseUrl: process.env.DATABASE_URL || "",
  prismaAccelerateUrl: process.env.PRISMA_ACCELERATE_URL || "",

  // MongoDB
  mongodbUri: process.env.MONGODB_URI || "",

  // RabbitMQ
  rabbitmqUrl: process.env.RABBITMQ_URL || "",

  // JWT
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  // API Security
  apiKeySalt: process.env.API_KEY_SALT || "",

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  rateLimitMaxRequests: parseInt(
    process.env.RATE_LIMIT_MAX_REQUESTS || "100",
    10,
  ),

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
  logFile: process.env.LOG_FILE || "logs/app.log",

  // Fintech APIs
  flutterwave: {
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || "",
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY || "",
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY || "",
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || "",
    baseUrl:
      process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com/v3",
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    baseUrl: process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
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
      (process.env.MTN_MOMO_TARGET_ENVIRONMENT as "sandbox" | "production") ||
      "sandbox",
  },
  fintech: {
    currencyProviders: ((): Record<string, string> => {
      const raw = process.env.FINTECH_CURRENCY_PROVIDERS;
      if (raw) {
        try {
          if (raw.startsWith("{"))
            return JSON.parse(raw) as Record<string, string>;
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
    horizonUrl:
      process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    secretKey: process.env.STELLAR_SECRET_KEY || "",
    networkPassphrase:
      process.env.STELLAR_NETWORK === "mainnet"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015",
    /** Minimum XLM sent to user wallet for activation (Stellar account creation). Default 1. */
    minBalanceXlm: parseFloat(
      process.env.WALLET_ACTIVATION_XLM ||
        process.env.STELLAR_MIN_BALANCE ||
        "1",
    ),
    /** Base transaction fee in stroops used as fallback when dynamic fee fetch is disabled or fails. Default 100. */
    baseFeeStroops: parseInt(process.env.STELLAR_BASE_FEE_STROOPS || "100", 10),
    /** When true, fetches the current recommended base fee from Horizon before each transaction. Falls back to baseFeeStroops on failure. */
    useDynamicFees: process.env.STELLAR_USE_DYNAMIC_FEES === "true",
  },

  // Pi Network / Bridge
  pi: {
    /** Enable Pi bridge/chain for wallet activation */
    enabled: process.env.PI_BRIDGE_ENABLED === "true" || false,
    /** Secret key for Pi bridge transactions */
    secretKey: process.env.PI_SECRET_KEY || "",
    /** Pi bridge/chain API endpoint */
    apiUrl: process.env.PI_API_URL || "https://api.pi.network.com",
    /** Minimum Pi sent to user wallet for activation. Default 0.1 */
    minBalancePi: parseFloat(
      process.env.WALLET_ACTIVATION_PI || process.env.PI_MIN_BALANCE || "0.1",
    ),
    /** Network: testnet or mainnet */
    network: (process.env.PI_NETWORK || "testnet") as "testnet" | "mainnet",
  },

  // Oracle (40/40/20: central bank, fintech, forex)
  oracle: {
    updateIntervalHours: parseInt(
      process.env.ORACLE_UPDATE_INTERVAL_HOURS || "6",
      10,
    ),
    emergencyThreshold: parseFloat(
      process.env.ORACLE_EMERGENCY_THRESHOLD || "0.05",
    ),
    maxDeviationPerUpdate: parseFloat(
      process.env.ORACLE_MAX_DEVIATION_PER_UPDATE || "0.05",
    ),
    circuitBreakerThreshold: parseFloat(
      process.env.ORACLE_CIRCUIT_BREAKER_THRESHOLD || "0.10",
    ),
    forex: {
      baseUrl:
        process.env.EXCHANGERATE_API_BASE_URL ||
        "https://v6.exchangerate-api.com/v6",
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

  // KYC (Pi-style two-layer)
  kyc: {
    feeAcbu: parseFloat(process.env.KYC_FEE_ACBU || ""),
    feeCollectorAddress: process.env.KYC_FEE_COLLECTOR_ADDRESS || "",
    machineProvider: (process.env.KYC_MACHINE_PROVIDER || "none") as
      | "openai"
      | "textract"
      | "none",
    machineConfidenceThreshold: parseFloat(
      process.env.KYC_MACHINE_CONFIDENCE_THRESHOLD || "0.95",
    ),
    objectStoreBucket: process.env.KYC_OBJECT_STORE_BUCKET || "kyc-documents",
    objectStoreRegion: process.env.KYC_OBJECT_STORE_REGION || "us-east-1",
    objectStoreEndpoint: process.env.KYC_OBJECT_STORE_ENDPOINT || "",
    minValidatorsPerApplication: parseInt(
      process.env.KYC_MIN_VALIDATORS_PER_APPLICATION || "2",
      10,
    ),
    consensusRule: (process.env.KYC_CONSENSUS_RULE || "all_approve") as
      | "all_approve"
      | "majority_approve",
    rewardSharePerValidator: parseFloat(
      process.env.KYC_REWARD_SHARE_PER_VALIDATOR || "0.33",
    ),
    accuracyThresholdForRemoval: parseFloat(
      process.env.KYC_ACCURACY_THRESHOLD_FOR_REMOVAL || "0.7",
    ),
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    awsRegion:
      process.env.AWS_REGION ||
      process.env.KYC_OBJECT_STORE_REGION ||
      "us-east-1",
  },

  // Notifications (email / SMS)
  notification: {
    emailProvider: (process.env.NOTIFICATION_EMAIL_PROVIDER || "log") as
      | "sendgrid"
      | "ses"
      | "log",
    emailFrom:
      process.env.NOTIFICATION_FROM_EMAIL || "noreply@acbu.example.com",
    sendgridApiKey: process.env.SENDGRID_API_KEY || "",
    sesRegion:
      process.env.AWS_REGION || process.env.AWS_SES_REGION || "us-east-1",
    smsProvider: (process.env.NOTIFICATION_SMS_PROVIDER || "log") as
      | "twilio"
      | "africas_talking"
      | "log",
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
      depositDailyUsd: parseInt(
        process.env.LIMIT_RETAIL_DEPOSIT_DAILY_USD || "5000",
        10,
      ),
      depositMonthlyUsd: parseInt(
        process.env.LIMIT_RETAIL_DEPOSIT_MONTHLY_USD || "50000",
        10,
      ),
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
      depositDailyUsd: parseInt(
        process.env.LIMIT_BUSINESS_DEPOSIT_DAILY_USD || "50000",
        10,
      ),
      depositMonthlyUsd: parseInt(
        process.env.LIMIT_BUSINESS_DEPOSIT_MONTHLY_USD || "500000",
        10,
      ),
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
      depositDailyUsd: parseInt(
        process.env.LIMIT_GOV_DEPOSIT_DAILY_USD || "500000",
        10,
      ),
      depositMonthlyUsd: parseInt(
        process.env.LIMIT_GOV_DEPOSIT_MONTHLY_USD || "5000000",
        10,
      ),
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
      minReserveRatio: parseFloat(
        process.env.LIMIT_CIRCUIT_BREAKER_MIN_RATIO || "1.02",
      ),
    },
  },

  // CORS
  corsOrigin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
};
