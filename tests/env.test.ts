jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

describe("env validation", () => {
  const ORIGINAL = process.env;
  const REQUIRED_ENV = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    MONGODB_URI: "mongodb://localhost:27017/db",
    RABBITMQ_URL: "amqp://localhost:5672",
    JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
    PRISMA_ACCELERATE_URL: "prisma://accelerate.prisma-data.net/?api_key=test",
    CORS_ORIGIN: "https://app.acbu.io",
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL, ...REQUIRED_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL;
  });

  it("throws when JWT_SECRET is missing", () => {
    // Use empty string to prevent dotenv from repopulating via .env.test
    process.env.JWT_SECRET = "";
    expect(() => require("../src/config/env")).toThrow(/JWT_SECRET/);
  });

  it("throws when DATABASE_URL is missing", () => {
    process.env.DATABASE_URL = "";
    expect(() => require("../src/config/env")).toThrow(/DATABASE_URL/);
  });

  it("throws when MONGODB_URI is missing", () => {
    process.env.MONGODB_URI = "";
    expect(() => require("../src/config/env")).toThrow(/MONGODB_URI/);
  });

  it("loads successfully with all required vars set", () => {
    const { config } = require("../src/config/env");
    expect(config.redis.url).toBeUndefined();
    expect(config.s3.bucket).toBeUndefined();
  });

  it("coerces PORT to a number", () => {
    process.env.PORT = "3000";
    const { config } = require("../src/config/env");
    expect(typeof config.port).toBe("number");
    expect(config.port).toBe(3000);
  });

  it("accepts valid LOG_LEVEL values", () => {
    process.env.LOG_LEVEL = "debug";
    const { config } = require("../src/config/env");
    expect(config.logLevel).toBe("debug");
  });

  it("coerces rate-limit fallback config values from env strings", () => {
    process.env.RATE_LIMIT_FALLBACK_MAX_REQUESTS = "42";
    process.env.RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD = "7";
    process.env.RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN_MS = "90000";

    const { config } = require("../src/config/env");

    expect(config.rateLimitFallbackMaxRequests).toBe(42);
    expect(config.rateLimitCircuitBreakerThreshold).toBe(7);
    expect(config.rateLimitCircuitBreakerCooldownMs).toBe(90000);
  });

  it("coerces admin rate-limit config values from env strings", () => {
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS = "120000";
    process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS = "42";

    const { config } = require("../src/config/env");

    expect(config.adminRateLimitWindowMs).toBe(120000);
    expect(config.adminRateLimitMaxRequests).toBe(42);
  });

  it("defaults admin rate-limit config when not set", () => {
    delete process.env.ADMIN_RATE_LIMIT_WINDOW_MS;
    delete process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS;

    const { config } = require("../src/config/env");

    expect(config.adminRateLimitWindowMs).toBe(60000);
    expect(config.adminRateLimitMaxRequests).toBe(30);
  });

  it("defaults OPENAI_FAIL_OPEN_ENABLED to false (AB-025 fail-closed)", () => {
    delete process.env.OPENAI_FAIL_OPEN_ENABLED;

    const { config } = require("../src/config/env");

    expect(config.openai.failOpenEnabled).toBe(false);
  });

  it("enables fail-open when OPENAI_FAIL_OPEN_ENABLED is explicitly true (AB-025)", () => {
    process.env.OPENAI_FAIL_OPEN_ENABLED = "TRUE";

    const { config } = require("../src/config/env");

    expect(config.openai.failOpenEnabled).toBe(true);
  });

  it("throws when OPENAI_FAIL_OPEN_ENABLED has invalid boolean string", () => {
    process.env.OPENAI_FAIL_OPEN_ENABLED = "not-a-bool";

    expect(() => require("../src/config/env")).toThrow(/OPENAI_FAIL_OPEN_ENABLED/);
  });

  it("throws when LOG_LEVEL is invalid", () => {
    process.env.LOG_LEVEL = "invalid_level";
    expect(() => require("../src/config/env")).toThrow(/LOG_LEVEL/);
  });

  it("throws when CORS_ORIGIN contains wildcard", () => {
    process.env.CORS_ORIGIN = "*";
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../src/config/env");
    }).toThrow(/wildcard/i);
  });

  it("throws in production when S3_SCAN_WEBHOOK_SECRET is the placeholder", () => {
    process.env = {
      ...ORIGINAL,
      ...REQUIRED_ENV,
      NODE_ENV: "production",
      CHALLENGE_TOKEN_SECRET: "production-challenge-token-secret-32chars-xyz",
      USDC_ISSUER_TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      USDC_ISSUER_MAINNET: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      S3_SCAN_WEBHOOK_SECRET: "change-me-in-production",
      FLUTTERWAVE_SECRET_KEY: "test-flutterwave-secret",
      FLUTTERWAVE_WEBHOOK_SECRET: "test-flutterwave-webhook-secret",
      PAYSTACK_SECRET_KEY: "test-paystack-secret",
      BILLS_WEBHOOK_SECRET: "test-bills-webhook-secret",
    };

    expect(() => require("../src/config/env")).toThrow(/S3_SCAN_WEBHOOK_SECRET/);
  });

  it("loads in production when S3_SCAN_WEBHOOK_SECRET is configured", () => {
    process.env = {
      ...ORIGINAL,
      ...REQUIRED_ENV,
      NODE_ENV: "production",
      S3_SCAN_WEBHOOK_SECRET: "super-secret-value",
      CHALLENGE_TOKEN_SECRET: "production-challenge-token-secret-32chars-xyz",
      USDC_ISSUER_TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      USDC_ISSUER_MAINNET: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      FLUTTERWAVE_SECRET_KEY: "test-flutterwave-secret",
      FLUTTERWAVE_WEBHOOK_SECRET: "test-flutterwave-webhook-secret",
      PAYSTACK_SECRET_KEY: "test-paystack-secret",
      BILLS_WEBHOOK_SECRET: "test-bills-webhook-secret",
    };

    expect(() => require("../src/config/env")).not.toThrow();
  });

  it("loads successfully in development without USDC issuers (W2-B-056)", () => {
    process.env = {
      ...ORIGINAL,
      ...REQUIRED_ENV,
      NODE_ENV: "development",
    };
    delete process.env.USDC_ISSUER_TESTNET;
    delete process.env.USDC_ISSUER_MAINNET;

    expect(() => require("../src/config/env")).not.toThrow();
    const { config } = require("../src/config/env");
    // In dev, issuers may be undefined or populated from .env.local — both are valid after fix
    const testnet = config.stellar.usdcIssuerTestnet;
    const mainnet = config.stellar.usdcIssuerMainnet;
    expect(testnet === undefined || typeof testnet === "string").toBe(true);
    expect(mainnet === undefined || typeof mainnet === "string").toBe(true);
  });

  it("throws in production when USDC_ISSUER_TESTNET is missing", () => {
    process.env = {
      ...ORIGINAL,
      ...REQUIRED_ENV,
      NODE_ENV: "production",
      S3_SCAN_WEBHOOK_SECRET: "super-secret-value",
      CHALLENGE_TOKEN_SECRET: "production-challenge-token-secret-32chars-xyz",
      USDC_ISSUER_MAINNET: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      FLUTTERWAVE_SECRET_KEY: "test-flutterwave-secret",
      FLUTTERWAVE_WEBHOOK_SECRET: "test-flutterwave-webhook-secret",
      PAYSTACK_SECRET_KEY: "test-paystack-secret",
      BILLS_WEBHOOK_SECRET: "test-bills-webhook-secret",
    };
    delete process.env.USDC_ISSUER_TESTNET;

    expect(() => require("../src/config/env")).toThrow(/USDC_ISSUER_TESTNET/);
  });

  it("throws in production when USDC_ISSUER_MAINNET is missing", () => {
    process.env = {
      ...ORIGINAL,
      ...REQUIRED_ENV,
      NODE_ENV: "production",
      S3_SCAN_WEBHOOK_SECRET: "super-secret-value",
      CHALLENGE_TOKEN_SECRET: "production-challenge-token-secret-32chars-xyz",
      USDC_ISSUER_TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      FLUTTERWAVE_SECRET_KEY: "test-flutterwave-secret",
      FLUTTERWAVE_WEBHOOK_SECRET: "test-flutterwave-webhook-secret",
      PAYSTACK_SECRET_KEY: "test-paystack-secret",
      BILLS_WEBHOOK_SECRET: "test-bills-webhook-secret",
    };
    delete process.env.USDC_ISSUER_MAINNET;

    expect(() => require("../src/config/env")).toThrow(/USDC_ISSUER_MAINNET/);
  });

  it("loads in production when USDC issuers are configured", () => {
    process.env = {
      ...ORIGINAL,
      ...REQUIRED_ENV,
      NODE_ENV: "production",
      S3_SCAN_WEBHOOK_SECRET: "super-secret-value",
      CHALLENGE_TOKEN_SECRET: "production-challenge-token-secret-32chars-xyz",
      USDC_ISSUER_TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      USDC_ISSUER_MAINNET: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      FLUTTERWAVE_SECRET_KEY: "test-flutterwave-secret",
      FLUTTERWAVE_WEBHOOK_SECRET: "test-flutterwave-webhook-secret",
      PAYSTACK_SECRET_KEY: "test-paystack-secret",
      BILLS_WEBHOOK_SECRET: "test-bills-webhook-secret",
    };

    const { config } = require("../src/config/env");
    expect(config.stellar.usdcIssuerTestnet).toBe(
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    );
    expect(config.stellar.usdcIssuerMainnet).toBe(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );
  });

  // AB-024: PII_ENCRYPTION_KEY enforcement
  // Note: the production boot guard uses !isJestTest so it does not fire during
  // Jest runs (by design — same pattern as all other production guards in env.ts).
  // These tests therefore validate the Zod schema layer (format/length) and the
  // config export value rather than the imperative guard itself.

  it("rejects a PII_ENCRYPTION_KEY that is too short (AB-024)", () => {
    process.env.PII_ENCRYPTION_KEY = "abc123"; // only 6 chars, must be 64
    expect(() => require("../src/config/env")).toThrow(/PII_ENCRYPTION_KEY/);
  });

  it("rejects a PII_ENCRYPTION_KEY that contains non-hex characters (AB-024)", () => {
    process.env.PII_ENCRYPTION_KEY = "z".repeat(64); // 'z' is not hex
    expect(() => require("../src/config/env")).toThrow(/PII_ENCRYPTION_KEY/);
  });

  it("accepts a valid 64-char hex PII_ENCRYPTION_KEY and exposes it on config (AB-024)", () => {
    const validKey = "a".repeat(64); // 64 × 'a' = valid lowercase hex
    process.env.PII_ENCRYPTION_KEY = validKey;
    const { config } = require("../src/config/env");
    expect(config.piiEncryptionKey).toBe(validKey);
  });

  it("allows PII_ENCRYPTION_KEY to be absent in development (AB-024)", () => {
    process.env = { ...ORIGINAL, ...REQUIRED_ENV, NODE_ENV: "development" };
    delete process.env.PII_ENCRYPTION_KEY;
    const { config } = require("../src/config/env");
    expect(config.piiEncryptionKey).toBeUndefined();
  });

  // AB-052 (#1002): the Stellar fee knobs were read by `config.stellar.*` but
  // never declared in the Zod schema, so Zod stripped them and every consumer
  // saw `undefined` — `getBaseFee()` returned the string "undefined" and the
  // transaction builder threw "[BigNumber Error] Not a number: undefined".
  // Declaring them here is what makes the documented defaults real.
  describe("Stellar fee configuration (AB-052)", () => {
    const FEE_VARS = [
      "STELLAR_BASE_FEE_STROOPS",
      "STELLAR_USE_DYNAMIC_FEES",
      "STELLAR_SOROBAN_MIN_FEE_STROOPS",
      "STELLAR_SOROBAN_MAX_FEE_STROOPS",
      "STELLAR_FEE_SURGE_BUFFER_BPS",
      "STELLAR_MAX_PAYMENT_FEE_STROOPS",
    ];

    it("exposes numeric fee defaults instead of undefined when unset", () => {
      FEE_VARS.forEach((key) => delete process.env[key]);

      const { config } = require("../src/config/env");
      expect(config.stellar.baseFeeStroops).toBe(100);
      expect(config.stellar.useDynamicFees).toBe(false);
      expect(config.stellar.sorobanMinFeeStroops).toBe(5000);
      expect(config.stellar.sorobanMaxFeeStroops).toBe(10_000_000);
      expect(config.stellar.feeSurgeBufferBps).toBe(2000);
      expect(config.stellar.maxPaymentFeeStroops).toBe(1_000_000);
    });

    it("coerces fee values supplied as env strings", () => {
      process.env.STELLAR_BASE_FEE_STROOPS = "250";
      process.env.STELLAR_FEE_SURGE_BUFFER_BPS = "5000";
      process.env.STELLAR_MAX_PAYMENT_FEE_STROOPS = "250000";
      process.env.STELLAR_USE_DYNAMIC_FEES = "true";

      const { config } = require("../src/config/env");
      expect(config.stellar.baseFeeStroops).toBe(250);
      expect(config.stellar.feeSurgeBufferBps).toBe(5000);
      expect(config.stellar.maxPaymentFeeStroops).toBe(250000);
      expect(config.stellar.useDynamicFees).toBe(true);
    });

    it("rejects a non-positive base fee rather than silently pricing at zero", () => {
      process.env.STELLAR_BASE_FEE_STROOPS = "0";
      expect(() => require("../src/config/env")).toThrow(/STELLAR_BASE_FEE_STROOPS/);
    });

    it("rejects a negative surge buffer", () => {
      process.env.STELLAR_FEE_SURGE_BUFFER_BPS = "-1";
      expect(() => require("../src/config/env")).toThrow(/STELLAR_FEE_SURGE_BUFFER_BPS/);
    });

    it("rejects a surge buffer above 100%", () => {
      process.env.STELLAR_FEE_SURGE_BUFFER_BPS = "10001";
      expect(() => require("../src/config/env")).toThrow(/STELLAR_FEE_SURGE_BUFFER_BPS/);
    });

    it("rejects a non-boolean STELLAR_USE_DYNAMIC_FEES", () => {
      process.env.STELLAR_USE_DYNAMIC_FEES = "yes-please";
      expect(() => require("../src/config/env")).toThrow(/STELLAR_USE_DYNAMIC_FEES/);
    });
  });
});
