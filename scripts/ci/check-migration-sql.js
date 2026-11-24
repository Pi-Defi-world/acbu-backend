"use strict";

/**
 * Static guard against known-broken SQL patterns in Prisma migrations.
 *
 * Current checks (#755):
 * 1. AGGREGATE_ON_UUID — MIN/MAX/SUM/AVG called directly on a UUID column.
 *    PostgreSQL has no min(uuid)/max(uuid) aggregate (SQLSTATE 42883, P3018),
 *    so e.g. `SELECT MIN(id) FROM "transactions"` makes `prisma migrate deploy`
 *    fail and blocks every migration after it. Cast to text first
 *    (`MIN(id::text)`) or rewrite with a window function.
 * 2. USERS_STELLAR_ADDRESS_SNAKE_CASE — `stellar_address` referenced against the
 *    `users` table. The column is `"stellarAddress"` (camelCase); `users` has no
 *    snake_case column. (on_ramp_swaps.stellar_address is a different, valid
 *    column and is not flagged.)
 */

const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_ROOT = path.join(__dirname, "..", "..", "prisma", "migrations");
const SCHEMA_PATH = path.join(__dirname, "..", "..", "prisma", "schema.prisma");
const MAX_STATEMENT_LENGTH = 220;

// MIN/MAX/SUM/AVG over a (possibly quoted / table-qualified) bare column reference.
// Casts like MIN(id::text) do NOT match because the argument continues past the column name.
const AGGREGATE_RE =
  /\b(MIN|MAX|SUM|AVG)\s*\(\s*(?:"?[A-Za-z_]\w*"?\s*\.\s*)?"?([A-Za-z_]\w*)"?\s*\)/gi;

const STELLAR_ADDRESS_SNAKE_RE = /\bstellar_address\b/i;

// Table-reference contexts that indicate `users` is the target table.
const USERS_TABLE_RE = /\b(?:FROM|INTO|UPDATE|TABLE)\s+"?users"?\b/i;

function truncateStatement(statement) {
  const compact = statement.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_STATEMENT_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_STATEMENT_LENGTH - 3)}...`;
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => (statement.endsWith(";") ? statement : `${statement};`));
}

/**
 * Remove SQL comments (dash-dash line comments and slash-star ... star-slash
 * blocks) so the guards analyze executable statements only, not explanatory
 * text.
 */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/**
 * Collect every identifier that maps to a UUID column in schema.prisma:
 * the Prisma field name and its @map("...") column name (when present).
 */
function getUuidIdentifiers(schemaSql) {
  const identifiers = new Set();
  for (const line of schemaSql.split("\n")) {
    if (!/@db\.Uuid/.test(line)) {
      continue;
    }
    const fieldMatch = /^\s*([A-Za-z_]\w*)/.exec(line);
    if (fieldMatch) {
      identifiers.add(fieldMatch[1]);
    }
    const mapMatch = /@map\("([^"]+)"\)/.exec(line);
    if (mapMatch) {
      identifiers.add(mapMatch[1]);
    }
  }
  return identifiers;
}

function findUuidAggregates(sql, uuidIdentifiers) {
  const findings = [];
  let match;
  while ((match = AGGREGATE_RE.exec(sql)) !== null) {
    const column = match[2];
    if (uuidIdentifiers.has(column)) {
      findings.push({
        kind: "AGGREGATE_ON_UUID",
        aggregate: match[1].toUpperCase(),
        column,
        statement: truncateStatement(match[0]),
      });
    }
  }
  return findings;
}

function findUsersStellarAddressSnakeCase(sql) {
  const findings = [];
  for (const statement of splitSqlStatements(sql)) {
    if (!USERS_TABLE_RE.test(statement)) {
      continue;
    }
    if (STELLAR_ADDRESS_SNAKE_RE.test(statement)) {
      findings.push({
        kind: "USERS_STELLAR_ADDRESS_SNAKE_CASE",
        column: "stellar_address",
        statement: truncateStatement(statement),
      });
    }
  }
  return findings;
}

function collectFindings(migrationSql) {
  const uuidIdentifiers = getUuidIdentifiers(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const executableSql = stripSqlComments(migrationSql);
  return [
    ...findUuidAggregates(executableSql, uuidIdentifiers),
    ...findUsersStellarAddressSnakeCase(executableSql),
  ];
}

function getAllMigrationFiles(root = MIGRATIONS_ROOT) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...getAllMigrationFiles(path.join(root, entry.name)));
    } else if (entry.name.endsWith(".sql")) {
      files.push(path.join(root, entry.name));
    }
  }
  return files;
}

function scanMigrations(root = MIGRATIONS_ROOT) {
  const findings = [];
  for (const file of getAllMigrationFiles(root)) {
    const sql = fs.readFileSync(file, "utf8");
    const fileFindings = collectFindings(sql);
    for (const finding of fileFindings) {
      findings.push({
        source: path.relative(path.join(root, "..", ".."), file),
        ...finding,
      });
    }
  }
  return findings;
}

function formatFinding(finding) {
  return `- [${finding.source}] ${finding.kind} (${finding.aggregate ?? ""}${finding.aggregate ? "(" : ""}${finding.column}${finding.aggregate ? ")" : ""}): ${finding.statement}`;
}

function main() {
  const findings = scanMigrations();
  if (findings.length === 0) {
    console.log("No broken migration SQL patterns detected.");
    return;
  }
  console.error("Broken migration SQL patterns detected:");
  for (const finding of findings) {
    console.error(formatFinding(finding));
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  getUuidIdentifiers,
  findUuidAggregates,
  findUsersStellarAddressSnakeCase,
  stripSqlComments,
  collectFindings,
  getAllMigrationFiles,
  scanMigrations,
  splitSqlStatements,
};
