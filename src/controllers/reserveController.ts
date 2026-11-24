import { Request, Response, NextFunction } from "express";
import { getContractAddresses } from "../config/contracts";
import { ReserveTrackerService } from "../services/contracts/acbuReserveTracker.service";
import { OracleService } from "../services/contracts/acbuOracle.service";
import { BASKET_CURRENCIES } from "../config/basket";
import { reserveTracker } from "../services/reserve/ReserveTracker";
import { contractClient, ContractClient } from "../services/stellar/contractClient";

const DRIFT_THRESHOLD_BPS_WARN_ONLY = 100; // 1.00%

/**
 * @swagger
 * /v1/reserves:
 *   get:
 *     summary: Get current reserve status
 *     tags: [Reserves]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Reserve status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalAcbuSupply:
 *                   type: number
 *                 totalReserveValueUsd:
 *                   type: number
 *                 overcollateralizationRatio:
 *                   type: number
 *                 reserveHealth:
 *                   type: string
 *                 currencies:
 *                   type: array
 */
export const getReserveStatus = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const addresses = getContractAddresses();
    if (!addresses.reserveTracker || !addresses.oracle || !addresses.minting) {
      throw new Error(
        "Missing CONTRACT_RESERVE_TRACKER / CONTRACT_ORACLE / CONTRACT_MINTING in env",
      );
    }

    const reserveSvc = new ReserveTrackerService(addresses.reserveTracker);
    const oracleSvc = new OracleService(addresses.oracle);

    const minRatio = config.reserve.minRatio;
    const targetRatio = config.reserve.targetRatio;

    const [totalReserveValueUsdStr, acbuUsdRateStr, allReserves] = await Promise.all([
      reserveSvc.getTotalReserveValue(),
      oracleSvc.getAcbuUsdRate(),
      reserveSvc.getAllReserves(),
    ]);

    const totalSupplyRes = await contractClient.readContract(
      addresses.minting,
      "get_total_supply",
      [],
    );
    const totalAcbuSupply = ContractClient.fromScVal(totalSupplyRes).toString();

    const totalReserveValueUsd = BigInt(totalReserveValueUsdStr || "0");
    const totalSupply = BigInt(totalAcbuSupply || "0");

    const effectiveRatio =
      totalSupply > 0n ? Number(totalReserveValueUsd) / Number(totalSupply) : null;

    const currencies = await Promise.all(
      BASKET_CURRENCIES.map(async (currency) => {
        const reserve = allReserves[currency] ?? {
          currency,
          amount: "0",
          valueUsd: "0",
          timestamp: 0,
        };
        // W11-CAR-030: never surface a zero/missing oracle price as a real
        // "0" rate; report it as null so consumers can treat it as invalid.
        let rateUsdStr: string | null = null;
        let oracleRateValid = false;
        try {
          rateUsdStr = await oracleSvc.getRate(currency);
          oracleRateValid = true;
        } catch {
          rateUsdStr = null;
        }

        const amount = BigInt(reserve.amount || "0");
        const valueUsd = BigInt(reserve.valueUsd || "0");
        // A positive custody amount with zero USD value is the signature of a
        // zero/missing oracle price (W11-CAR-030); flag it instead of letting a
        // corrupted zero flow into sufficiency/weight math.
        const valueUsdSuspect = amount > 0n && valueUsd <= 0n;

        const actualWeightBps =
          totalReserveValueUsd > 0n && !valueUsdSuspect
            ? Number((valueUsd * 10_000n) / totalReserveValueUsd)
            : 0;

        const targetWeightBpsRes = await contractClient.readContract(
          addresses.oracle,
          "get_basket_weight",
          [ContractClient.toScVal([[currency]])],
        );
        const targetWeightBps = Number(ContractClient.fromScVal(targetWeightBpsRes));

        const driftBps = actualWeightBps - targetWeightBps;
        const driftWarning = Math.abs(driftBps) > DRIFT_THRESHOLD_BPS_WARN_ONLY;

        return {
          currency,
          amount: reserve.amount,
          value_usd: reserve.valueUsd,
          rate_usd: rateUsdStr,
          oracle_rate_valid: oracleRateValid,
          value_usd_suspect: valueUsdSuspect,
          target_weight_bps: targetWeightBps,
          actual_weight_bps: actualWeightBps,
          drift_bps: driftBps,
          in_range: !driftWarning,
          drift_warning: driftWarning,
        };
      }),
    );

    const driftWarnings = currencies.filter((c) => c.drift_warning);

    const health =
      effectiveRatio != null
        ? effectiveRatio >= targetRatio
          ? "healthy"
          : effectiveRatio >= minRatio
            ? "warning"
            : "critical"
        : "unknown";

    res.json({
      source: "onchain",
      total_acbu_supply: totalSupply.toString(),
      total_reserve_value_usd: totalReserveValueUsd.toString(),
      acbu_usd_rate: acbuUsdRateStr,
      min_ratio: minRatio,
      target_ratio: targetRatio,
      effective_ratio: effectiveRatio,
      health,
      weight_law_mode: "warn_only",
      weight_compliance: {
        ok: driftWarnings.length === 0,
        drift_threshold_bps: DRIFT_THRESHOLD_BPS_WARN_ONLY,
        warnings: driftWarnings.map((c) => ({
          currency: c.currency,
          drift_bps: c.drift_bps,
          target_weight_bps: c.target_weight_bps,
          actual_weight_bps: c.actual_weight_bps,
        })),
      },
      currencies,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /v1/reserves/track:
 *   post:
 *     summary: Manually trigger reserve tracking
 *     tags: [Reserves]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Reserve tracking initiated
 */
export const trackReserves = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await reserveTracker.trackReserves();
    res.json({ message: "Reserve tracking completed" });
  } catch (error) {
    next(error);
  }
};
