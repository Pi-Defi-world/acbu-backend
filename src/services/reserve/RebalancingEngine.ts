/**
 * RebalancingEngine: daily drift calculation (actual vs target from BasketService),
 * rebalancing instruction generator, execution tracking and RebalancingEvent records.
 * Uses fintech router for FX rates; instructions can be consumed by REBALANCING queue for execution.
 */
import { prisma } from "../../config/database";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { getFintechRouter } from "../fintech";
import { reserveTracker } from "./ReserveTracker";
import type { ReserveHealth, ReserveStatus } from "./ReserveTracker";
import { Decimal } from "@prisma/client/runtime/library";

// #627: Read from config so the threshold can be tuned via RESERVE_DRIFT_THRESHOLD_PCT
// without a code change or redeploy of the full service.
const DRIFT_THRESHOLD_PCT = config.reserve.driftThresholdPct;

export interface RebalanceInstruction {
  fromCurrency: string;
  toCurrency: string;
  amountUsd: number;
  rateFromUsd: number;
  rateToUsd: number;
  amountFrom: number;
  amountTo: number;
}

export interface RebalancingResult {
  eventId: string;
  status: "pending" | "completed" | "failed";
  totalReserveValueUsd: number;
  driftSnapshot: ReserveStatus[];
  instructions: RebalanceInstruction[];
}

export class RebalancingEngine {
  /**
   * Get current reserve status and compute drift per currency.
   */
  async getDriftSnapshot(): Promise<ReserveStatus[]> {
    const health = await reserveTracker.getReserveStatus();
    return health.currencies;
  }

  /**
   * Generate rebalancing instructions: for each currency over target, "sell" (reduce) that currency
   * and "buy" (increase) currencies under target. Uses FX rates from fintech for conversion amounts.
   */
  async generateInstructions(
    driftSnapshot: ReserveStatus[],
    totalReserveUsd: Decimal,
  ): Promise<RebalanceInstruction[]> {
    const instructions: RebalanceInstruction[] = [];
    const overweight = driftSnapshot.filter(
      (c) => c.weightDrift.gt(DRIFT_THRESHOLD_PCT),
    );
    const underweight = driftSnapshot.filter(
      (c) => c.weightDrift.lt(-DRIFT_THRESHOLD_PCT),
    );
    if (overweight.length === 0 || underweight.length === 0)
      return instructions;

    const router = getFintechRouter();
    for (const over of overweight) {
      const excessPct = over.weightDrift;
      const excessUsd = totalReserveUsd.mul(excessPct).div(100);
      if (excessUsd.lte(0)) continue;
      try {
        const providerFrom = await router.getProvider(over.currency);
        const rateFrom = await providerFrom.convertCurrency(1, over.currency, "USD");
        const rateFromUsd = rateFrom.rate;
        for (const under of underweight) {
          const deficitPct = under.weightDrift.neg();
          const totalDeficitPct = underweight.reduce(
            (s, u) => s.add(u.weightDrift.neg()),
            new Decimal(0),
          );
          const shareOfExcess = deficitPct.div(totalDeficitPct).mul(excessUsd);
          if (shareOfExcess.lte(0)) continue;
          try {
            const providerTo = await router.getProvider(under.currency);
            const rateTo = await providerTo.convertCurrency(1, under.currency, "USD");
            const rateToUsd = rateTo.rate;
            const amountFrom = shareOfExcess.div(rateFromUsd).toNumber();
            const amountTo = shareOfExcess.div(rateToUsd).toNumber();
            instructions.push({
              fromCurrency: over.currency,
              toCurrency: under.currency,
              amountUsd: shareOfExcess.toNumber(),
              rateFromUsd,
              rateToUsd,
              amountFrom,
              amountTo,
            });
          } catch (e) {
            logger.warn("RebalancingEngine: skip underweight FX", {
              currency: under.currency,
              error: e,
            });
          }
        }
      } catch (e) {
        logger.warn("RebalancingEngine: skip overweight FX", {
          currency: over.currency,
          error: e,
        });
      }
    }
    return instructions;
  }

  /**
   * Run daily rebalance: compute drift, generate instructions, create RebalancingEvent, optionally publish to queue.
   */
  async run(): Promise<RebalancingResult> {
    const startedAt = new Date();
    logger.info("RebalancingEngine run started", {
      startedAt: startedAt.toISOString(),
    });

    const health: ReserveHealth = await reserveTracker.getReserveStatus();
    const driftSnapshot = health.currencies;
    const totalReserveUsd = health.totalReserveValueUsd;

    const instructions = await this.generateInstructions(driftSnapshot, totalReserveUsd);

    const event = await prisma.rebalancingEvent.create({
      data: {
        type: "daily",
        status: instructions.length > 0 ? "pending" : "completed",
        adjustments: JSON.parse(
          JSON.stringify({
            driftSnapshot: driftSnapshot.map((c) => ({
              currency: c.currency,
              targetWeight: c.targetWeight,
              actualWeight: c.actualWeight,
              weightDrift: c.weightDrift,
              reserveValueUsd: c.reserveValueUsd,
            })),
            instructions,
            totalReserveValueUsd: totalReserveUsd.toString(),
            startedAt: startedAt.toISOString(),
          }),
        ),
      },
    });

    if (instructions.length === 0) {
      await prisma.rebalancingEvent.update({
        where: { id: event.id },
        data: { completedAt: new Date() },
      });
      logger.info("RebalancingEngine run completed (no rebalance needed)", {
        eventId: event.id,
      });
      return {
        eventId: event.id,
        status: "completed",
        totalReserveValueUsd: totalReserveUsd.toNumber(),
        driftSnapshot,
        instructions: [],
      };
    }

    logger.info("RebalancingEngine run: event created with instructions", {
      eventId: event.id,
      instructionCount: instructions.length,
    });
    return {
      eventId: event.id,
      status: "pending",
      totalReserveValueUsd: totalReserveUsd.toNumber(),
      driftSnapshot,
      instructions,
    };
  }
}

export const rebalancingEngine = new RebalancingEngine();
