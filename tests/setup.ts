/// <reference types="node" />
// Set required environment variables before any module loads.
// In CI these are already set via workflow env; this provides safe
// fallbacks for local runs so env.ts validation does not throw.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://localhost:5432/acbu_test";
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/acbu_test";
process.env.RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.FLUTTERWAVE_WEBHOOK_SECRET =
  process.env.FLUTTERWAVE_WEBHOOK_SECRET || "test-fw-webhook-secret";
process.env.PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY || "test-ps-secret-key";
