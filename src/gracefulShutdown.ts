import { type Server } from "http";
import { logger } from "./config/logger";
import { disconnectMongoDB } from "./config/mongodb";
import { disconnectRabbitMQ } from "./config/rabbitmq";
import { prisma } from "./config/database";
import { stopMemoryMonitor } from "./utils/memoryMonitor";

type AppServer = Server & { closeIdleConnections?: () => void };
let httpServer: AppServer | null = null;
let memoryMonitorHandle: NodeJS.Timeout | null = null;

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

export const registerGracefulShutdown = (): void => {
  process.on("SIGTERM", handleTermination);
  process.on("SIGINT", handleTermination);

  // An uncaught exception leaves the process in an undefined state.
  // Log it and exit immediately so the process manager (Docker/K8s) can restart cleanly.
  process.on("uncaughtException", (error: Error) => {
    logger.error("uncaughtException — exiting to prevent undefined state", {
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  // Unhandled promise rejections are equally unsafe to continue from.
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandledRejection — exiting to prevent undefined state", {
      reason: reason instanceof Error ? reason.stack : String(reason),
    });
    process.exit(1);
  });
};
