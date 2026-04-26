/**
 * Deposit, withdrawal, and circuit breaker limits.
 * Runtime source of truth is limits_config in DB, with env/default fallback.
 */
import type { Audience } from "../middleware/auth";
import { prisma } from "./database";

export interface LimitConfig {
  depositDailyUsd: number;
  depositMonthlyUsd: number;
  withdrawalSingleCurrencyDailyUsd: number;
  withdrawalSingleCurrencyMonthlyUsd: number;
}

export interface CircuitBreakerLimitConfig {
  reserveWeightThresholdPct: number;
  minReserveRatio: number;
}

type LimitsSnapshot = {
  audiences: Record<Audience, LimitConfig>;
  circuitBreaker: CircuitBreakerLimitConfig;
};

const LIMIT_CONFIG_SCOPES = [
  "retail",
  "business",
  "government",
  "circuit_breaker",
] as const;

let cachedSnapshot: LimitsSnapshot | null = null;
let cacheExpiresAt = 0;
let refreshPromise: Promise<LimitsSnapshot> | null = null;

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envLimits(): LimitsSnapshot {
  return {
    audiences: {
      retail: {
        depositDailyUsd: readNumber("LIMIT_RETAIL_DEPOSIT_DAILY_USD", 5000),
        depositMonthlyUsd: readNumber(
          "LIMIT_RETAIL_DEPOSIT_MONTHLY_USD",
          50000,
        ),
        withdrawalSingleCurrencyDailyUsd: readNumber(
          "LIMIT_RETAIL_WITHDRAWAL_DAILY_USD",
          10000,
        ),
        withdrawalSingleCurrencyMonthlyUsd: readNumber(
          "LIMIT_RETAIL_WITHDRAWAL_MONTHLY_USD",
          80000,
        ),
      },
      business: {
        depositDailyUsd: readNumber("LIMIT_BUSINESS_DEPOSIT_DAILY_USD", 50000),
        depositMonthlyUsd: readNumber(
          "LIMIT_BUSINESS_DEPOSIT_MONTHLY_USD",
          500000,
        ),
        withdrawalSingleCurrencyDailyUsd: readNumber(
          "LIMIT_BUSINESS_WITHDRAWAL_DAILY_USD",
          100000,
        ),
        withdrawalSingleCurrencyMonthlyUsd: readNumber(
          "LIMIT_BUSINESS_WITHDRAWAL_MONTHLY_USD",
          800000,
        ),
      },
      government: {
        depositDailyUsd: readNumber("LIMIT_GOV_DEPOSIT_DAILY_USD", 500000),
        depositMonthlyUsd: readNumber("LIMIT_GOV_DEPOSIT_MONTHLY_USD", 5000000),
        withdrawalSingleCurrencyDailyUsd: readNumber(
          "LIMIT_GOV_WITHDRAWAL_DAILY_USD",
          500000,
        ),
        withdrawalSingleCurrencyMonthlyUsd: readNumber(
          "LIMIT_GOV_WITHDRAWAL_MONTHLY_USD",
          4000000,
        ),
      },
    },
    circuitBreaker: {
      reserveWeightThresholdPct: readNumber(
        "LIMIT_CIRCUIT_BREAKER_RESERVE_WEIGHT_PCT",
        10,
      ),
      minReserveRatio: readNumber("LIMIT_CIRCUIT_BREAKER_MIN_RATIO", 1.02),
    },
  };
}

function cacheTtlMs(): number {
  return readNumber("LIMIT_CONFIG_CACHE_TTL_MS", 5000);
}

function numberFromJson(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function applyLimitOverrides(
  current: LimitConfig,
  overrides: Record<string, unknown>,
): LimitConfig {
  return {
    depositDailyUsd:
      numberFromJson(overrides.depositDailyUsd) ?? current.depositDailyUsd,
    depositMonthlyUsd:
      numberFromJson(overrides.depositMonthlyUsd) ?? current.depositMonthlyUsd,
    withdrawalSingleCurrencyDailyUsd:
      numberFromJson(overrides.withdrawalSingleCurrencyDailyUsd) ??
      current.withdrawalSingleCurrencyDailyUsd,
    withdrawalSingleCurrencyMonthlyUsd:
      numberFromJson(overrides.withdrawalSingleCurrencyMonthlyUsd) ??
      current.withdrawalSingleCurrencyMonthlyUsd,
  };
}

function applyCircuitBreakerOverrides(
  current: CircuitBreakerLimitConfig,
  overrides: Record<string, unknown>,
): CircuitBreakerLimitConfig {
  return {
    reserveWeightThresholdPct:
      numberFromJson(overrides.reserveWeightThresholdPct) ??
      current.reserveWeightThresholdPct,
    minReserveRatio:
      numberFromJson(overrides.minReserveRatio) ?? current.minReserveRatio,
  };
}

async function loadLimitsSnapshot(): Promise<LimitsSnapshot> {
  const snapshot = envLimits();
  const delegate = (
    prisma as unknown as {
      limitConfig?: {
        findMany: (
          args: unknown,
        ) => Promise<Array<{ scope: string; values: unknown }>>;
      };
    }
  ).limitConfig;

  if (!delegate) return snapshot;

  try {
    const rows = await delegate.findMany({
      where: { scope: { in: [...LIMIT_CONFIG_SCOPES] } },
    });

    for (const row of rows) {
      if (!row.values || typeof row.values !== "object") continue;
      const values = row.values as Record<string, unknown>;

      if (row.scope === "circuit_breaker") {
        snapshot.circuitBreaker = applyCircuitBreakerOverrides(
          snapshot.circuitBreaker,
          values,
        );
        continue;
      }

      if (
        row.scope === "retail" ||
        row.scope === "business" ||
        row.scope === "government"
      ) {
        snapshot.audiences[row.scope] = applyLimitOverrides(
          snapshot.audiences[row.scope],
          values,
        );
      }
    }
  } catch {
    return cachedSnapshot ?? snapshot;
  }

  return snapshot;
}

export function invalidateLimitsConfigCache(): void {
  cachedSnapshot = null;
  cacheExpiresAt = 0;
  refreshPromise = null;
}

export async function getLimitsSnapshot(): Promise<LimitsSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && now < cacheExpiresAt) {
    return cachedSnapshot;
  }

  refreshPromise ??= loadLimitsSnapshot().finally(() => {
    refreshPromise = null;
  });

  cachedSnapshot = await refreshPromise;
  cacheExpiresAt = now + cacheTtlMs();
  return cachedSnapshot;
}

export async function getLimitConfig(audience: Audience): Promise<LimitConfig> {
  const snapshot = await getLimitsSnapshot();
  return snapshot.audiences[audience];
}

/** Circuit breaker: pause single-currency withdrawal if reserve below this % of target weight. */
export async function getCircuitBreakerReserveWeightThresholdPct(): Promise<number> {
  const snapshot = await getLimitsSnapshot();
  return snapshot.circuitBreaker.reserveWeightThresholdPct;
}

/** Pause new minting if total reserve ratio below this (e.g. 1.02 = 102%). */
export async function getCircuitBreakerMinReserveRatio(): Promise<number> {
  const snapshot = await getLimitsSnapshot();
  return snapshot.circuitBreaker.minReserveRatio;
}
