/**
 * Oracle rate updates and the 5% deviation rule (W10-DOC-014).
 *
 * A rate move larger than ORACLE_MAX_DEVIATION_PER_UPDATE is an emergency
 * update: it must carry the review flag on the persisted OracleRate row and be
 * logged, rather than being rejected outright or silently applied.
 */

import { Decimal } from "@prisma/client/runtime/library";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    oracleRate: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    acbuRate: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("../src/services/basket", () => ({
  basketService: { getCurrentBasket: jest.fn() },
}));

jest.mock("../src/services/fintech", () => ({ getFintechRouter: jest.fn() }));

jest.mock("../src/services/fintech/simulated", () => ({
  SimulatedFintechProvider: class SimulatedFintechProvider {},
}));

jest.mock("../src/services/oracle/centralBankClient", () => ({
  fetchCentralBankRateUsd: jest.fn(),
}));

jest.mock("../src/services/oracle/forexClient", () => ({
  fetchForexRateUsd: jest.fn(),
}));

jest.mock("../src/services/metrics/worldBankClient", () => ({
  fetchExchangeRate: jest.fn(),
}));

jest.mock("../src/services/oracle/syntheticBasket", () => ({
  computeSyntheticBasketOneAcbuForBasket: jest.fn(),
}));

jest.mock("../src/services/contracts", () => ({
  acbuOracleService: { updateRate: jest.fn() },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: { getKeypair: jest.fn() },
}));

jest.mock("../src/config/contracts", () => ({
  getContractAddresses: jest.fn(() => ({})),
}));

import { assessRateDeviation, fetchAndStoreRates } from "../src/services/oracle/integrationService";
import { prisma } from "../src/config/database";
import { basketService } from "../src/services/basket";
import { getFintechRouter } from "../src/services/fintech";
import { fetchCentralBankRateUsd } from "../src/services/oracle/centralBankClient";
import { fetchForexRateUsd } from "../src/services/oracle/forexClient";
import { fetchExchangeRate } from "../src/services/metrics/worldBankClient";
import { computeSyntheticBasketOneAcbuForBasket } from "../src/services/oracle/syntheticBasket";
import { logger } from "../src/config/logger";

const oracleRateMock = prisma.oracleRate as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
};
const acbuRateMock = prisma.acbuRate as unknown as {
  findFirst: jest.Mock;
  create: jest.Mock;
};

const MAX_DEVIATION = 0.05;

/** Feed every configured source the same rate so the composite equals `rate`. */
function mockSourcesAt(rate: number): void {
  (fetchCentralBankRateUsd as jest.Mock).mockResolvedValue(rate);
  (fetchForexRateUsd as jest.Mock).mockResolvedValue(rate);
  (fetchExchangeRate as jest.Mock).mockResolvedValue(rate);
}

function persistedRate(): { rateUsd: Decimal; rawValues: Record<string, unknown> } {
  expect(oracleRateMock.create).toHaveBeenCalledTimes(1);
  return oracleRateMock.create.mock.calls[0][0].data;
}

describe("assessRateDeviation (5% rule)", () => {
  it("reports no deviation when there is no previous rate (bootstrap)", () => {
    expect(assessRateDeviation(null, 100, MAX_DEVIATION)).toEqual({
      deviation: null,
      reviewRequired: false,
    });
  });

  it("does not flag a move at or below the limit", () => {
    const result = assessRateDeviation(100, 105, MAX_DEVIATION);
    expect(result.deviation).toBeCloseTo(0.05, 10);
    expect(result.reviewRequired).toBe(false);
  });

  it("flags a move above the limit as an emergency needing review", () => {
    const result = assessRateDeviation(100, 105.0001, MAX_DEVIATION);
    expect(result.deviation).toBeCloseTo(0.050001, 6);
    expect(result.reviewRequired).toBe(true);
  });

  it("treats downward moves symmetrically", () => {
    const result = assessRateDeviation(100, 90, MAX_DEVIATION);
    expect(result.deviation).toBeCloseTo(0.1, 10);
    expect(result.reviewRequired).toBe(true);
  });

  it("treats a non-positive or unknown previous rate as no baseline", () => {
    expect(assessRateDeviation(0, 100, MAX_DEVIATION).reviewRequired).toBe(false);
    expect(assessRateDeviation(Number.NaN, 100, MAX_DEVIATION).deviation).toBeNull();
  });
});

describe("fetchAndStoreRates emergency review flag", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([{ currency: "NGN" }]);
    (getFintechRouter as jest.Mock).mockReturnValue({
      getProvider: jest.fn().mockRejectedValue(new Error("no provider")),
    });
    (computeSyntheticBasketOneAcbuForBasket as jest.Mock).mockResolvedValue(null);

    oracleRateMock.create.mockResolvedValue({});
    acbuRateMock.findFirst.mockResolvedValue(null);
    acbuRateMock.create.mockResolvedValue({});
  });

  it("flags and logs an emergency update when the rate moves more than 5%", async () => {
    oracleRateMock.findFirst.mockResolvedValue({ medianRate: new Decimal(100) });
    mockSourcesAt(108);

    await fetchAndStoreRates();

    const data = persistedRate();
    expect(data.rawValues.reviewRequired).toBe(true);
    expect(data.rawValues.deviationFromPreviousRate).toBeCloseTo(0.08, 10);
    expect(data.rawValues.worldBankRate).toBe(108);
    expect(logger.warn).toHaveBeenCalledWith(
      "Oracle: emergency rate update flagged for review",
      expect.objectContaining({ currency: "NGN", reviewRequired: true, deviation: 0.08 }),
    );
  });

  it("stores no review flag for an ordinary update within the limit", async () => {
    oracleRateMock.findFirst.mockResolvedValue({ medianRate: new Decimal(100) });
    mockSourcesAt(102);

    await fetchAndStoreRates();

    const data = persistedRate();
    expect(data.rawValues.reviewRequired).toBe(false);
    expect(data.rawValues.deviationFromPreviousRate).toBeCloseTo(0.02, 10);
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Oracle: emergency rate update flagged for review",
      expect.anything(),
    );
  });

  it("stores no review flag on the first (bootstrap) rate for a currency", async () => {
    oracleRateMock.findFirst.mockResolvedValue(null);
    mockSourcesAt(150);

    await fetchAndStoreRates();

    const data = persistedRate();
    expect(data.rawValues.reviewRequired).toBe(false);
    expect(data.rawValues.deviationFromPreviousRate).toBeNull();
  });

  it("keeps the review flag based on the raw move while the circuit breaker smooths the rate", async () => {
    oracleRateMock.findFirst.mockResolvedValue({ medianRate: new Decimal(100) });
    oracleRateMock.findMany.mockResolvedValue([
      { medianRate: new Decimal(100) },
      { medianRate: new Decimal(100) },
    ]);
    mockSourcesAt(125); // 25% raw move → circuit breaker (> 10%)

    await fetchAndStoreRates();

    const data = persistedRate();
    // Published value is the 48h average, but the emergency still needs review.
    expect(data.rateUsd.toNumber()).toBeCloseTo(100, 10);
    expect(data.rawValues.reviewRequired).toBe(true);
    expect(data.rawValues.deviationFromPreviousRate).toBeCloseTo(0.25, 10);
  });
});
