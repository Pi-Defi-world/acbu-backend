/**
 * W2-B-027 — yieldAccountingService: accrueFromStrategies
 *
 * Acceptance: Yield job runs against real strategy rows.
 *
 * Coverage:
 *  - Normal accrual: principal * (apyBps / 10000) * (days / 365)
 *  - Null targetApyBps strategy is skipped (no yield posted, no transaction)
 *  - Zero targetApyBps strategy is skipped
 *  - Zero deployedNotionalUsd strategy is skipped
 *  - accrual transaction is persisted with strategyId in rateSnapshot
 *  - Multi-strategy: each active strategy accrues independently
 *  - Transient DB error on transaction.create is swallowed (scheduler must not crash)
 *  - Decimal precision: no floating-point drift on financial amounts
 */

/// <reference types="jest" />

import { Decimal } from "@prisma/client/runtime/library";

// ── In-memory store (mirroring allocation.test.ts pattern) ───────────────────
// Must be declared before jest.mock() so the factory closure captures the
// same reference at call time.
type StrategyRow = {
  id: string;
  name: string;
  status: string;
  policyLimitUsd: Decimal;
  deployedNotionalUsd: Decimal;
  targetApyBps: number | null;
  riskTier: string;
};

const db: { strategies: StrategyRow[]; transactions: Record<string, unknown>[] } = {
  strategies: [],
  transactions: [],
};

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `strategy-${_idCounter}`;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock("../src/config/database", () => {
  return {
    prisma: {
      investmentStrategy: {
        findMany: jest.fn(async ({ where }: any) => {
          return db.strategies.filter((s) => {
            if (where?.status) return s.status === where.status;
            return true;
          });
        }),
      },
      transaction: {
        create: jest.fn(async ({ data }: any) => {
          db.transactions.push(data);
          return { id: `tx-${db.transactions.length}`, ...data };
        }),
      },
      $disconnect: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { accrueFromStrategies } from "../src/services/investment/yieldAccountingService";
import { prisma } from "../src/config/database";
import { logger } from "../src/config/logger";

const mockFindMany = prisma.investmentStrategy.findMany as jest.Mock;
const mockTransactionCreate = prisma.transaction.create as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeStrategy(overrides: Partial<StrategyRow> = {}): StrategyRow {
  return {
    id: nextId(),
    name: `Strategy ${_idCounter}`,
    status: "active",
    policyLimitUsd: new Decimal("500000.00"),
    deployedNotionalUsd: new Decimal("100000.00"),
    targetApyBps: 500, // 5 % APY
    riskTier: "medium",
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────
describe("accrueFromStrategies (W2-B-027)", () => {
  beforeEach(() => {
    db.strategies = [];
    db.transactions = [];
    jest.clearAllMocks();
    // Re-point the mock fns at the refreshed db arrays
    mockFindMany.mockImplementation(async ({ where }: any) =>
      db.strategies.filter((s) => (where?.status ? s.status === where.status : true)),
    );
    mockTransactionCreate.mockImplementation(async ({ data }: any) => {
      db.transactions.push(data);
      return { id: `tx-${db.transactions.length}`, ...data };
    });
  });

  // ── 1. Normal accrual math ────────────────────────────────────────────────
  it("computes accrual using principal × (apyBps/10000) × (days/365)", async () => {
    const strategy = makeStrategy({
      deployedNotionalUsd: new Decimal("100000.00"),
      targetApyBps: 500, // 5 %
    });
    db.strategies.push(strategy);

    const asOf = new Date("2026-09-01T00:00:00.000Z");
    await accrueFromStrategies(1, asOf);

    // Expected: 100_000 * (500/10_000) * (1/365) = 100_000 * 0.05 / 365 ≈ 13.69863014
    const expected = new Decimal("100000")
      .mul(new Decimal("500").div(10000))
      .mul(1)
      .div(365)
      .toFixed(8);

    expect(mockTransactionCreate).toHaveBeenCalledTimes(1);
    const [call] = mockTransactionCreate.mock.calls;
    const { data } = call[0];
    expect(data.type).toBe("accrual");
    expect(data.status).toBe("completed");
    // Decimal amount matches the expected value to 8dp
    expect(new Decimal(data.usdcAmount.toFixed(8)).toFixed(8)).toBe(expected);
    expect(data.completedAt).toEqual(asOf);
  });

  // ── 2. strategyId persisted in rateSnapshot ───────────────────────────────
  it("attaches strategyId to the persisted accrual transaction's rateSnapshot", async () => {
    const strategy = makeStrategy({ id: "strat-uuid-001" });
    db.strategies.push(strategy);

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).toHaveBeenCalledTimes(1);
    const { data } = mockTransactionCreate.mock.calls[0][0];
    expect(data.rateSnapshot).toMatchObject({
      source: "yield_accrual",
      strategyId: "strat-uuid-001",
    });
  });

  // ── 3. null targetApyBps is skipped ──────────────────────────────────────
  it("skips a strategy with null targetApyBps — no yield recorded, no DB write", async () => {
    db.strategies.push(makeStrategy({ targetApyBps: null }));

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).not.toHaveBeenCalled();
  });

  // ── 4. zero targetApyBps is skipped ──────────────────────────────────────
  it("skips a strategy with targetApyBps = 0", async () => {
    db.strategies.push(makeStrategy({ targetApyBps: 0 }));

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).not.toHaveBeenCalled();
  });

  // ── 5. negative targetApyBps is skipped ──────────────────────────────────
  it("skips a strategy with negative targetApyBps", async () => {
    db.strategies.push(makeStrategy({ targetApyBps: -100 }));

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).not.toHaveBeenCalled();
  });

  // ── 6. zero deployedNotionalUsd is skipped ───────────────────────────────
  it("skips a strategy with deployedNotionalUsd = 0 (no principal to accrue on)", async () => {
    db.strategies.push(makeStrategy({ deployedNotionalUsd: new Decimal("0") }));

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).not.toHaveBeenCalled();
  });

  // ── 7. multi-strategy: each active strategy accrues independently ─────────
  it("accrues across multiple active strategies independently", async () => {
    const s1 = makeStrategy({
      id: "strat-A",
      deployedNotionalUsd: new Decimal("200000.00"),
      targetApyBps: 300, // 3 %
    });
    const s2 = makeStrategy({
      id: "strat-B",
      deployedNotionalUsd: new Decimal("50000.00"),
      targetApyBps: 800, // 8 %
    });
    db.strategies.push(s1, s2);

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).toHaveBeenCalledTimes(2);

    const stratIds = mockTransactionCreate.mock.calls.map(
      ([{ data }]: any) => data.rateSnapshot.strategyId,
    );
    expect(stratIds).toContain("strat-A");
    expect(stratIds).toContain("strat-B");
  });

  // ── 8. paused/inactive strategies are excluded ───────────────────────────
  it("does not accrue for strategies that are not active", async () => {
    // The service fetches with { where: { status: 'active' } } — the mock
    // honours that filter, so paused rows must not reach the loop.
    db.strategies.push(
      makeStrategy({ status: "paused" }),
      makeStrategy({ status: "deprecated" }),
    );

    await accrueFromStrategies(1, new Date());

    expect(mockTransactionCreate).not.toHaveBeenCalled();
  });

  // ── 9. transient DB error on transaction.create is swallowed ─────────────
  it("logs and continues when persisting an accrual transaction fails", async () => {
    db.strategies.push(makeStrategy());
    mockTransactionCreate.mockRejectedValueOnce(new Error("DB connection lost"));

    // Should NOT throw even though transaction.create failed
    await expect(accrueFromStrategies(1, new Date())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to persist accrual transaction",
      expect.any(Error),
    );
  });

  // ── 10. pro-rated multi-day accrual ──────────────────────────────────────
  it("scales linearly when days > 1", async () => {
    const strategy = makeStrategy({
      deployedNotionalUsd: new Decimal("365000.00"),
      targetApyBps: 10000, // 100 % APY → $1 000 per day on $365 k
    });
    db.strategies.push(strategy);

    await accrueFromStrategies(7, new Date());

    const { data } = mockTransactionCreate.mock.calls[0][0];
    // 365_000 * (10_000/10_000) * (7/365) = 7_000
    const expected = new Decimal("365000").mul(1).mul(7).div(365).toFixed(8);
    expect(new Decimal(data.usdcAmount.toFixed(8)).toFixed(8)).toBe(expected);
  });

  // ── 11. Decimal precision — no floating-point drift ──────────────────────
  it("uses Decimal arithmetic throughout (no float drift)", async () => {
    // A notional that would produce float drift using native JS arithmetic
    const strategy = makeStrategy({
      deployedNotionalUsd: new Decimal("10000.01"),
      targetApyBps: 333, // 3.33 % APY
    });
    db.strategies.push(strategy);

    await accrueFromStrategies(1, new Date());

    const { data } = mockTransactionCreate.mock.calls[0][0];
    // Verify the result is a Decimal (stored as such) with exactly 8 dp
    const result = new Decimal(data.usdcAmount.toFixed(8));
    expect(result.isFinite()).toBe(true);
    // Cross-check with pure Decimal math — must match exactly
    const exact = new Decimal("10000.01")
      .mul(new Decimal("333").div(10000))
      .mul(1)
      .div(365)
      .toFixed(8);
    expect(result.toFixed(8)).toBe(exact);
  });
});
