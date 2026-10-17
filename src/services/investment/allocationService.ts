/**
 * Investment allocation: computes deployable amounts from investment/savings reserve segment
 * and vault/pool liquidity. Used to determine how much can be allocated to yield-bearing strategies.
 *
 * # Financial Math Safety
 * All USD amounts use Prisma Decimal (string-based) to avoid floating-point precision issues.
 * Never use native JavaScript Number for financial calculations.
 *
 * # Allocation Formula
 * Available to Deploy = min(Policy Limit - Current Deployed Notional, Deployable from Reserve)
 * where:
 * - Policy Limit: per-strategy cap defined in investment_strategies table
 * - Current Deployed Notional: live positions tracked in deployed_notional_usd
 * - Deployable from Reserve: totalReserveValueUsd * DEPLOYABLE_FRACTION
 */
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../config/database";
import { reserveTracker, ReserveTracker } from "../reserve/ReserveTracker";

/** Max fraction of investment_savings segment that can be deployed (0-1). Default 0.5. */
const DEPLOYABLE_FRACTION = Number(process.env.INVESTMENT_DEPLOYABLE_FRACTION || "0.5");

export interface AllocationSummary {
  segment: string;
  totalReserveValueUsd: string; // Decimal string
  deployableUsd: string; // Decimal string
  deployedUsd: string; // Decimal string
  availableToDeployUsd: string; // Decimal string
}

export interface StrategyAllocation {
  strategyId: string;
  strategyName: string;
  policyLimitUsd: string; // Decimal string
  deployedNotionalUsd: string; // Decimal string
  availableToDeployUsd: string; // Decimal string
  utilizationPercent: string; // Decimal string (0-100)
}

/**
 * Custom error for policy violations (allocation exceeds limit).
 */
export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

/**
 * Custom error for invalid input validation failures.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Parse and validate a USD amount string as a finite Decimal.
 *
 * @throws ValidationError if the value is not a valid, finite Decimal.
 */
function parseFiniteAmountUsd(amountUsd: string, label: string): Decimal {
  if (typeof amountUsd !== "string" || amountUsd.trim() === "") {
    throw new ValidationError(`${label} must be a non-empty decimal string`);
  }

  if (!Decimal.isDecimal(amountUsd)) {
    throw new ValidationError(`${label} must be a valid decimal number`);
  }

  const amount = new Decimal(amountUsd);

  if (!amount.isFinite()) {
    throw new ValidationError(`${label} must be a finite decimal number`);
  }

  return amount;
}

/**
 * Get total reserve value for the investment_savings segment (from ReserveTracker).
 */
export async function getInvestmentSavingsReserveValueUsd(): Promise<number> {
  const status = await reserveTracker.getReserveStatus(ReserveTracker.SEGMENT_INVESTMENT_SAVINGS);
  return status.totalReserveValueUsd;
}

/**
 * Compute deployable amount (USD) from investment/savings segment for yield strategies.
 * Policy: deployableUsd = totalReserveValueUsd * DEPLOYABLE_FRACTION (config).
 *
 * This returns the aggregate view across all strategies. Use `getStrategyAllocation`
 * for per-strategy limits.
 */
export async function computeDeployableAllocation(): Promise<AllocationSummary> {
  const totalReserveValueUsd = await getInvestmentSavingsReserveValueUsd();
  const totalReserveDecimal = new Decimal(totalReserveValueUsd);

  // Compute deployable from reserve policy
  const deployableFraction = new Decimal(Math.min(1, Math.max(0, DEPLOYABLE_FRACTION)));
  const deployableFromReserve = totalReserveDecimal.mul(deployableFraction);

  // Fetch total deployed notional across all active strategies
  const aggregateResult = await prisma.investmentStrategy.aggregate({
    where: { status: "active" },
    _sum: { deployedNotionalUsd: true },
  });

  const totalDeployed = aggregateResult._sum.deployedNotionalUsd || new Decimal(0);

  // Available = deployable from reserve - already deployed
  const availableToDeployUsd = Decimal.max(
    new Decimal(0),
    deployableFromReserve.sub(totalDeployed),
  );

  return {
    segment: ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
    totalReserveValueUsd: totalReserveDecimal.toFixed(2),
    deployableUsd: deployableFromReserve.toFixed(2),
    deployedUsd: totalDeployed.toFixed(2),
    availableToDeployUsd: availableToDeployUsd.toFixed(2),
  };
}

