import { type Server } from "http";
import { logger } from "./config/logger";
import { disconnectMongoDB } from "./config/mongodb";
import { disconnectRabbitMQ } from "./config/rabbitmq";
import { prisma } from "./config/database";
import { stopMemoryMonitor } from "./utils/memoryMonitor";

type AppServer = Server & { closeIdleConnections?: () => void };
let httpServer: AppServer | null = null;
let memoryMonitorHandle: NodeJS.Timeout | null = null;
let balanceWsServer: { close: () => void } | null = null;

export const setBalanceWebSocketServer = (server: { close: () => void } | null): void => {
  balanceWsServer = server;
};

export const setHttpServer = (server: AppServer | null): void => {
  httpServer = server;
};

export const setMemoryMonitorHandle = (handle: NodeJS.Timeout): void => {
  memoryMonitorHandle = handle;
};

const closeServer = async (): Promise<void> => {
  if (!httpServer) {
    return;
  }

  if (typeof httpServer.closeIdleConnections === "function") {
    try {
      httpServer.closeIdleConnections();
    } catch (error) {
      logger.warn("Failed to close idle HTTP connections", error);
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer?.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  httpServer = null;
};

export const shutdown = async (): Promise<void> => {
  logger.info("Shutting down gracefully...");
  if (memoryMonitorHandle) stopMemoryMonitor(memoryMonitorHandle);
  if (balanceWsServer) {
    try {
      balanceWsServer.close();
    } catch (error) {
      logger.warn("Failed to close WebSocket server", error);
    }
    balanceWsServer = null;
  }
  // W10-I-013: Stop reserve metrics job
  try {
    const { stopReserveMetricsJob } = await import("./jobs/reserveMetricsJob");
    stopReserveMetricsJob();
  } catch (error) {
    logger.warn("[shutdown] Failed to stop reserve metrics job", { error });
  }
  await closeServer();
  await disconnectMongoDB();
  await disconnectRabbitMQ();
  // Disconnect Prisma so all in-flight queries drain and the connection pool
  // is released cleanly on SIGTERM (#720).
  await prisma.$disconnect().catch((err: unknown) => {
    logger.warn("[shutdown] Prisma disconnect failed", { error: err });
  });
};

let isShuttingDown = false;
const handleTermination = async (): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  try {
    await shutdown();
  } catch (error) {
    logger.error("Graceful shutdown failed", error);
  } finally {
    process.exit(0);
  }
};

// Upper bound on how long we wait for connections to drain before forcing exit.
const FATAL_SHUTDOWN_TIMEOUT_MS = 10_000;

// Fatal errors leave the process in an undefined state, so we still exit non-zero.
// Draining in-flight requests and closing connections first avoids killing active
// work abruptly, while the timeout guarantees we never hang (#1405).
const handleFatal = async (label: string, cause: unknown): Promise<void> => {
  logger.error(`${label} — draining connections before exit`, {
    cause: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
  });

  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    await Promise.race([
      shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, FATAL_SHUTDOWN_TIMEOUT_MS)),
    ]);
  } catch (error) {
    logger.error("Graceful shutdown failed", error);
  } finally {
    process.exit(1);
  }
};

export const registerGracefulShutdown = (): void => {
  process.on("SIGTERM", handleTermination);
  process.on("SIGINT", handleTermination);

  process.on("uncaughtException", (error: Error) => {
    void handleFatal("uncaughtException", error);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    void handleFatal("unhandledRejection", reason);
  });
};
