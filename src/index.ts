import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { config } from "./config/env";
import { logger } from "./config/logger";
import { connectMongoDB, disconnectMongoDB } from "./config/mongodb";
import { connectRabbitMQ, disconnectRabbitMQ } from "./config/rabbitmq";
import { corsMiddleware } from "./middleware/cors";
import { requestLogger } from "./middleware/logger";
import { errorHandler } from "./middleware/errorHandler";
import { standardRateLimiter } from "./middleware/rateLimiter";
import { swaggerSpec } from "./config/swagger";
import routes from "./routes";
import webhookRoutes from "./routes/webhookRoutes";

const app: express.Express = express();

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(corsMiddleware);
app.use(express.urlencoded({ extended: true }));

// Webhooks need raw body for signature verification; mount before json()
app.use(
  `/${config.apiVersion}/webhooks`,
  express.raw({ type: "application/json" }),
  (req: express.Request, res: express.Response, next) => {
    const raw = req.body as Buffer;
    (req as unknown as { rawBody: Buffer }).rawBody = raw;
    try {
      (req as unknown as { body: unknown }).body = JSON.parse(raw.toString());
    } catch {
      res.status(400).json({ error: "Invalid JSON payload" });
      return;
    }
    next();
  },
  webhookRoutes,
);
app.use(express.json());

// Logging
app.use(requestLogger);

// Rate limiting
app.use(standardRateLimiter);

// API Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use(`/${config.apiVersion}`, routes);

// Error handling (must be last)
app.use(errorHandler);

// Initialize connections and start server
async function startServer() {
  try {
    // Connect to MongoDB (optional: server starts even if unreachable or MONGODB_URI empty)
    if (config.mongodbUri) {
      try {
        await connectMongoDB();
        logger.info("MongoDB connected");
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
      // Start KYC processing consumer
      const { startKycProcessingConsumer } =
        await import("./jobs/kycProcessingJob");
      await startKycProcessingConsumer();

      // Start wallet activation consumer (send XLM when KYC fee paid)
      const { startWalletActivationConsumer } =
        await import("./jobs/walletActivationJob");
      await startWalletActivationConsumer();

      // Start notification consumer (OTP_SEND + NOTIFICATIONS → email/SMS)
      const { startNotificationConsumer } =
        await import("./jobs/notificationConsumer");
      await startNotificationConsumer();

      // Start outbound webhook consumer (WEBHOOKS → deliver with HMAC-SHA256)
      const { startWebhookConsumer } = await import("./jobs/webhookConsumer");
      await startWebhookConsumer();

      // Start oracle update scheduler (every 6h)
      const { startOracleUpdateScheduler } =
        await import("./jobs/oracleUpdateJob");
      await startOracleUpdateScheduler();

      // Start reserve tracking scheduler (every 6h)
      const { startReserveTrackingScheduler } =
        await import("./jobs/reserveTrackingJob");
      await startReserveTrackingScheduler();

      // Start daily rebalancing scheduler (00:00 UTC)
      const { startRebalancingScheduler } =
        await import("./jobs/rebalancingJob");
      await startRebalancingScheduler();

      // Start proposed basket weights scheduler (metrics → proposed weights, e.g. monthly)
      const { startProposedWeightsScheduler } =
        await import("./jobs/proposedWeightsJob");
      await startProposedWeightsScheduler();

      // Start USDC conversion consumer (MintEvent → basket allocation)
      const { startUsdcConversionConsumer } =
        await import("./jobs/usdcConversionJob");
      await startUsdcConversionConsumer();

      // Start withdrawal processing consumer (BurnEvent → fintech disbursement)
      const { startWithdrawalProcessingConsumer } =
        await import("./jobs/withdrawalProcessingJob");
      await startWithdrawalProcessingConsumer();

      // Start XLM→ACBU consumer (XLM deposit: sell XLM and mint ACBU to user)
      const { startXlmToAcbuConsumer } = await import("./jobs/xlmToAcbuJob");
      await startXlmToAcbuConsumer();

      // Start USDC convert-and-mint consumer (USDC deposit: convert USDC→XLM in backend, then mint)
      const { startUsdcConvertAndMintConsumer } =
        await import("./jobs/usdcConvertAndMintJob");
      await startUsdcConvertAndMintConsumer();

      // Investment withdrawal: mark requests available at T+24h and send notification
      const { startInvestmentWithdrawalScheduler } =
        await import("./jobs/investmentWithdrawalJob");
      await startInvestmentWithdrawalScheduler();

      // Register MintEvent/BurnEvent handlers and start Stellar event listener (runs in background)
      const { startMintEventListener } =
        await import("./jobs/acbu_minting_event_listener");
      await startMintEventListener();
      const { startBurnEventListener } =
        await import("./jobs/acbu_burning_event_listener");
      await startBurnEventListener();
      const { startSavingsVaultEventListener } =
        await import("./jobs/acbu_savings_vault_event_listener");
      await startSavingsVaultEventListener();
      const { startLendingPoolEventListener } =
        await import("./jobs/acbu_lending_pool_event_listener");
      await startLendingPoolEventListener();
      const { startEscrowEventListener } =
        await import("./jobs/acbu_escrow_event_listener");
      await startEscrowEventListener();
    }
    const { eventListener } = await import("./services/stellar/eventListener");
    void eventListener.start();

    // Start HTTP server
    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(
        `API Documentation: http://localhost:${config.port}/api-docs`,
      );
    });
  } catch (error) {
    logger.error("Failed to start server", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  await disconnectMongoDB();
  await disconnectRabbitMQ();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startServer();

export default app;
