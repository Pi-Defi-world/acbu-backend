import { prisma } from "../../config/database";
import { Prisma } from "@prisma/client";
import { getMongoDB } from "../../config/mongodb";
import { getRabbitMQChannel } from "../../config/rabbitmq";
import { logger } from "../../config/logger";
import { eventListenerHealth } from "../stellar/eventListener";
import { stellarClient } from "../stellar/client";

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
    sorobanEventListener: HealthDetail;
    stellarHorizon: HealthDetail;
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
    await withTimeout(prisma.$queryRaw(Prisma.sql`SELECT 1`), TIMEOUT_MS);
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
    const ch = getRabbitMQChannel();
    if (!ch) throw new Error("Channel not available");
    return { status: "up" };
  } catch (err) {
    const message = (err as Error).message;
    logger.error("Health check: RabbitMQ unavailable", { error: message });
    return { status: "down", error: "RabbitMQ unreachable" };
  }
}

async function checkStellarHorizon(): Promise<HealthDetail> {
  try {
    await withTimeout(stellarClient.getServer().root(), TIMEOUT_MS);
    return { status: "up" };
  } catch (err) {
    const message = (err as Error).message;
    logger.error("Health check: Stellar Horizon unavailable", { error: message });
    return { status: "down", error: "Stellar Horizon unreachable" };
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const [postgres, mongodb, rabbitmq, stellarHorizon] = await Promise.all([
    checkPostgres(),
    checkMongoDB(),
    checkRabbitMQ(),
    checkStellarHorizon(),
  ]);

  const sorobanEventListener: HealthDetail = {
    status: eventListenerHealth.status,
    error: eventListenerHealth.lastError ?? undefined,
  };

  const allUp =
    postgres.status === "up" &&
    mongodb.status === "up" &&
    rabbitmq.status === "up" &&
    stellarHorizon.status === "up" &&
    sorobanEventListener.status === "up";

  const status = allUp && startupComplete ? "up" : "down";

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    details: { postgres, mongodb, rabbitmq, stellarHorizon, sorobanEventListener },
  };
}

export function markStartupComplete(): void {
  startupComplete = true;
  logger.info("Application startup complete - health check now reporting healthy");
}
