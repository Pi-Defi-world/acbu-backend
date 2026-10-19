/**
 * Oracle Integration Service: fetch price feeds (40/40/20: central bank, fintech, forex),
 * outlier detection, deviation limit, circuit breaker, store OracleRate and AcbuRate.
 */
import { prisma } from "../../config/database";
import { config } from "../../config/env";
import { getFintechRouter } from "../fintech";
import { basketService } from "../basket";
import { acbuOracleService } from "../contracts";
import { getContractAddresses } from "../../config/contracts";
import { logger } from "../../config/logger";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { stellarClient } from "../stellar/client";
import { fetchCentralBankRateUsd } from "./centralBankClient";
import { fetchForexRateUsd } from "./forexClient";
import { fetchExchangeRate as fetchWorldBankRate } from "../metrics/worldBankClient";
import { SimulatedFintechProvider } from "../fintech/simulated";
import { computeSyntheticBasketOneAcbuForBasket } from "./syntheticBasket";

const OUTLIER_DEVIATION = 0.03; // 3%
const ORACLE_RATE_DECIMALS = 1e7;

/** Weights for 25/25/25/25 oracle aggregation (central bank, fintech, forex, world bank) */
const LAYER_WEIGHT_CB = 0.25;
const LAYER_WEIGHT_FINTECH = 0.25;
const LAYER_WEIGHT_FOREX = 0.25;
const LAYER_WEIGHT_WORLD_BANK = 0.25;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function excludeOutliers(values: number[], threshold: number): number[] {
  const m = median(values);
  return values.filter((v) => Math.abs(v - m) / (m || 1) <= threshold);
}

/** Compute weighted composite from available layers; renormalize if some missing. */
function compositeRate(
  cb: number | null,
  fintech: number | null,
  forex: number | null,
  wb: number | null,
): number {
  const parts: { w: number; v: number }[] = [];
  if (cb != null) parts.push({ w: LAYER_WEIGHT_CB, v: cb });
  if (fintech != null) parts.push({ w: LAYER_WEIGHT_FINTECH, v: fintech });
  if (forex != null) parts.push({ w: LAYER_WEIGHT_FOREX, v: forex });
  if (wb != null) parts.push({ w: LAYER_WEIGHT_WORLD_BANK, v: wb });
  if (parts.length === 0) return 0;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  return parts.reduce((s, p) => s + (p.w / totalW) * p.v, 0);
}

