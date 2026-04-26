import { xdr } from "@stellar/stellar-sdk";

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
import { contractClient, ContractClient } from "../stellar/contractClient";

/** Contract uses 7 decimals (10^7) for reserve amount and value_usd */
const RESERVE_DECIMALS = 1e7;
const RESERVE_DECIMALS_BIGINT = 10_000_000n;

/** Build the Soroban `CurrencyCode` tuple-struct ScVal: scvVec([scvVec([scvString(code)])]). */
function currencyCodeToScVal(code: string): xdr.ScVal {
  const c = code.trim().toUpperCase();
  return xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvString(c)])]);
}

/**
 * Read authoritative on-chain custody for a currency:
 * - oracle.get_rate(currency) -> USD per 1 whole unit (7-dec fixed)
 * - oracle.get_s_token_address(currency) -> SAC contract id
 * - SAC.balance(minting_contract) -> custody amount held by the minting contract (7-dec atomic)
 * - valueUsd = (amount * rateUsd) / 1e7 (7-dec atomic USD)
 */
async function readOnChainCustody(currency: string): Promise<{
  amountAtomic: bigint;
  rateUsdAtomic: bigint;
  valueUsdAtomic: bigint;
} | null> {
  const addresses = getContractAddresses();
  if (!addresses.oracle || !addresses.minting || !addresses.reserveTracker) {
    return null;
  }

  const rateRes = await contractClient.readContract(
    addresses.oracle,
    "get_rate",
    [currencyCodeToScVal(currency)],
  );
  const rateUsdAtomic = BigInt(ContractClient.fromScVal(rateRes).toString());

  const sTokenRes = await contractClient.readContract(
    addresses.oracle,
    "get_s_token_address",
    [currencyCodeToScVal(currency)],
  );
  const sToken = ContractClient.fromScVal(sTokenRes).toString();

  const balRes = await contractClient.readContract(sToken, "balance", [
    ContractClient.toScVal(addresses.minting),
  ]);
  const amountAtomic = BigInt(ContractClient.fromScVal(balRes).toString());

  const valueUsdAtomic =
    (amountAtomic * rateUsdAtomic) / RESERVE_DECIMALS_BIGINT;

  return { amountAtomic, rateUsdAtomic, valueUsdAtomic };
}

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
      const contractAddresses = getContractAddresses();
      const onChainEnabled = Boolean(
        contractAddresses.reserveTracker &&
        contractAddresses.oracle &&
        contractAddresses.minting,
      );

      for (const currency of currencies) {
        try {
          // Primary source of truth in custodial/demo MVP: on-chain SAC custody on
          // the minting contract + oracle rate. Fintech partner balances are 0 in
          // the simulated provider and would incorrectly wipe the on-chain reserves
          // (causing is_reserve_sufficient -> false on the next mint).
          let balance = 0;
          let reserveValueUsd = 0;
          let onChainAmountAtomic: bigint | null = null;
          let onChainValueUsdAtomic: bigint | null = null;

          if (onChainEnabled) {
            try {
              const custody = await withRetry(
                () => readOnChainCustody(currency),
                `readOnChainCustody(${currency})`,
              );
              if (custody) {
                onChainAmountAtomic = custody.amountAtomic;
                onChainValueUsdAtomic = custody.valueUsdAtomic;
                balance = Number(custody.amountAtomic) / RESERVE_DECIMALS;
                reserveValueUsd =
                  Number(custody.valueUsdAtomic) / RESERVE_DECIMALS;
              }
            } catch (e) {
              logger.warn(
                "On-chain custody read failed, falling back to fintech provider balance",
                { currency, error: e },
              );
            }
          }

          if (onChainAmountAtomic === null) {
            // Fallback path (non-custodial deployments with real fintech partners).
            balance = await withRetry(
              () => fintechRouter.getProvider(currency).getBalance(currency),
              `getBalance(${currency})`,
            );
            const rate = await withRetry(
              () => this.getCurrencyRate(currency),
              `getCurrencyRate(${currency})`,
            );
            reserveValueUsd = balance * rate;
          }

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

          // Push to on-chain reserve_tracker. SKIP when we could not determine a
          // real custody balance (otherwise we'd overwrite genuine on-chain
          // reserves with zeros and break future mints).
          if (onChainEnabled) {
            const hasRealBalance =
              onChainAmountAtomic !== null && onChainValueUsdAtomic !== null;

            if (!hasRealBalance) {
              logger.warn(
                "Skipping on-chain reserve update (no authoritative custody balance available; refusing to overwrite with zero)",
                { currency },
              );
            } else {
              try {
                const sourceAccount = stellarClient.getKeypair()?.publicKey();
                if (!sourceAccount)
                  throw new Error("No source account available");

                const txHash = await acbuReserveTrackerService.updateReserve({
                  updater: sourceAccount,
                  currency,
                  amount: onChainAmountAtomic!.toString(),
                  valueUsd: onChainValueUsdAtomic!.toString(),
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
            source:
              onChainAmountAtomic !== null
                ? "on-chain-custody"
                : "fintech-provider",
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

  /** Circulating ACBU from completed mint/burn rows (off-chain ledger). */
  private async getTotalAcbuSupplyFromLedger(): Promise<number> {
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

    return Math.max(0, totalMinted - totalBurned);
  }

  /**
   * Get total ACBU supply from blockchain.
   * Queries Horizon to get the actual amount in circulation, preventing divergence from internal tracking.
   */
  
  /**
   * Get total ACBU supply with reconciliation between DB Ledger and Blockchain.
   */
  private async getTotalAcbuSupply(): Promise<number> {
    const ledgerSupply = await this.getTotalAcbuSupplyFromLedger();
    
    const issuer = process.env.STELLAR_ACBU_ASSET_ISSUER;
    const assetCode = process.env.STELLAR_ACBU_ASSET_CODE || 'ACBU';

    if (!issuer) {
      logger.warn('ACBU issuer not configured. Using ledger supply.');
      return ledgerSupply;
    }

    try {
      const server = stellarClient.getServer();
      const assets = await server.assets().forCode(assetCode).forIssuer(issuer).call();

      if (assets.records.length === 0) {
        return ledgerSupply;
      }

      const onChainSupply = parseFloat((assets.records[0] as any).amount);
      const delta = Math.abs(onChainSupply - ledgerSupply);
      const driftThreshold = 0.01;

      if (delta > driftThreshold) {
        logger.warn('RESERVE DRIFT DETECTED: DB Ledger and On-Chain supply diverge', {
          ledgerSupply,
          onChainSupply,
          delta,
        });
      }

      return onChainSupply;
    } catch (e) {
      logger.error('Failed to query Stellar for ACBU total supply, falling back to ledger', { error: e });
      return ledgerSupply;
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
   * Get currency exchange rate from Oracle
   */
  private async getCurrencyRate(currency: string): Promise<number> {
    const latestRate = await prisma.oracleRate.findFirst({
      where: { currency },
      orderBy: { timestamp: "desc" },
    });

    if (latestRate) {
      return latestRate.rateUsd.toNumber();
    }

    throw new Error(`Oracle rate not available for ${currency}`);
  }
}

export const reserveTracker = new ReserveTracker();
