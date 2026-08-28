// Defaults for CI and local `pnpm test` when .env is absent.
// Must match .github/workflows/ci.yml postgres service (POSTGRES_USER/PASSWORD).
process.env.DATABASE_URL ||= "postgresql://postgres:postgres@localhost:5432/acbu_test";
process.env.MONGODB_URI ||= "mongodb://localhost:27017/acbu_test";
process.env.RABBITMQ_URL ||= "amqp://guest:guest@localhost:5672";
process.env.JWT_SECRET ||= "test-jwt-secret-for-ci";
process.env.API_KEY_SALT ||= "test-api-key-salt";

// Disconnect Prisma after the entire test suite to prevent open handles.
// Guard against test files that mock the database module (in which case prisma
// may be undefined or lack $disconnect), and against environments where the
// real database module cannot be loaded (missing env vars, etc.).
afterAll(async () => {
  try {
    const { prisma } = await import("../src/config/database");
    if (prisma && typeof prisma.$disconnect === "function") {
      await prisma.$disconnect();
    }
  } catch {
    // Silently ignore errors — this is a best-effort teardown.
    // Tests that mock the database module or run in restricted environments
    // may not be able to load the real database module here.
  }
});