export async function fetchAndStoreRates(): Promise<void> {
  const basket = await basketService.getCurrentBasket();
  const fintechRouter = getFintechRouter();
  const now = new Date();
  const timestampUnix = Math.floor(now.getTime() / 1000);

  for (const { currency } of basket) {
    try {
      let centralBankRate: number | null = null;
      let fintechRate: number | null = null;
      let forexRate: number | null = null;
      let worldBankRate: number | null = null;

      centralBankRate = await fetchCentralBankRateUsd(currency);

      try {
        const fintech = await fintechRouter.getProvider(currency);
        // Only call if it's not the simulated provider to avoid circular dependency
        // (simulated provider depends on oracleRates being already in DB)
        if (!(fintech instanceof SimulatedFintechProvider)) {
          const res = await fintech.convertCurrency(1, currency, "USD");
          fintechRate = res.rate;
        }
      } catch (e) {
        logger.warn("Oracle: fintech rate failed", { currency, error: e });
      }

      forexRate = await fetchForexRateUsd(currency);
      worldBankRate = await fetchWorldBankRate(currency);

      const sources = [centralBankRate, fintechRate, forexRate, worldBankRate].filter(
        (r): r is number => r != null && r > 0,
      );
      if (sources.length === 0) {
        logger.warn("Oracle: no rate for currency", { currency });
        continue;
      }

      let composite = compositeRate(centralBankRate, fintechRate, forexRate, worldBankRate);

      const withOutliers = [centralBankRate, fintechRate, forexRate, worldBankRate].filter(
        (r): r is number => r != null && r > 0,
      );
      const filtered = excludeOutliers(withOutliers, OUTLIER_DEVIATION);
      const inlierSet = new Set(filtered);
      if (filtered.length < withOutliers.length && filtered.length > 0) {
        composite = compositeRate(
          centralBankRate != null && inlierSet.has(centralBankRate) ? centralBankRate : null,
          fintechRate != null && inlierSet.has(fintechRate) ? fintechRate : null,
          forexRate != null && inlierSet.has(forexRate) ? forexRate : null,
          worldBankRate != null && inlierSet.has(worldBankRate) ? worldBankRate : null,
        );
      }

      const prevRate = await prisma.oracleRate.findFirst({
        where: { currency },
        orderBy: { timestamp: "desc" },
      });
      const prevRateNum = prevRate?.medianRate != null ? Number(prevRate.medianRate.toString()) : undefined;
      const maxDeviation = config.oracle.maxDeviationPerUpdate ?? 0.05;
      const circuitThreshold = config.oracle.circuitBreakerThreshold ?? 0.1;

      if (prevRateNum != null && prevRateNum > 0) {
        const deviation = Math.abs(composite - prevRateNum) / prevRateNum;
        if (deviation > circuitThreshold) {
          const avg48h = await getAverageRateOverHours(currency, 48);
          if (avg48h != null) {
            logger.warn("Oracle: circuit breaker triggered, using 48h average", {
              currency,
              composite,
              prevRateNum,
              avg48h,
            });
            composite = avg48h;
          }
        } else if (deviation > maxDeviation) {
          logger.warn("Oracle: deviation exceeds max, consider manual review", {
            currency,
            composite,
            prevRateNum,
            deviation,
          });
        }
      }

      await prisma.oracleRate.create({
        data: {
          currency,
          rateUsd: new Decimal(composite),
          centralBankRate: centralBankRate != null ? new Decimal(centralBankRate) : null,
          fintechRate: fintechRate != null ? new Decimal(fintechRate) : null,
          forexRate: forexRate != null ? new Decimal(forexRate) : null,
          medianRate: new Decimal(composite),
          rawValues: {
            worldBankRate: worldBankRate != null ? worldBankRate : null,
          },
        },
      });

      const addresses = getContractAddresses();
      if (addresses.oracle && config.oracle) {
        try {
          const sourceAccount = stellarClient.getKeypair()?.publicKey();
          if (!sourceAccount) throw new Error("No source account available");

          const rate7 = Math.round(composite * ORACLE_RATE_DECIMALS).toString();
          const sourcesForContract = [centralBankRate, fintechRate, forexRate, worldBankRate]
            .filter((r): r is number => r != null && r > 0)
            .map((r) => Math.round(r * ORACLE_RATE_DECIMALS).toString());

          logger.info("Updating oracle rate", {
            validator: sourceAccount,
            currency,
            rate: rate7,
            sources: sourcesForContract,
          });

          await acbuOracleService.updateRate({
            validator: sourceAccount,
            currency,
            rate: rate7,
            sources: sourcesForContract,
            timestamp: timestampUnix,
          });
          logger.info("Oracle: rate updated on-chain", {
            currency,
            rate: rate7,
          });
        } catch (e: any) {
          logger.error("Oracle: contract update failed", {
            currency,
            error: e?.message || e,
          });
        }
      }
    } catch (error) {
      logger.error("Oracle: fetch failed for currency", { currency, error });
    }
  }

  // 1 ACBU = V USD notional (V=1) split by basket weights; local per leg q_c = (V·f_c)/r_c, f_c = w_c/W.
  const basketOne = await computeSyntheticBasketOneAcbuForBasket(basket, 1);
  if (!basketOne || basketOne.legs.length === 0) {
    logger.error("Oracle: skipping AcbuRate — no basket leg has a fresh oracle USD rate");
    return;
  }

  const acbuUsd = basketOne.usdNotionalPerAcbu;

  const prev24h = await prisma.acbuRate.findFirst({
    where: { timestamp: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    orderBy: { timestamp: "desc" },
  });
  const change24hUsd =
    prev24h && acbuUsd > 0
      ? ((acbuUsd - prev24h.acbuUsd.toNumber()) / prev24h.acbuUsd.toNumber()) * 100
      : null;

  const acbuPerCurrency: Record<string, number> = {};
  for (const leg of basketOne.legs) {
    acbuPerCurrency[leg.currency] = leg.localPerOneAcbu;
  }

  const acbuRateData: Record<string, Decimal | null> = {
    acbuUsd: new Decimal(acbuUsd),
    change24hUsd: change24hUsd != null ? new Decimal(change24hUsd) : null,
    acbuEur: null,
    acbuGbp: null,
    acbuNgn: acbuPerCurrency.NGN != null ? new Decimal(acbuPerCurrency.NGN) : null,
    acbuKes: acbuPerCurrency.KES != null ? new Decimal(acbuPerCurrency.KES) : null,
    acbuZar: acbuPerCurrency.ZAR != null ? new Decimal(acbuPerCurrency.ZAR) : null,
    acbuRwf: acbuPerCurrency.RWF != null ? new Decimal(acbuPerCurrency.RWF) : null,
    acbuGhs: acbuPerCurrency.GHS != null ? new Decimal(acbuPerCurrency.GHS) : null,
    acbuEgp: acbuPerCurrency.EGP != null ? new Decimal(acbuPerCurrency.EGP) : null,
    acbuMad: acbuPerCurrency.MAD != null ? new Decimal(acbuPerCurrency.MAD) : null,
    acbuTzs: acbuPerCurrency.TZS != null ? new Decimal(acbuPerCurrency.TZS) : null,
    acbuUgx: acbuPerCurrency.UGX != null ? new Decimal(acbuPerCurrency.UGX) : null,
    acbuXof: acbuPerCurrency.XOF != null ? new Decimal(acbuPerCurrency.XOF) : null,
  };

  await prisma.acbuRate.create({
    data: acbuRateData as unknown as Prisma.AcbuRateCreateInput,
  });
  logger.info("Oracle integration: rates updated", { acbuUsd, change24hUsd });
}

export async function getTwap24h(currency: string): Promise<number | null> {
  return getAverageRateOverHours(currency, 24);
}

/** Average median rate over the last N hours (for circuit breaker / TWAP). */
export async function getAverageRateOverHours(
  currency: string,
  hours: number,
): Promise<number | null> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await prisma.oracleRate.findMany({
    where: { currency, timestamp: { gte: since } },
    orderBy: { timestamp: "asc" },
  });
  if (rows.length === 0) return null;
  const sum = rows.reduce((a: number, r: (typeof rows)[number]) => a + r.medianRate.toNumber(), 0);
  return sum / rows.length;
}
