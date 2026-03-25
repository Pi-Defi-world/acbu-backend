import { prisma } from "../../config/database";
import { config } from "../../config/env";
import { getContractAddresses } from "../../config/contracts";
import { logger } from "../../config/logger";
import { getFintechRouter } from "../fintech";
import { acbuReserveTrackerService } from "../contracts";
import { basketService } from "../basket";
import { getRabbitMQChannel } from "../../config/rabbitmq";
import { QUEUES } from "../../config/rabbitmq";
import { Decimal } from "@prisma/client/runtime/library";
import { stellarClient } from "../stellar/client";

/** Contract uses 7 decimals (10^7) for reserve amount and value_usd */
const RESERVE_DECIMALS = 1e7;

const RESERVE_TRACKER_RETRIES = 3;
const RESERVE_TRACKER_RETRY_DELAY_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RESERVE_TRACKER_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      logger.warn(
        `${label} attempt ${attempt}/${RESERVE_TRACKER_RETRIES} failed`,
        { error: e },
      );
      if (attempt < RESERVE_TRACKER_RETRIES) {
        await new Promise((r) => setTimeout(r, RESERVE_TRACKER_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

function toReserveUnits(n: number): string {
  return Math.round(n * RESERVE_DECIMALS).toString();
}

export interface ReserveStatus {
  currency: string;
  targetWeight: number;
  actualWeight: number;
  reserveAmount: number;
  reserveValueUsd: number;
  weightDrift: number;
}

export interface ReserveHealth {
  totalAcbuSupply: number;
  totalReserveValueUsd: number;
  overcollateralizationRatio: number;
  health: "healthy" | "warning" | "critical";
  currencies: ReserveStatus[];
}

export class ReserveTracker {
  /**
   * Track reserve balances from fintech partners
   */
  async trackReserves(): Promise<void> {
    try {
      logger.info("Starting reserve tracking");

      const basket = await basketService.getCurrentBasket();
      const currencies = basket.map((e) => e.currency);
      const reserveUpdates = [];
      const fintechRouter = getFintechRouter();

      for (const currency of currencies) {
        try {
          const balance = await withRetry(
            () => fintechRouter.getProvider(currency).getBalance(currency),
            `getBalance(${currency})`,
          );
          const rate = await withRetry(
            () => this.getCurrencyRate(currency),
            `getCurrencyRate(${currency})`,
          );
          const reserveValueUsd = balance * rate;
          const targetWeight = await basketService.getTargetWeight(currency);
          const totalReserveValue = await this.getTotalReserveValue();
          const actualWeight =
            totalReserveValue > 0
              ? (reserveValueUsd / totalReserveValue) * 100
              : 0;

          // Store reserve snapshot (off-chain) for transactions segment
          await prisma.reserve.create({
            data: {
              currency,
              segment: "transactions",
              targetWeight: new Decimal(targetWeight),
              actualWeight: new Decimal(actualWeight),
              reserveAmount: new Decimal(balance),
              reserveValueUsd: new Decimal(reserveValueUsd),
            },
          });

          // Push same data to on-chain reserve_tracker when contract is configured
          const contractAddresses = getContractAddresses();
          if (contractAddresses.reserveTracker) {
            try {
              const txHash = await acbuReserveTrackerService.updateReserve({
                currency,
                amount: toReserveUnits(balance),
                valueUsd: toReserveUnits(reserveValueUsd),
              });
              logger.info("Reserve synced to chain", { currency, txHash });
            } catch (onChainError) {
              logger.warn(
                "On-chain reserve update failed (off-chain data saved)",
                {
                  currency,
                  error: onChainError,
                },
              );
            }
          }

          reserveUpdates.push({
            currency,
            balance,
            reserveValueUsd,
            actualWeight,
            targetWeight,
          });

          logger.info("Reserve tracked", {
            currency,
            balance,
            reserveValueUsd,
            actualWeight,
          });
        } catch (error) {
          logger.error("Failed to track reserve for currency", {
            currency,
            error,
          });
        }
      }

      // Check reserve health
      const health = await this.checkReserveHealth();
      if (health.health === "critical") {
        await this.triggerAlert(health);
      }

      logger.info("Reserve tracking completed", { reserveUpdates });
    } catch (error) {
      logger.error("Reserve tracking failed", error);
      throw error;
    }
  }

  /** Reserve segment: transactions (mint/burn liquidity) or investment_savings */
  static readonly SEGMENT_TRANSACTIONS = "transactions" as const;
  static readonly SEGMENT_INVESTMENT_SAVINGS = "investment_savings" as const;

  /**
   * Get current reserve status (default: transactions segment only for health).
   * Use getReserveStatusBySegment to get investment_savings or both.
   */
  async getReserveStatus(
    segment: string = ReserveTracker.SEGMENT_TRANSACTIONS,
  ): Promise<ReserveHealth> {
    const totalAcbuSupply = await this.getTotalAcbuSupply();
    const totalReserveValue = await this.getTotalReserveValue(segment);
    const overcollateralizationRatio =
      totalAcbuSupply > 0 ? (totalReserveValue / totalAcbuSupply) * 100 : 0;

    const currencies = await basketService.getCurrencies();
    const currencyStatuses: ReserveStatus[] = [];

    for (const currency of currencies) {
      const latestReserve = await prisma.reserve.findFirst({
        where: { currency, segment },
        orderBy: { timestamp: "desc" },
      });

      if (latestReserve) {
        currencyStatuses.push({
          currency,
          targetWeight: latestReserve.targetWeight.toNumber(),
          actualWeight: latestReserve.actualWeight.toNumber(),
          reserveAmount: latestReserve.reserveAmount.toNumber(),
          reserveValueUsd: latestReserve.reserveValueUsd.toNumber(),
          weightDrift:
            latestReserve.actualWeight.toNumber() -
            latestReserve.targetWeight.toNumber(),
        });
      }
    }

    const health: "healthy" | "warning" | "critical" =
      overcollateralizationRatio >= config.reserve.targetRatio * 100
        ? "healthy"
        : overcollateralizationRatio >= config.reserve.alertThreshold * 100
          ? "warning"
          : "critical";

    return {
      totalAcbuSupply,
      totalReserveValueUsd: totalReserveValue,
      overcollateralizationRatio,
      health,
      currencies: currencyStatuses,
    };
  }

  /**
   * Calculate reserve ratio (default: transactions segment).
   */
  async calculateReserveRatio(
    segment: string = ReserveTracker.SEGMENT_TRANSACTIONS,
  ): Promise<number> {
    const totalAcbuSupply = await this.getTotalAcbuSupply();
    const totalReserveValue = await this.getTotalReserveValue(segment);

    if (totalAcbuSupply === 0) {
      return 0;
    }

    return totalReserveValue / totalAcbuSupply;
  }

  /**
   * Check reserve health and trigger alerts if needed
   */
  private async checkReserveHealth(): Promise<ReserveHealth> {
    const status = await this.getReserveStatus();
    const ratio = status.overcollateralizationRatio / 100;

    if (ratio < config.reserve.alertThreshold) {
      logger.warn("Reserve health critical", {
        ratio,
        threshold: config.reserve.alertThreshold,
      });
    } else if (ratio < config.reserve.minRatio) {
      logger.warn("Reserve health warning", {
        ratio,
        minRatio: config.reserve.minRatio,
      });
    }

    return status;
  }

  /**
   * Trigger alert when reserves are low: log and publish to NOTIFICATIONS queue for email/Slack/PagerDuty.
   */
  private async triggerAlert(health: ReserveHealth): Promise<void> {
    logger.error("Reserve alert triggered", {
      totalAcbuSupply: health.totalAcbuSupply,
      totalReserveValueUsd: health.totalReserveValueUsd,
      overcollateralizationRatio: health.overcollateralizationRatio,
      health: health.health,
    });
    try {
      const ch = getRabbitMQChannel();
      await ch.assertQueue(QUEUES.NOTIFICATIONS, { durable: true });
      ch.sendToQueue(
        QUEUES.NOTIFICATIONS,
        Buffer.from(
          JSON.stringify({
            type: "reserve_alert",
            health: health.health,
            totalAcbuSupply: health.totalAcbuSupply,
            totalReserveValueUsd: health.totalReserveValueUsd,
            overcollateralizationRatio: health.overcollateralizationRatio,
            timestamp: new Date().toISOString(),
          }),
        ),
        { persistent: true },
      );
    } catch (e) {
      logger.error("Failed to publish reserve alert to NOTIFICATIONS queue", e);
    }
  }

  /**
   * Get total ACBU supply from blockchain.
   * Queries Horizon to get the actual amount in circulation, preventing divergence from internal tracking.
   */
  private async getTotalAcbuSupply(): Promise<number> {
    const issuer = process.env.STELLAR_ACBU_ASSET_ISSUER;
    const assetCode = process.env.STELLAR_ACBU_ASSET_CODE || "ACBU";

    if (!issuer) {
      logger.warn(
        "ACBU issuer not configured. Falling back to internal transaction aggregates for supply calculation.",
        { assetCode },
      );

      const minted = await prisma.transaction.aggregate({
        where: { type: "mint", status: "completed" },
        _sum: { acbuAmount: true },
      });

      const burned = await prisma.transaction.aggregate({
        where: { type: "burn", status: "completed" },
        _sum: { acbuAmountBurned: true },
      });

      const totalMinted = minted._sum.acbuAmount?.toNumber() || 0;
      const totalBurned = burned._sum.acbuAmountBurned?.toNumber() || 0;

      return totalMinted - totalBurned;
    }

    try {
      const server = stellarClient.getServer();
      const assets = await server
        .assets()
        .forCode(assetCode)
        .forIssuer(issuer)
        .call();

      if (assets.records.length === 0) {
        logger.warn(
          "ACBU asset not found on Stellar; supply is effectively zero.",
          {
            assetCode,
            issuer,
          },
        );
        return 0;
      }

      // Assets response contains 'amount' which represents total circulating supply
      const totalSupply = parseFloat(assets.records[0].amount);
      return totalSupply;
    } catch (e) {
      logger.error("Failed to query Stellar for ACBU total supply", {
        error: e,
      });
      // We throw here because returning a stale or zero value would incorrectly trigger health alerts
      throw new Error(`Stellar Horizon query failed for ACBU supply: ${e}`);
    }
  }

  /**
   * Get total reserve value in USD for a segment (default: transactions).
   */
  private async getTotalReserveValue(
    segment: string = ReserveTracker.SEGMENT_TRANSACTIONS,
  ): Promise<number> {
    const currencies = await basketService.getCurrencies();
    let total = 0;

    for (const currency of currencies) {
      const latest = await prisma.reserve.findFirst({
        where: { currency, segment },
        orderBy: { timestamp: "desc" },
      });

      if (latest) {
        total += latest.reserveValueUsd.toNumber();
      }
    }

    return total;
  }

  /**
   * Get currency exchange rate
   */
  private async getCurrencyRate(currency: string): Promise<number> {
    const latestRate = await prisma.oracleRate.findFirst({
      where: { currency },
      orderBy: { timestamp: "desc" },
    });

    if (latestRate) {
      return latestRate.rateUsd.toNumber();
    }

    // Fallback: use Flutterwave for FX (broad coverage) when oracle rate not available
    try {
      const conversion = await getFintechRouter()
        .getProviderById("flutterwave")
        .convertCurrency(1, currency, "USD");
      return conversion.rate;
    } catch (error) {
      logger.error("Failed to get currency rate", { currency, error });
      throw new Error(`Unable to get rate for ${currency}`);
    }
  }
}

export const reserveTracker = new ReserveTracker();
