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
    process.env = { ...ORIGINAL };
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
      S3_SCAN_WEBHOOK_SECRET: "change-me-in-production",
      CHALLENGE_TOKEN_SECRET: "production-challenge-token-secret-32chars-xyz",
      USDC_ISSUER_TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      USDC_ISSUER_MAINNET: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      FLUTTERWAVE_SECRET_KEY: "test-flutterwave-secret",
      FLUTTERWAVE_WEBHOOK_SECRET: "test-flutterwave-webhook-secret",
      PAYSTACK_SECRET_KEY: "test-paystack-secret",
      BILLS_WEBHOOK_SECRET: "test-bills-webhook-secret",
    };

    expect(() => require("../src/config/env")).toThrow(
      /S3_SCAN_WEBHOOK_SECRET/,
    );
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
      USDC_ISSUER_TESTNET: "",
    };

    expect(() => require("../src/config/env")).toThrow(
      /USDC_ISSUER_TESTNET/,
    );
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
      USDC_ISSUER_MAINNET: "",
    };

    expect(() => require("../src/config/env")).toThrow(
      /USDC_ISSUER_MAINNET/,
    );
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
});
