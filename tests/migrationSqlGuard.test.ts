/**
 * Migration SQL guard tests (#755).
 *
 * Guards against the two known-broken migration patterns that blocked
 * `prisma migrate deploy` on a clean database:
 * 1. MIN/MAX/SUM/AVG aggregates applied directly to UUID columns
 *    (Postgres has no min(uuid) — SQLSTATE 42883 / P3018).
 * 2. `stellar_address` referenced against the `users` table (the real
 *    column is "stellarAddress").
 */
const {
  getUuidIdentifiers,
  findUuidAggregates,
  findUsersStellarAddressSnakeCase,
  collectFindings,
  scanMigrations,
} = require("../scripts/ci/check-migration-sql");

describe("getUuidIdentifiers", () => {
  it("collects plain and @map-ed uuid fields from schema.prisma", () => {
    const ids = getUuidIdentifiers(`
      model User {
        id       String   @id @default(uuid()) @db.Uuid
        userId   String   @map("user_id") @db.Uuid
        currency String   @db.VarChar(3)
        stars    Int      @db.Integer
      }
    `);

    expect(ids.has("id")).toBe(true);
    expect(ids.has("userId")).toBe(true);
    expect(ids.has("user_id")).toBe(true);
    expect(ids.has("currency")).toBe(false);
    expect(ids.has("stars")).toBe(false);
  });
});

describe("findUuidAggregates", () => {
  const uuidIdentifiers = getUuidIdentifiers(`
    model Transaction {
      id       String   @id @default(uuid()) @db.Uuid
      userId   String   @map("user_id") @db.Uuid
      amount   Decimal  @db.Decimal(20, 8)
    }
  `);

  it("flags MIN/MAX/SUM/AVG on a plain uuid column", () => {
    const findings = findUuidAggregates(
      'DELETE FROM "transactions" t WHERE id NOT IN (SELECT MIN(id) FROM "transactions");',
      uuidIdentifiers,
    );

    expect(findings).toEqual([
      expect.objectContaining({
        kind: "AGGREGATE_ON_UUID",
        aggregate: "MIN",
        column: "id",
      }),
    ]);
  });

  it("flags aggregates on quoted and table-qualified uuid columns", () => {
    const findings = findUuidAggregates(
      'SELECT MAX("user_id") FROM t; SELECT SUM(t.userId) FROM t; SELECT AVG(t."audit_id") FROM t;',
      uuidIdentifiers,
    );

    expect(findings.map((f: { column: string }) => f.column)).toEqual(["user_id", "userId"]);
  });

  it("ignores aggregates on non-uuid columns and COUNT", () => {
    const findings = findUuidAggregates(
      "SELECT MIN(amount) FROM t; SELECT MAX(created_at) FROM t; SELECT COUNT(id) FROM t;",
      uuidIdentifiers,
    );

    expect(findings).toEqual([]);
  });

  it("ignores aggregates with an explicit cast (safe form)", () => {
    const findings = findUuidAggregates(
      'SELECT MIN(id::text) FROM "transactions";',
      uuidIdentifiers,
    );

    expect(findings).toEqual([]);
  });
});

describe("findUsersStellarAddressSnakeCase", () => {
  it("flags stellar_address used against the users table", () => {
    const findings = findUsersStellarAddressSnakeCase(`
      SELECT COUNT(*) FROM users
      WHERE stellar_address IS NOT NULL AND LENGTH(stellar_address) != 56;
    `);

    expect(findings).toEqual([
      expect.objectContaining({
        kind: "USERS_STELLAR_ADDRESS_SNAKE_CASE",
        column: "stellar_address",
      }),
    ]);
  });

  it("does not flag the valid on_ramp_swaps.stellar_address column", () => {
    const findings = findUsersStellarAddressSnakeCase(`
      CREATE TABLE "on_ramp_swaps" (
        "id" UUID NOT NULL,
        "stellar_address" VARCHAR(56) NOT NULL
      );
    `);

    expect(findings).toEqual([]);
  });

  it("does not flag the correct camelCase users column", () => {
    const findings = findUsersStellarAddressSnakeCase(`
      ALTER TABLE users
      ADD CONSTRAINT chk_valid_stellar_address
      CHECK ("stellarAddress" IS NULL OR LENGTH("stellarAddress") = 56);
    `);

    expect(findings).toEqual([]);
  });
});

describe("collectFindings", () => {
  it("detects both broken patterns in one migration file", () => {
    const findings = collectFindings(`
      DELETE FROM "transactions" t WHERE id NOT IN (
        SELECT MIN(id) FROM "transactions"
      );
      ALTER TABLE users ADD CONSTRAINT c CHECK (
        "stellarAddress" IS NULL OR LENGTH(stellar_address) = 56
      );
    `);

    expect(findings.map((f: { kind: string }) => f.kind)).toEqual([
      "AGGREGATE_ON_UUID",
      "USERS_STELLAR_ADDRESS_SNAKE_CASE",
    ]);
  });
});

describe("scanMigrations (real repo files)", () => {
  it("finds no broken patterns in the current migration history", () => {
    const findings = scanMigrations();

    expect(findings).toEqual([]);
  });
});

describe("Prisma localAmount precision", () => {
  it("uses sub-cent precision for persisted local currency amounts", () => {
    const fs = require("fs");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");

    expect(schema).toMatch(/localAmount\s+Decimal\?\s+@map\("local_amount"\)\s+@db\.Decimal\(20,\s*8\)/);
  });
});