/**
 * Get allocation status for a specific strategy.
 *
 * # Formula
 * Available to Deploy = Policy Limit - Current Deployed Notional
 *
 * # Errors
 * Throws if strategy does not exist or is not active.
 *
 * @param strategyId - UUID of the investment strategy
 * @returns StrategyAllocation with available capacity
 */
export async function getStrategyAllocation(strategyId: string): Promise<StrategyAllocation> {
  const strategy = await prisma.investmentStrategy.findUnique({
    where: { id: strategyId },
  });

  if (!strategy) {
    throw new ValidationError(`Strategy ${strategyId} not found`);
  }

  if (strategy.status !== "active") {
    throw new PolicyViolationError(
      `Strategy ${strategy.name} is ${strategy.status}, not active`,
    );
  }

  const policyLimit = strategy.policyLimitUsd;
  const deployed = strategy.deployedNotionalUsd;

  // Available = limit - deployed (never negative)
  const available = Decimal.max(new Decimal(0), policyLimit.sub(deployed));

  // Utilization = (deployed / limit) * 100
  const utilization = policyLimit.isZero() ? new Decimal(0) : deployed.div(policyLimit).mul(100);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    policyLimitUsd: policyLimit.toFixed(2),
    deployedNotionalUsd: deployed.toFixed(2),
    availableToDeployUsd: available.toFixed(2),
    utilizationPercent: utilization.toFixed(2),
  };
}

/**
 * Validate and reserve allocation capacity for a strategy.
 *
 * # Policy Enforcement
 * - Reverts if amount would push deployed notional above policy limit
 * - Reverts if strategy is not active
 * - Updates deployed_notional_usd atomically
 *
 * # Usage
 * Call this before executing an allocation to ensure capacity and reserve it.
 *
 * @param strategyId - UUID of the investment strategy
 * @param amountUsd - Amount to allocate (Decimal string)
 * @throws ValidationError if amountUsd is not a finite decimal or is not positive
 * @throws PolicyViolationError if allocation would exceed limit
 */
export async function allocateToStrategy(strategyId: string, amountUsd: string): Promise<void> {
  const amount = parseFiniteAmountUsd(amountUsd, "Allocation amount");

  if (amount.lte(0)) {
    throw new ValidationError("Allocation amount must be positive");
  }

  // Use transaction to ensure atomicity
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const strategy = await tx.investmentStrategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new ValidationError(`Strategy ${strategyId} not found`);
    }

    if (strategy.status !== "active") {
      throw new PolicyViolationError(
        `Strategy ${strategy.name} is ${strategy.status}, cannot allocat`,
      );
    }

    const newDeployed = strategy.deployedNotionalUsd.add(amount);

    if (newDeployed.gt(strategy.policyLimitUsd)) {
      const available = strategy.policyLimitUsd.sub(strategy.deployedNotionalUsd);
      throw new PolicyViolationError(
        `Allocation of ${amount.toFixed(2)} USD would exceed policy limit. ` +
          `Available: ${available.toFixed(2)} USD, ` +
          `Limit: ${strategy.policyLimitUsd.toFixed(2)} USD, ` +
          `Currently deployed: ${strategy.deployedNotionalUsd.toFixed(2)} USD`,
      );
    }

    // Update deployed notional
    await tx.investmentStrategy.update({
      where: { id: strategyId },
      data: { deployedNotionalUsd: newDeployed },
    });
  });
}

/**
 * Release allocation capacity when divesting from a strategy.
 *
 * @param strategyId - UUID of the investment strategy
 * @param amountUsd - Amount to release (Decimal string)
 * @throws ValidationError if amountUsd is not a finite decimal or is not positive
 */
export async function deallocateFromStrategy(strategyId: string, amountUsd: string): Promise<void> {
  const amount = parseFiniteAmountUsd(amountUsd, "Deallocation amount");

  if (amount.lte(0)) {
    throw new ValidationError("Deallocation amount must be positive");
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const strategy = await tx.investmentStrategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new ValidationError(`Strategy ${strategyId} not found`);
    }

    const newDeployed = Decimal.max(new Decimal(0), strategy.deployedNotionalUsd.sub(amount));

    await tx.investmentStrategy.update({
      where: { id: strategyId },
      data: { deployedNotionalUsd: newDeployed },
    });
  });
}
