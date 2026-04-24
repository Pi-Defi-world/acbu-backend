import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(5000),
  API_VERSION: z.string().default("v1"),
  DATABASE_URL: z.string().min(1),
  MONGODB_URI: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  CHALLENGE_TOKEN_SECRET: z.string().optional(),
  PRISMA_ACCELERATE_URL: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().default(30),
  API_KEY_SALT: z.string().default(""),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${messages}`);
}

if (
  parsed.data.NODE_ENV === "production" &&
  !parsed.data.PRISMA_ACCELERATE_URL
) {
  throw new Error(
    "Missing required environment variable: PRISMA_ACCELERATE_URL",
  );
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  apiVersion: env.API_VERSION,
  databaseUrl: env.DATABASE_URL,
  prismaAccelerateUrl: env.PRISMA_ACCELERATE_URL,
  mongodbUri: env.MONGODB_URI,
  rabbitmqUrl: env.RABBITMQ_URL,
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  jwtClockToleranceSeconds: env.JWT_CLOCK_TOLERANCE_SECONDS,
  challengeTokenSecret: env.CHALLENGE_TOKEN_SECRET || env.JWT_SECRET,
  apiKeySalt: env.API_KEY_SALT,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,

  // Rate Limiting Fallback (during cache outages)
  rateLimitFallbackMaxRequests: parseInt(
    process.env.RATE_LIMIT_FALLBACK_MAX_REQUESTS || "20",
    10,
  ),
  rateLimitCircuitBreakerThreshold: parseInt(
    process.env.RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD || "5",
    10,
  ),
  rateLimitCircuitBreakerCooldownMs: parseInt(
    process.env.RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN_MS || "60000",
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
      const bootstrapProfile = (
        process.env.TESTNET_CUSTODIAL_BOOTSTRAP || ""
      ).trim()
        .toLowerCase();
      return bootstrapProfile.includes("pi") ? "PI" : "XLM";
    })(),
    /** Wallet activation strategy. Default keeps the current create-account path, but makes it explicit/configurable. */
    activationStrategy: (
      process.env.WALLET_ACTIVATION_STRATEGY || "create_account_native"
    ) as "create_account_native" | "disabled",
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
    /** Circle USDC issuer on Stellar testnet. Default is the well-known Circle testnet issuer. */
    usdcIssuerTestnet:
      process.env.USDC_ISSUER_TESTNET ??
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    /** Circle USDC issuer on Stellar mainnet. Default is the well-known Circle mainnet issuer. */
    usdcIssuerMainnet:
      process.env.USDC_ISSUER_MAINNET ??
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    /** Stellar asset code for the USDC-like swap asset on testnet (4–12 alphanumeric). Default `USDC`. */
    usdcAssetCodeTestnet: process.env.USDC_ASSET_CODE_TESTNET || "USDC",
    /** Stellar asset code for the USDC-like swap asset on mainnet. Default `USDC`. */
    usdcAssetCodeMainnet: process.env.USDC_ASSET_CODE_MAINNET || "USDC",
    /** Slippage tolerance for the USDC→XLM DEX swap in basis points. Default 50 = 0.5%. */
    usdcXlmSlippageBps: parseInt(process.env.USDC_XLM_SLIPPAGE_BPS ?? "50", 10),
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
  corsOrigin: process.env.CORS_ORIGIN?.split(",") || ["*"],
};
