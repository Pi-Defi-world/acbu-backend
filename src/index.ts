// Load environment variables first (handles dotenv loading with proper order)
import "./config/env";

import { initTracing } from "./config/tracing";
initTracing();

import "express-async-errors";

import { execSync } from "child_process";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import compression from "compression";
import swaggerUi from "swagger-ui-express";
import { config } from "./config/env";
import { logger } from "./config/logger";
import { connectMongoDB, disconnectMongoDB } from "./config/mongodb";
import { connectRabbitMQ, disconnectRabbitMQ } from "./config/rabbitmq";
import { prisma, connectWithRetry } from "./config/database";
import { corsMiddleware } from "./middleware/cors";
import { correlationMiddleware } from "./middleware/correlation";
import { requestLogger } from "./middleware/requestLogger";
import { requestMetricsMiddleware } from "./middleware/metrics";
import { errorHandler, AppError } from "./middleware/errorHandler";
import { standardRateLimiter } from "./middleware/rateLimiter";
import { userAgentFilter } from "./middleware/userAgentFilter";
import { swaggerSpec } from "./config/swagger";
import routes from "./routes";
import webhookRoutes from "./routes/webhookRoutes";
import { ErrorCodes } from "./types/errorCodes";
import { registerGracefulShutdown, setHttpServer, setMemoryMonitorHandle } from "./gracefulShutdown";
import { startMemoryMonitor } from "./utils/memoryMonitor";

const app: express.Express = express();

// Parse trust proxy hop count safely from environment variables (Default to 0 for local development)
const trustProxyValue = process.env.TRUST_PROXY
  ? isNaN(Number(process.env.TRUST_PROXY))
    ? process.env.TRUST_PROXY
    : Number(process.env.TRUST_PROXY)
  : 0;

app.set("trust proxy", trustProxyValue);
app.set("case sensitive routing", true);

const MAX_REQUEST_BODY_SIZE = "1mb";
const SUPPORTED_REQUEST_ENCODINGS = new Set(["identity", "gzip"]);

function normalizeContentEncoding(req: Request): string {
  const header = req.headers["content-encoding"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value || "identity").trim().toLowerCase() || "identity";
}

function validateRequestContentEncoding(req: Request, _res: Response, next: NextFunction): void {
  const encoding = normalizeContentEncoding(req);

  if (!SUPPORTED_REQUEST_ENCODINGS.has(encoding)) {
    return next(
      new AppError(
        "Unsupported Content-Encoding. Use identity or gzip.",
        415,
        "UNSUPPORTED_CONTENT_ENCODING",
      ),
    );
  }

  next();
}

/**
 * Middleware to block GraphQL-like queries and introspection attempts
 * to prevent attackers from probing the API schema.
 */
function blockGraphQLQueries(req: Request, _res: Response, next: NextFunction): void {
  const path = req.path.toLowerCase();
  const contentType = req.headers["content-type"]?.toLowerCase() || "";

  // Block common GraphQL paths
  const graphqlPaths = ["/graphql", "/graphiql", "/playground", "/graphql/playground", "/v1/graphql"];
  if (graphqlPaths.includes(path)) {
    logger.warn("Blocked GraphQL endpoint access attempt", {
      path: req.path,
      ip: req.ip,
      method: req.method,
    });
    throw new AppError("Not found", 404, ErrorCodes.NOT_FOUND);
  }

  // Block introspection queries in request body (JSON)
  if (req.method === "POST" && contentType.includes("application/json") && req.body) {
    const bodyStr = JSON.stringify(req.body).toLowerCase();
    // Check for GraphQL introspection patterns (even if someone tries to POST to a REST endpoint)
    if (bodyStr.includes("__schema") || bodyStr.includes("__type") || bodyStr.includes("introspection")) {
      logger.warn("Blocked GraphQL introspection attempt", {
        path: req.path,
        ip: req.ip,
        method: req.method,
      });
      throw new AppError("Invalid request", 400, ErrorCodes.BAD_REQUEST);
    }
  }

  // Block query parameters with GraphQL-like patterns
  const query = req.query;
  if (query && typeof query === "object") {
    const queryStr = JSON.stringify(query).toLowerCase();
    if (queryStr.includes("__schema") || queryStr.includes("__type") || queryStr.includes("introspection")) {
      logger.warn("Blocked GraphQL introspection via query params", {
        path: req.path,
        ip: req.ip,
        method: req.method,
      });
      throw new AppError("Invalid request", 400, ErrorCodes.BAD_REQUEST);
    }
  }

  next();
}

function assertPrismaMigrationHistoryReplicated(): void {
  if (
    config.nodeEnv === "production" &&
    !config.prismaMigrationHistory.replicated
  ) {
    throw new Error(
      "Prisma migration history replication is not configured. Set PRISMA_MIGRATION_HISTORY_REPLICATED=true only after verifying _prisma_migrations is replicated to failover targets.",
    );
  }
}

