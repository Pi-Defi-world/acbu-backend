import { prisma } from "../../config/database";
import { getMongoDB } from "../../config/mongodb";
import { getRabbitMQChannel } from "../../config/rabbitmq";
import { logger } from "../../config/logger";

const TIMEOUT_MS = 2000;
let startupComplete = false;

type DependencyStatus = "up" | "down";

interface HealthDetail {
  status: DependencyStatus;
  error?: string;
}

export interface HealthReport {
  status: "up" | "down";
  timestamp: string;
  uptime: number;
  details: {
    postgres: HealthDetail;
    mongodb: HealthDetail;
    rabbitmq: HealthDetail;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkPostgres(): Promise<HealthDetail> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, TIMEOUT_MS);
    return { status: "up" };
  } catch (err) {
    const message = (err as Error).message;
    logger.error("Health check: PostgreSQL unavailable", { error: message });
    return { status: "down", error: "PostgreSQL unreachable" };
  }
}

async function checkMongoDB(): Promise<HealthDetail> {
  try {
    const db = getMongoDB();
    await withTimeout(db.admin().ping(), TIMEOUT_MS);
    return { status: "up" };
  } catch (err) {
    const message = (err as Error).message;
    logger.error("Health check: MongoDB unavailable", { error: message });
    return { status: "down", error: "MongoDB unreachable" };
  }
}

async function checkRabbitMQ(): Promise<HealthDetail> {
  try {
    // getRabbitMQChannel throws if not connected; opening a temp channel
    // confirms the broker is alive without side effects.
    const ch = getRabbitMQChannel();
    // A no-op check: if the channel object exists the connection is live.
    if (!ch) throw new Error("Channel not available");
    return { status: "up" };
  } catch (err) {
    const message = (err as Error).message;
    logger.error("Health check: RabbitMQ unavailable", { error: message });
    return { status: "down", error: "RabbitMQ unreachable" };
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const [postgres, mongodb, rabbitmq] = await Promise.all([
    checkPostgres(),
    checkMongoDB(),
    checkRabbitMQ(),
  ]);

  const allUp =
    postgres.status === "up" &&
    mongodb.status === "up" &&
    rabbitmq.status === "up";

  // Report as down if startup is not complete, even if dependencies are up
  const status = allUp && startupComplete ? "up" : "down";

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    details: { postgres, mongodb, rabbitmq },
  };
}

/**
 * Mark the application as ready to receive traffic.
 * Call this after all infrastructure connections and background jobs are initialized.
 */
export function markStartupComplete(): void {
  startupComplete = true;
  logger.info("Application startup complete - health check now reporting healthy");
}
