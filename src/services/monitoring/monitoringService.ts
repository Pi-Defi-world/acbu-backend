/**
 * W10-I-013: Monitoring service for observability instrumentation.
 *
 * Provides functions to:
 * - Track reserve ratio metrics
 * - Monitor RabbitMQ queue depth
 * - Instrument Stellar RPC calls
 * - Track circuit breaker state
 */

import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import {
  reserveRatioGauge,
  reserveRatioBreachCounter,
  rabbitmqQueueDepthGauge,
  rabbitmqQueuePublishCounter,
  rabbitmqQueueConsumeCounter,
  rabbitmqQueueErrorCounter,
  stellarRpcDurationHistogram,
  stellarRpcErrorCounter,
  stellarCircuitBreakerStateGauge,
} from "../../config/promMetrics";
import { config } from "../../config/env";

/**
 * Update reserve ratio metrics from the latest Reserve snapshots.
 * Should be called periodically (e.g., via cron job).
 */
export async function updateReserveMetrics(): Promise<void> {
  try {
    const latestReserves = await prisma.reserve.findMany({
      orderBy: { timestamp: "desc" },
      take: 100, // Last 100 snapshots to compute metrics
    });

    // Group by currency and segment, get the latest snapshot for each
    const latestByCurrencySegment = new Map<string, any>();
    for (const reserve of latestReserves) {
      const key = `${reserve.currency}_${reserve.segment}`;
      if (!latestByCurrencySegment.has(key)) {
        latestByCurrencySegment.set(key, reserve);
      }
    }

    // Update gauges
    for (const [, reserve] of latestByCurrencySegment) {
      const ratio = reserve.actualWeight.toNumber();
      reserveRatioGauge.set(
        { currency: reserve.currency, segment: reserve.segment },
        ratio,
      );

      // Check against thresholds and record breaches
      const minRatio = parseFloat(process.env.RESERVE_MIN_RATIO || "1.02");
      const alertThreshold = parseFloat(process.env.RESERVE_ALERT_THRESHOLD || "1.02");

      if (ratio < minRatio) {
        reserveRatioBreachCounter.inc(
          { currency: reserve.currency, segment: reserve.segment, threshold: "min" },
        );
        logger.warn("Reserve ratio below minimum threshold", {
          currency: reserve.currency,
          segment: reserve.segment,
          ratio,
          minRatio,
        });
      }

      if (ratio < alertThreshold) {
        reserveRatioBreachCounter.inc(
          { currency: reserve.currency, segment: reserve.segment, threshold: "alert" },
        );
      }
    }

    logger.info("Reserve metrics updated", {
      snapshots: latestByCurrencySegment.size,
    });
  } catch (error) {
    logger.error("Failed to update reserve metrics", { error });
  }
}

/**
 * Record a RabbitMQ queue depth metric.
 * Call this when consuming from a queue to update the current depth.
 */
export function recordQueueDepth(queueName: string, depth: number): void {
  rabbitmqQueueDepthGauge.set({ queue_name: queueName }, depth);
}

/**
 * Record a message published to a queue.
 */
export function recordQueuePublish(queueName: string): void {
  rabbitmqQueuePublishCounter.inc({ queue_name: queueName });
}

/**
 * Record a message consumed from a queue.
 */
export function recordQueueConsume(queueName: string): void {
  rabbitmqQueueConsumeCounter.inc({ queue_name: queueName });
}

/**
 * Record a queue processing error.
 */
export function recordQueueError(queueName: string, errorType: string): void {
  rabbitmqQueueErrorCounter.inc({ queue_name: queueName, error_type: errorType });
}

/**
 * Instrument a Stellar RPC call with metrics.
 * Wraps the operation with timing and error tracking.
 */
export async function instrumentStellarRpc<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const network = config.stellar.network;

  try {
    const result = await fn();
    const durationMs = (Date.now() - start) / 1000;
    stellarRpcDurationHistogram.observe(
      { operation, network },
      durationMs,
    );
    return result;
  } catch (error: any) {
    const durationMs = (Date.now() - start) / 1000;
    stellarRpcDurationHistogram.observe(
      { operation, network },
      durationMs,
    );
    stellarRpcErrorCounter.inc({
      operation,
      network,
      error_type: error.name || "unknown",
    });
    throw error;
  }
}

/**
 * Update circuit breaker state metric.
 * State: 0 = closed, 1 = open, 2 = half-open
 */
export function recordCircuitBreakerState(
  service: string,
  state: "closed" | "open" | "half-open",
): void {
  const stateValue = state === "closed" ? 0 : state === "open" ? 1 : 2;
  stellarCircuitBreakerStateGauge.set(
    { service, network: config.stellar.network },
    stateValue,
  );
}