// Security middleware
app.use(
  helmet({
    // Enable DNS prefetch when a CDN is configured so browsers can resolve
    // the CDN domain early, avoiding extra round-trip latency on every load.
    // When no CDN is in use, keep it off (default) to prevent information leakage.
    dnsPrefetchControl: { allow: !!config.cdnUrl },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https://validator.swagger.io"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https:"],
      },
    },
  }),
);
app.use(corsMiddleware);

// Block GraphQL attempts early in the middleware chain
app.use(blockGraphQLQueries);

// Compress all JSON/text responses to reduce bandwidth on large payloads
app.use(compression());

// Validate and explicitly enable request body inflation for gzip-compressed clients (#409).
app.use(validateRequestContentEncoding);
app.use(express.urlencoded({ extended: true, inflate: true, limit: MAX_REQUEST_BODY_SIZE }));

// ── Webhook Content-Type validation ────────────────────────────────────────────
// Must check Content-Type BEFORE raw body parser, since non-JSON bodies would
// bypass parsing and cause unexpected behavior in signature verification.
function validateWebhookContentType(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    return next(new AppError("Content-Type must be application/json", 415, "INVALID_CONTENT_TYPE"));
  }
  next();
}

// Webhooks need raw body for signature verification; mount before the generic JSON parser.
app.use(
  `/${config.apiVersion}/webhooks`,
  validateWebhookContentType,
  express.json({
    inflate: true,
    limit: MAX_REQUEST_BODY_SIZE,
    type: "application/json",
    verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
  webhookRoutes,
);
app.use(
  express.json({
    inflate: true,
    limit: MAX_REQUEST_BODY_SIZE,
    verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

app.use(
  (
    err: Error & { type?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err?.type === "entity.too.large") {
      res.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds maximum allowed size",
        },
      });
      return;
    }
    if (err?.type === "encoding.unsupported") {
      res.status(415).json({
        error: {
          code: "UNSUPPORTED_CONTENT_ENCODING",
          message: "Unsupported request body encoding",
        },
      });
      return;
    }
    next(err);
  },
);

// Logging
app.use(correlationMiddleware);
app.use(requestLogger);
app.use(requestMetricsMiddleware);

// Rate limiting
app.use(standardRateLimiter);

// Block known scanners, credential-stuffing tools, and headless abuse scripts
app.use(userAgentFilter);

// API Documentation — disabled in production to prevent endpoint enumeration (#274)
if (config.nodeEnv !== "production") {
  // Serve swagger-ui static assets with express.static so conditional
  // requests are handled (ETag / Last-Modified). Set a short max-age to
  // allow browsers to cache assets while still respecting conditional GETs.
  // The HTML page is generated by swaggerUi.setup which references these
  // static assets under the same prefix.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const swaggerDistPath = require("swagger-ui-dist").getAbsoluteFSPath();
  app.use(
    "/api-docs",
    express.static(swaggerDistPath, {
      maxAge: "1d",
      etag: true,
      lastModified: true,
    }),
  );

  app.get("/api-docs", swaggerUi.setup(swaggerSpec));

  // Raw JSON spec for tooling / CI spec-drift checks (#292)
  app.get("/api-docs.json", (_req, res) => {
    res.json(swaggerSpec);
  });
} else {
  // In production, redirect GraphQL-like paths to 404 explicitly
  app.use(["/graphql", "/graphiql", "/playground", "/graphql/playground"], (req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  });
}

// Routes
app.use(`/api/${config.apiVersion}`, routes);

// Error handling (must be last)
app.use(errorHandler);

// Initialize connections and start server
async function startServer() {
  try {
    assertPrismaMigrationHistoryReplicated();

    // Ensures schema is in sync before accepting traffic; prevents "table does not exist" on new columns.
    logger.info("Applying Prisma migrations...");
    execSync("npx prisma migrate deploy", { stdio: "inherit" });
    logger.info("Prisma migrations applied successfully");

    // Establish the DB connection with backoff + jitter so coordinated restarts
    // don't stampede the database's connection slots (#402).
    await connectWithRetry();

    // Connect to MongoDB (optional: server starts even if unreachable or MONGODB_URI empty)
    if (config.mongodbUri) {
      try {
        await connectMongoDB();
        logger.info("MongoDB connected");
        const { ensureIdempotencyIndex } = await import("./services/idempotency/idempotencyStore");
        await ensureIdempotencyIndex();
        const { ensureJobLockIndex } = await import("./utils/jobLock");
        await ensureJobLockIndex();
      } catch (mongoError) {
        logger.warn(
          "MongoDB unavailable, continuing without cache. Set MONGODB_URI and ensure network access for cache.",
          mongoError,
        );
      }
    } else {
      logger.warn("MONGODB_URI not set; cache will be disabled.");
    }

    // Connect to RabbitMQ (optional: server starts even if unreachable or credentials invalid)
    let rabbitReady = false;
    if (config.rabbitmqUrl) {
      try {
        await connectRabbitMQ();
        logger.info("RabbitMQ connected");
        rabbitReady = true;
      } catch (rabbitError) {
        logger.warn(
          "RabbitMQ unavailable, continuing without queue-based features. Set RABBITMQ_URL and ensure broker access.",
          rabbitError,
        );
      }
    } else {
      logger.warn("RABBITMQ_URL not set; queue-based features disabled.");
    }

    if (rabbitReady) {
      // Start notification consumer (OTP_SEND + NOTIFICATIONS → email/SMS)
      const { startNotificationConsumer } = await import("./jobs/notificationConsumer");
      await startNotificationConsumer();

      // Start audit consumer (AUDIT_LOGS → database)
      const { startAuditConsumer } = await import("./jobs/auditConsumer");
      await startAuditConsumer();

      // Start outbound webhook consumer (WEBHOOKS → deliver with HMAC-SHA256)
      const { startWebhookConsumer } = await import("./jobs/webhookConsumer");
      await startWebhookConsumer();

      // Start oracle update scheduler (every 6h)
      const { startOracleUpdateScheduler } = await import("./jobs/oracleUpdateJob");
      await startOracleUpdateScheduler();

      // Start reserve tracking scheduler (every 6h)
      const { startReserveTrackingScheduler } = await import("./jobs/reserveTrackingJob");
      await startReserveTrackingScheduler();

      // Start daily rebalancing scheduler (00:00 UTC)
      const { startRebalancingScheduler } = await import("./jobs/rebalancingJob");
      await startRebalancingScheduler();

      // Start proposed basket weights scheduler (metrics → proposed weights, e.g. monthly)
      const { startProposedWeightsScheduler } = await import("./jobs/proposedWeightsJob");
      await startProposedWeightsScheduler();

      // Start USDC conversion consumer (MintEvent → basket allocation)
      const { startUsdcConversionConsumer } = await import("./jobs/usdcConversionJob");
      await startUsdcConversionConsumer();

      // Start withdrawal processing consumer (BurnEvent → fintech disbursement)
      const { startWithdrawalProcessingConsumer } = await import("./jobs/withdrawalProcessingJob");
      await startWithdrawalProcessingConsumer();

      // Start XLM→ACBU consumer (XLM deposit: sell XLM and mint ACBU to user)
      const { startXlmToAcbuConsumer } = await import("./jobs/xlmToAcbuJob");
      await startXlmToAcbuConsumer();

      // Start USDC convert-and-mint consumer (USDC deposit: convert USDC→XLM in backend, then mint)
      const { startUsdcConvertAndMintConsumer } = await import("./jobs/usdcConvertAndMintJob");
      await startUsdcConvertAndMintConsumer();

      // Investment withdrawal: mark requests available at T+24h and send notification
      const { startInvestmentWithdrawalScheduler } = await import("./jobs/investmentWithdrawalJob");
      await startInvestmentWithdrawalScheduler();

      // Start yield accrual scheduler (run once at startup to seed accruals)
      const { startYieldAccrualScheduler } = await import("./jobs/yieldAccrualJob");
      await startYieldAccrualScheduler();

      // Start weekly weight drift audit job (Monday 00:00 UTC)
      const { startWeightDriftAuditScheduler } = await import("./jobs/weightDriftAuditJob");
      await startWeightDriftAuditScheduler();

      // Salary schedule: trigger recurring salary payments
      const { startSalaryScheduleScheduler } = await import("./jobs/salaryScheduleJob");
      await startSalaryScheduleScheduler();

      // Register MintEvent/BurnEvent handlers and start Stellar event listener (runs in background)
      const { startMintEventListener } = await import("./jobs/acbu_minting_event_listener");
      await startMintEventListener();
      const { startBurnEventListener } = await import("./jobs/acbu_burning_event_listener");
      await startBurnEventListener();
      const { startSavingsVaultEventListener } =
        await import("./jobs/acbu_savings_vault_event_listener");
      await startSavingsVaultEventListener();
      const { startLendingPoolEventListener } =
        await import("./jobs/acbu_lending_pool_event_listener");
      await startLendingPoolEventListener();
      const { startEscrowEventListener } = await import("./jobs/acbu_escrow_event_listener");
      await startEscrowEventListener();
    }
    const { eventListener } = await import("./services/stellar/eventListener");
    void eventListener.start();

    // Mark application as ready for health checks
    const { markStartupComplete } = await import("./services/health/healthService");
    markStartupComplete();

    // #436: Start heap usage monitor — logs warnings/errors and writes heap snapshots on leak detection.
    const memoryMonitorHandle = startMemoryMonitor();
    setMemoryMonitorHandle(memoryMonitorHandle);

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`API Version: ${config.apiVersion}`);
      if (config.nodeEnv !== "production") {
        logger.info(`API Documentation: http://localhost:${config.port}/api-docs`);
      }
    });
    setHttpServer(server);
  } catch (error) {
    logger.error("Failed to start server", error);
    process.exit(1);
  }
}

if (require.main === module) {
  registerGracefulShutdown();
  void startServer();
}

export { startServer };
export default app;