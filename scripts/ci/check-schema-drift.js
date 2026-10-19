"use strict";

/**
 * Schema Drift & Shadow Database Guard
 *
 * Verifies that:
 * 1. All migrations in prisma/migrations/ have both migration.sql and down.sql.
 * 2. If SHADOW_DATABASE_URL is provided, runs `prisma migrate diff` to detect
 *    uncommitted schema drift between prisma/schema.prisma and migration history.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "prisma", "migrations");
const SCHEMA_PATH = path.join(__dirname, "..", "..", "prisma", "schema.prisma");

function checkDownMigrations() {
  console.log("[drift-check] Verifying forward and down migration completeness...");
  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const migrationDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const missingDown = [];
  const missingUp = [];

  for (const dir of migrationDirs) {
    const upFile = path.join(MIGRATIONS_DIR, dir, "migration.sql");
    const downFile = path.join(MIGRATIONS_DIR, dir, "down.sql");

    if (!fs.existsSync(upFile)) {
      missingUp.push(dir);
    }
    if (!fs.existsSync(downFile)) {
      missingDown.push(dir);
    }
  }

  if (missingUp.length > 0) {
    console.error(`[drift-check] Error: Migrations missing migration.sql:`, missingUp);
    process.exit(1);
  }

  if (missingDown.length > 0) {
    console.error(`[drift-check] Error: Migrations missing down.sql:`, missingDown);
    process.exit(1);
  }

  console.log(`[drift-check] OK: All ${migrationDirs.length} migrations have valid migration.sql and down.sql files.`);
}

function checkSchemaDrift() {
  const shadowUrl = process.env.SHADOW_DATABASE_URL;

  if (!shadowUrl) {
    console.log(
      "[drift-check] Notice: SHADOW_DATABASE_URL not set in environment. Skipping live shadow database diff check."
    );
    console.log("[drift-check] Set SHADOW_DATABASE_URL in CI or local environment to enable live drift detection.");
    return;
  }

  console.log("[drift-check] Checking schema drift against shadow database...");
  try {
    const output = execSync(
      `pnpm prisma migrate diff --from-schema-datamodel "${SCHEMA_PATH}" --to-migrations "${MIGRATIONS_DIR}" --shadow-database-url "${shadowUrl}" --exit-code`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log("[drift-check] OK: No drift detected between schema.prisma and migrations directory.");
  } catch (error) {
    if (error.status === 2) {
      console.error("\n[drift-check] ERROR: Database schema drift detected!");
      console.error("The Prisma schema has diverged from the migration history:");
      console.error(error.stdout || error.stderr);
      console.error("\nRun `pnpm prisma migrate dev` to generate a migration for these changes.");
      process.exit(1);
    } else {
      console.error("[drift-check] Unexpected error running prisma migrate diff:", error.stderr || error.message);
      process.exit(1);
    }
  }
}

function main() {
  checkDownMigrations();
  checkSchemaDrift();
}

main();
