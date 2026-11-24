/// <reference types="node" />
// Set required environment variables before any module loads.
// In CI these are already set via workflow env; this provides safe
// fallbacks for local runs so env.ts validation does not throw.
//
// NOTE: These values unconditionally override any shell/container env so that
// dev-only placeholder values (e.g. JWT_SECRET=dev-jwt-secret-change-me) never
// cause env.ts validation failures in tests (#720).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/acbu_test";
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/acbu_test";
process.env.RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
// Always use a known-good test secret — length ≥ 32 and not a production placeholder.
process.env.JWT_SECRET = "test-jwt-secret-for-automated-tests-only-not-for-prod";
process.env.API_KEY_SALT = process.env.API_KEY_SALT || "test-api-key-salt";
process.env.FLUTTERWAVE_WEBHOOK_SECRET =
  process.env.FLUTTERWAVE_WEBHOOK_SECRET || "test-fw-webhook-secret";
process.env.PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY || "test-ps-secret-key";
process.env.BILLS_WEBHOOK_SECRET =
  process.env.BILLS_WEBHOOK_SECRET || "test-bills-webhook-secret";
// Stellar USDC issuer addresses — required by env.ts validation (#720).
// These are the well-known public issuer addresses (not secret keys).
process.env.USDC_ISSUER_TESTNET =
  process.env.USDC_ISSUER_TESTNET ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
process.env.USDC_ISSUER_MAINNET =
  process.env.USDC_ISSUER_MAINNET ||
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
// Required by env.ts nativeAssetCode IIFE — prevents TypeError when
// TESTNET_CUSTODIAL_BOOTSTRAP is not present in the test environment.
process.env.TESTNET_CUSTODIAL_BOOTSTRAP =
  process.env.TESTNET_CUSTODIAL_BOOTSTRAP || "xlm";
process.env.STELLAR_HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";

