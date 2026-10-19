#!/usr/bin/env ts-node
/**
 * Database Migration Rollback Utility
 *
 * Reverts applied Prisma migrations by executing the matching down.sql script
 * and recording the rollback in _prisma_migrations.
 *
 * Usage:
 *   pnpm run prisma:migrate:down             # Revert the latest applied migration
 *   pnpm run prisma:migrate:down --steps=2   # Revert the last 2 migrations
 *   pnpm run prisma:migrate:down --dry-run   # Preview rollback SQL without executing
 *   pnpm run prisma:migrate:down --target=20260924000000_fix_local_amount_precision
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");

interface AppliedMigration {
  id: string;
  migration_name: string;
  started_at: Date;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let steps = 1;
  let target: string | null = null;

  for (const arg of args) {
    if (arg.startsWith("--steps=")) {
      steps = parseInt(arg.split("=")[1], 10) || 1;
    } else if (arg.startsWith("--target=")) {
      target = arg.split("=")[1];
    }
  }

  return { dryRun, steps, target };
}

async function rollback() {
  const { dryRun, steps, target } = parseArgs();

  console.log(`[db-rollback] Initializing migration rollback (dryRun=${dryRun})...`);

  // Query applied migrations from _prisma_migrations that have not been rolled back
  const appliedMigrations = await prisma.$queryRaw<AppliedMigration[]>`
    SELECT id, migration_name, started_at, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
    ORDER BY started_at DESC;
  `;

  if (appliedMigrations.length === 0) {
    console.log("[db-rollback] No active applied migrations found in _prisma_migrations.");
    await prisma.$disconnect();
    return;
  }

  let toRollback: AppliedMigration[] = [];

  if (target) {
    const found = appliedMigrations.find((m) => m.migration_name === target);
    if (!found) {
      console.error(`[db-rollback] Error: Target migration "${target}" is not an active applied migration.`);
      await prisma.$disconnect();
      process.exit(1);
    }
    toRollback = [found];
  } else {
    toRollback = appliedMigrations.slice(0, steps);
  }

  console.log(`[db-rollback] Identified ${toRollback.length} migration(s) to roll back:`);
  for (const m of toRollback) {
    console.log(`  - ${m.migration_name} (applied ${m.started_at})`);
  }

  for (const migration of toRollback) {
    const downSqlPath = path.join(MIGRATIONS_DIR, migration.migration_name, "down.sql");

    if (!fs.existsSync(downSqlPath)) {
      console.error(`[db-rollback] Error: Missing down.sql for migration "${migration.migration_name}" at ${downSqlPath}`);
      await prisma.$disconnect();
      process.exit(1);
    }

    const downSql = fs.readFileSync(downSqlPath, "utf-8").trim();

    console.log(`\n============================================================`);
    console.log(`Rolling back: ${migration.migration_name}`);
    console.log(`SQL Script:   ${downSqlPath}`);
    console.log(`============================================================\n`);
    console.log(downSql);
    console.log(`\n------------------------------------------------------------`);

    if (dryRun) {
      console.log(`[db-rollback] DRY-RUN: Skipped execution of ${migration.migration_name}.`);
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Execute the down migration SQL
        await tx.$executeRawUnsafe(downSql);

        // Record the rollback in _prisma_migrations
        await tx.$executeRaw`
          UPDATE "_prisma_migrations"
          SET rolled_back_at = NOW()
          WHERE id = ${migration.id};
        `;
      });

      console.log(`[db-rollback] Successfully rolled back ${migration.migration_name}.`);
    } catch (error) {
      console.error(`[db-rollback] Failed to roll back ${migration.migration_name}:`, error);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  console.log("\n[db-rollback] All requested rollbacks completed successfully.");
  await prisma.$disconnect();
}

rollback().catch(async (err) => {
  console.error("[db-rollback] Fatal error during rollback:", err);
  await prisma.$disconnect();
  process.exit(1);
});
