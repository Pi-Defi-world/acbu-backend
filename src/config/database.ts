import { PrismaClient, Prisma } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { config } from "./env";
import { logger } from "./logger";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { poolAcquireHistogram, poolExhaustedCounter } from "./promMetrics";

function buildPrismaClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: [
      { level: "query", emit: "event" },
      { level: "error", emit: "stdout" },
      { level: "warn", emit: "stdout" },
    ],
  });
}

function applyPrismaClientMiddleware(client: PrismaClient): void {
  client.$use(async (params: Prisma.MiddlewareParams, next: any) => {
    const tracer = trace.getTracer("prisma");
    const spanName = `prisma.${params.model ?? "raw"}.${params.action}`;
    return tracer.startActiveSpan(spanName, async (span) => {
      span.setAttributes({
        "db.system": "postgresql",
        "db.operation": params.action,
        ...(params.model ? { "db.prisma.model": params.model } : {}),
      });
      try {
        const result = await next(params);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    });
  });

  client.$use(async (params: Prisma.MiddlewareParams, next: any) => {
    const end = poolAcquireHistogram.startTimer({
      model: params.model ?? "raw",
      action: params.action,
    });
    try {
      return await next(params);
    } finally {
      end();
    }
  });

  client.$use(async (params: Prisma.MiddlewareParams, next: any) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await next(params);
      } catch (err) {
        if (!isPoolExhaustionError(err)) {
          throw err;
        }
        poolExhaustedCounter.inc();
        if (attempt < MAX_RETRIES) {
          lastError = err;
          const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
          logger.warn("Prisma connection pool exhausted, retrying", {
            model: params.model,
            action: params.action,
            attempt,
            maxRetries: MAX_RETRIES,
            backoffMs: backoff,
          });
        },
      },
    },
  });
}

// Remove the old middleware application function
// function applyPrismaClientMiddleware(client: PrismaClient): void { ... }

// Retry config for connection pool exhaustion (Prisma Accelerate)
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

// B-056: Validate URL assignments at boot to prevent runtime/migration confusion.
// DATABASE_URL  → direct PostgreSQL only (used by prisma migrate)
// PRISMA_ACCELERATE_URL → prisma:// or prisma+postgres:// protocol (runtime connection pooling)
const ACCELERATE_PROTOCOL_RE = /^prisma(\+postgres)?:\/\//i;

if (ACCELERATE_PROTOCOL_RE.test(config.databaseUrl)) {
  throw new Error(
    "[database] DATABASE_URL must be a direct PostgreSQL connection string " +
      "(postgresql:// or postgres://). " +
      "An Accelerate URL (prisma://) was detected — " +
      "set that value in PRISMA_ACCELERATE_URL instead. " +
      "Using Accelerate for migrations will fail.",
  );
}

if (config.prismaAccelerateUrl && !ACCELERATE_PROTOCOL_RE.test(config.prismaAccelerateUrl)) {
  logger.warn(
    "[database] PRISMA_ACCELERATE_URL does not start with prisma:// — " +
      "expected an Accelerate connection string. " +
      "If you intended a direct URL, set DATABASE_URL and leave PRISMA_ACCELERATE_URL unset.",
  );
}

// #386: When routing through Prisma Accelerate, the proxy enforces its own
// query timeout (default 10 s, configurable via ACCELERATE_QUERY_TIMEOUT_MS in
// the Accelerate dashboard).  If Accelerate cancels a query before PostgreSQL
// does, the backend process keeps running — possibly inside an open transaction —
// draining connection slots.
//
// Fix: inject `options=--statement_timeout=<ms>` into the *direct* DATABASE_URL
// (used for health probes and migrations) so PostgreSQL cancels the statement
// itself just before Accelerate would.  The direct URL is not used for runtime
// traffic when Accelerate is active, but this keeps the timeout in sync for
// anything that bypasses the proxy (e.g. migration runner, health checks).
//
// For runtime traffic through Accelerate, keep ACCELERATE_QUERY_TIMEOUT_MS in
// the Accelerate dashboard ≥ 10 000 ms and ensure your slowest query completes
// within that window.
function appendStatementTimeout(url: string, timeoutMs: number): string {
  try {
    const u = new URL(url);
    // `options` is a libpq connection parameter; encode the leading `--`
    u.searchParams.set("options", `--statement_timeout=${timeoutMs}`);
    return u.toString();
  } catch {
    // Malformed URL — leave untouched; boot validation above already caught this
    return url;
  }
}

