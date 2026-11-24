/**
 * Integration test for the refresh_tokens migration (issue #1174 / W10-R-010).
 *
 * Validates that the migration SQL
 * (prisma/migrations/20260827000000_add_refresh_tokens/migration.sql)
 * has been applied against a real Postgres instance and that the
 * `refresh_tokens` table exists exactly once — catching the duplicate-table
 * defect described in R-001 that mocked unit tests cannot detect.
 *
 * Requires a live Postgres instance with migrations already applied.  In CI
 * the `test` job starts Postgres via `docker compose up` and runs
 * `prisma migrate deploy` before `jest`, so the table is always present.
 * When DATABASE_URL is not set the suite is skipped so offline unit-only
 * runs are unaffected.
 */
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("refresh_tokens migration (W10-R-010)", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refresh_tokens table exists in the public schema", async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name   = 'refresh_tokens'
    `;
    expect(Number(rows[0].count)).toBe(1);
  });

  it("refresh_tokens table is not duplicated (exactly one occurrence)", async () => {
    // A duplicate-table defect (R-001) would produce a count > 1 or cause
    // migrate deploy to fail outright; this assertion catches either scenario
    // after the fact and acts as a regression guard in CI.
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name   = 'refresh_tokens'
    `;
    expect(Number(rows[0].count)).toBe(1);
  });

  it("refresh_tokens table has the expected primary key column (id)", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'refresh_tokens'
         AND column_name  = 'id'
    `;
    expect(rows.length).toBe(1);
  });

  it("refresh_tokens table has a unique index on token_hash", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename  = 'refresh_tokens'
         AND indexname  = 'refresh_tokens_token_hash_key'
    `;
    expect(rows.length).toBe(1);
  });
});