function resolveDatabaseUrls(): { runtimeUrl: string; replicaUrl: string; useAccelerate: boolean } {
  const configuredDatabaseUrl = process.env.DATABASE_URL || config.databaseUrl;
  const configuredAccelerateUrl = process.env.PRISMA_ACCELERATE_URL || config.prismaAccelerateUrl;
  const configuredReplicaUrl = process.env.DATABASE_URL_REPLICA || config.databaseUrlReplica || "";

  const latestStatementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? "9000", 10);
  const useAccelerate = Boolean(configuredAccelerateUrl);
  const runtimeUrl = useAccelerate
    ? configuredAccelerateUrl!
    : appendStatementTimeout(configuredDatabaseUrl, latestStatementTimeoutMs);
  const replicaUrl = configuredReplicaUrl || runtimeUrl;

  return { runtimeUrl, replicaUrl, useAccelerate };
}

let basePrisma: PrismaClient = buildPrismaClient(resolveDatabaseUrls().runtimeUrl);
let basePrismaReplica: PrismaClient = buildPrismaClient(resolveDatabaseUrls().replicaUrl);
let currentRuntimeUrl = resolveDatabaseUrls().runtimeUrl;
let currentReplicaUrl = resolveDatabaseUrls().replicaUrl;
let currentUseAccelerate = resolveDatabaseUrls().useAccelerate;

// Create the extension instance
const prismaExtension = createPrismaExtension();

/**
 * Applies the tracing/retry extension (and Accelerate, when enabled) to a
 * base client.
 *
 * Each `$extends()` call produces a new, more deeply nested generic type;
 * chaining two of them inline (tracing extension + Accelerate) makes
 * TypeScript's structural inference blow up with "Type instantiation is
 * excessively deep and possibly infinite" (TS2589). None of our extensions
 * change the client's public model-delegate surface, so it's safe to erase
 * back to the plain `PrismaClient` type at this function boundary — casting
 * through `unknown` here (rather than inline at each call site) keeps that
 * single documented escape hatch in one place instead of scattered casts.
 */
function withExtensions(client: PrismaClient, useAccelerate: boolean): PrismaClient {
  // Cast back to PrismaClient immediately after each $extends() call (rather
  // than once at the end) so the *next* $extends() operates on the plain
  // type instead of compounding an already-deep generic instantiation.
  const extended = client.$extends(prismaExtension) as unknown as PrismaClient;
  if (!useAccelerate) {
    return extended;
  }
  return extended.$extends(withAccelerate()) as unknown as PrismaClient;
}

logger.info(
  `[database] Runtime connection: ${currentUseAccelerate ? "Prisma Accelerate (pooled)" : "direct PostgreSQL"}`,
);
logger.info(
  "[database] Migration connection: direct PostgreSQL via DATABASE_URL " +
    "(run prisma migrate against DATABASE_URL, never against PRISMA_ACCELERATE_URL)",
);

function isPoolExhaustionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2024";
  }
  return false;
}

function refreshPrismaClientsIfNeeded(): void {
  const resolved = resolveDatabaseUrls();
  if (
    resolved.runtimeUrl === currentRuntimeUrl &&
    resolved.replicaUrl === currentReplicaUrl &&
    resolved.useAccelerate === currentUseAccelerate
  ) {
    return;
  }

  logger.info("[database] Refreshing Prisma clients with updated connection settings", {
    runtimeUrl: resolved.runtimeUrl,
    replicaUrl: resolved.replicaUrl,
    useAccelerate: resolved.useAccelerate,
  });

  const previousBasePrisma = basePrisma;
  const previousReplicaPrisma = basePrismaReplica;

  basePrisma = buildPrismaClient(resolved.runtimeUrl);
  basePrismaReplica = buildPrismaClient(resolved.replicaUrl);
  currentRuntimeUrl = resolved.runtimeUrl;
  currentReplicaUrl = resolved.replicaUrl;
  currentUseAccelerate = resolved.useAccelerate;

  // Note: the extension is re-applied to the refreshed base clients by the
  // caller (connectWithRetry), which also reassigns the exported `prisma` /
  // `prismaReplica` bindings — this function only needs to swap the base
  // clients and disconnect the stale ones.
  void previousBasePrisma.$disconnect().catch((err: unknown) => {
    logger.warn("[database] Failed to disconnect previous Prisma client", { error: err });
  });
  void previousReplicaPrisma.$disconnect().catch((err: unknown) => {
    logger.warn("[database] Failed to disconnect previous Prisma replica client", { error: err });
  });

  logger.info(
    `[database] Runtime connection: ${currentUseAccelerate ? "Prisma Accelerate (pooled)" : "direct PostgreSQL"}`,
  );
}

export let prisma: PrismaClient = withExtensions(basePrisma, currentUseAccelerate);
export let prismaReplica: PrismaClient = withExtensions(basePrismaReplica, currentUseAccelerate);

// Log queries in development ($on exists only on base client, not on extended proxy)
if (config.nodeEnv === "development") {
  basePrisma.$on("query" as never, (e: { query: string; params: string; duration: number }) => {
    logger.debug("Query", {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  });
  basePrismaReplica.$on(
    "query" as never,
    (e: { query: string; params: string; duration: number }) => {
      logger.debug("Query Replica", {
        query: e.query,
        params: e.params,
        duration: `${e.duration}ms`,
      });
    },
  );
}

/**
 * Establish the initial database connection with bounded exponential backoff and
 * full jitter (#402).
 *
 * After a shared outage or coordinated restart, every instance would otherwise
 * retry on the same fixed schedule and slam the database's limited connection
 * slots simultaneously — a thundering herd that triggers cascading connection
 * rejections. Full jitter (`random(0, cappedBackoff)`) spreads reconnection
 * attempts across the window so the load on connection slots is smoothed out.
 *
 * Resolves once connected; throws after the configured number of attempts is
 * exhausted so the caller can fail startup loudly.
 */
export async function connectWithRetry(): Promise<void> {
  const maxRetries = config.database.connectMaxRetries;
  const baseBackoff = config.database.connectBaseBackoffMs;
  const maxBackoff = config.database.connectMaxBackoffMs;

  // #381: WAL backup guard — refuse to start in production without confirmed WAL archiving.
  // Point-in-time recovery is impossible without WAL segments being streamed off-host.
  if (config.nodeEnv === "production" && !config.walBackup.configured) {
    throw new Error(
      "[database] WAL backup is not configured. " +
        "Set PG_WAL_BACKUP_CONFIGURED=true once WAL archiving / continuous backup is enabled " +
        "(e.g. pgBackRest, Barman, AWS RDS automated backups, Supabase PITR). " +
        "A storage failure on the primary will cause permanent data loss without WAL archives.",
    );
  }

  if (config.walBackup.configured) {
    logger.info("[database] WAL backup: configured", {
      provider: config.walBackup.provider || "unspecified",
    });
  } else {
    logger.warn("[database] WAL backup: NOT configured — point-in-time recovery unavailable");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      refreshPrismaClientsIfNeeded();
      prisma = withExtensions(basePrisma, currentUseAccelerate);
      prismaReplica = withExtensions(basePrismaReplica, currentUseAccelerate);
      await Promise.all([basePrisma.$connect(), basePrismaReplica.$connect()]);
      if (attempt > 1) {
        logger.info("[database] Connected after retry", { attempt });
      } else {
        logger.info("[database] Connected");
      }
      return;
    } catch (err) {
      // #624: always capture the error so lastError reflects the most recent
      // failure, including the final attempt that breaks out of the loop.
      lastError = err;
      if (attempt >= maxRetries) break;

      // Exponential backoff capped at maxBackoff, then full jitter in [0, cap].
      const cappedBackoff = Math.min(maxBackoff, baseBackoff * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * cappedBackoff);
      logger.warn("[database] Connection attempt failed, retrying with jitter", {
        attempt,
        maxRetries,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.error("[database] Failed to connect after exhausting retries", {
    maxRetries,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  // #624: guard against throwing undefined in the unexpected case where the loop
  // exits without ever entering the catch block (e.g. maxRetries <= 0).
  throw lastError instanceof Error
    ? lastError
    : new Error("Database connection failed after exhausting retries");
}

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await Promise.all([basePrisma.$disconnect(), basePrismaReplica.$disconnect()]);
});

export default prisma;
