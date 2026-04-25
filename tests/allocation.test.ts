/**
 * Investment allocation service tests
 *
 * Coverage:
 * - Scenario A: Non-zero deployed state (warm start)
 * - Scenario B: Full utilization (deployed >= limit)
 * - Decimal precision (no floating-point errors)
 * - Policy violation enforcement
 * - Allocation/deallocation atomicity
 */

import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../src/config/database";
import {
  computeDeployableAllocation,
  getStrategyAllocation,
  allocateToStrategy,
  deallocateFromStrategy,
  PolicyViolationError,
} from "../src/services/investment";

// Mock the reserve tracker
jest.mock("../src/services/reserve/ReserveTracker", () => ({
  reserveTracker: {
    getReserveStatus: jest.fn(),
  },
  ReserveTracker: {
    SEGMENT_INVESTMENT_SAVINGS: "investment_savings",
  },
}));

import { reserveTracker } from "../src/services/reserve/ReserveTracker";

describe("Investment Allocation Service", () => {
  let testStrategyId: string;

  beforeEach(async () => {
    // Clean up test data
    await prisma.investmentStrategy.deleteMany({});

    // Create a test strategy with $100,000 limit
    const strategy = await prisma.investmentStrategy.create({
      data: {
        name: "Test Yield Strategy",
        description: "Test strategy for allocation tests",
        status: "active",
        policyLimitUsd: new Decimal("100000.00"),
        deployedNotionalUsd: new Decimal("0.00"),
        targetApyBps: 500, // 5% APY
        riskTier: "medium",
      },
    });
    testStrategyId = strategy.id;

    // Mock reserve tracker to return $200,000 total reserve
    (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
      totalReserveValueUsd: 200000,
    });
  });

  afterEach(async () => {
    await prisma.investmentStrategy.deleteMany({});
  });

  describe("computeDeployableAllocation", () => {
    it("returns correct deployable amount with zero deployed (cold start)", async () => {
      const result = await computeDeployableAllocation();

      expect(result.segment).toBe("investment_savings");
      expect(result.totalReserveValueUsd).toBe("200000.00");
      // 50% of 200k = 100k
      expect(result.deployableUsd).toBe("100000.00");
      expect(result.deployedUsd).toBe("0.00");
      expect(result.availableToDeployUsd).toBe("100000.00");
    });

    it("subtracts deployed notional from available (warm start)", async () => {
      // Deploy $50,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("50000.00") },
      });

      const result = await computeDeployableAllocation();

      expect(result.deployableUsd).toBe("100000.00");
      expect(result.deployedUsd).toBe("50000.00");
      // Available = 100k - 50k = 50k
      expect(result.availableToDeployUsd).toBe("50000.00");
    });

    it("returns zero available when fully deployed", async () => {
      // Deploy $100,000 (full deployable amount)
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("100000.00") },
      });

      const result = await computeDeployableAllocation();

      expect(result.deployedUsd).toBe("100000.00");
      expect(result.availableToDeployUsd).toBe("0.00");
    });

    it("handles multiple strategies correctly", async () => {
      // Create second strategy
      await prisma.investmentStrategy.create({
        data: {
          name: "Second Strategy",
          status: "active",
          policyLimitUsd: new Decimal("50000.00"),
          deployedNotionalUsd: new Decimal("30000.00"),
          riskTier: "low",
        },
      });

      // First strategy has $20k deployed
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("20000.00") },
      });

      const result = await computeDeployableAllocation();

      // Total deployed = 20k + 30k = 50k
      expect(result.deployedUsd).toBe("50000.00");
      // Available = 100k - 50k = 50k
      expect(result.availableToDeployUsd).toBe("50000.00");
    });

    it("uses decimal precision (no floating-point errors)", async () => {
      // Deploy a tricky amount that would cause floating-point issues
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("33333.33") },
      });

      const result = await computeDeployableAllocation();

      expect(result.deployedUsd).toBe("33333.33");
      // Available = 100000.00 - 33333.33 = 66666.67
      expect(result.availableToDeployUsd).toBe("66666.67");
    });
  });

  describe("getStrategyAllocation", () => {
    it("returns correct allocation status for strategy", async () => {
      const result = await getStrategyAllocation(testStrategyId);

      expect(result.strategyId).toBe(testStrategyId);
      expect(result.strategyName).toBe("Test Yield Strategy");
      expect(result.policyLimitUsd).toBe("100000.00");
      expect(result.deployedNotionalUsd).toBe("0.00");
      expect(result.availableToDeployUsd).toBe("100000.00");
      expect(result.utilizationPercent).toBe("0.00");
    });

    it("calculates utilization correctly", async () => {
      // Deploy $60,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("60000.00") },
      });

      const result = await getStrategyAllocation(testStrategyId);

      expect(result.deployedNotionalUsd).toBe("60000.00");
      expect(result.availableToDeployUsd).toBe("40000.00");
      // Utilization = (60k / 100k) * 100 = 60%
      expect(result.utilizationPercent).toBe("60.00");
    });

    it("throws error for non-existent strategy", async () => {
      await expect(
        getStrategyAllocation("00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow("not found");
    });

    it("throws error for inactive strategy", async () => {
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { status: "paused" },
      });

      await expect(getStrategyAllocation(testStrategyId)).rejects.toThrow(
        "not active",
      );
    });
  });

  describe("allocateToStrategy - Scenario A: Non-zero state", () => {
    it("allows allocation within available capacity", async () => {
      // Pre-deploy $50,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("50000.00") },
      });

      // Attempt to allocate $40,000 (within the $50k available)
      await allocateToStrategy(testStrategyId, "40000.00");

      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("90000.00");
    });

    it("rejects allocation that would exceed limit (Scenario A)", async () => {
      // Pre-deploy $50,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("50000.00") },
      });

      // Attempt to allocate $60,000 when only $50k is available
      await expect(
        allocateToStrategy(testStrategyId, "60000.00"),
      ).rejects.toThrow(PolicyViolationError);

      // Verify deployed amount unchanged
      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });
      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("50000.00");
    });

    it("allows allocation up to exact limit", async () => {
      // Pre-deploy $50,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("50000.00") },
      });

      // Allocate exactly the remaining $50k
      await allocateToStrategy(testStrategyId, "50000.00");

      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("100000.00");
    });
  });

  describe("allocateToStrategy - Scenario B: Full utilization", () => {
    it("rejects allocation when deployed >= limit", async () => {
      // Deploy full $100,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("100000.00") },
      });

      // Attempt to allocate any amount
      await expect(
        allocateToStrategy(testStrategyId, "1000.00"),
      ).rejects.toThrow(PolicyViolationError);

      // Verify deployed amount unchanged
      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });
      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("100000.00");
    });

    it("provides clear error message with available capacity", async () => {
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("95000.00") },
      });

      try {
        await allocateToStrategy(testStrategyId, "10000.00");
        fail("Should have thrown PolicyViolationError");
      } catch (error) {
        expect(error).toBeInstanceOf(PolicyViolationError);
        expect((error as Error).message).toContain("Available: 5000.00 USD");
        expect((error as Error).message).toContain("Limit: 100000.00 USD");
        expect((error as Error).message).toContain(
          "Currently deployed: 95000.00 USD",
        );
      }
    });
  });

  describe("allocateToStrategy - Edge cases", () => {
    it("rejects negative allocation", async () => {
      await expect(
        allocateToStrategy(testStrategyId, "-1000.00"),
      ).rejects.toThrow("must be positive");
    });

    it("rejects zero allocation", async () => {
      await expect(
        allocateToStrategy(testStrategyId, "0.00"),
      ).rejects.toThrow("must be positive");
    });

    it("rejects allocation to inactive strategy", async () => {
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { status: "paused" },
      });

      await expect(
        allocateToStrategy(testStrategyId, "1000.00"),
      ).rejects.toThrow(PolicyViolationError);
    });

    it("handles decimal precision correctly", async () => {
      // Allocate $33,333.33
      await allocateToStrategy(testStrategyId, "33333.33");

      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("33333.33");

      // Allocate another $33,333.33
      await allocateToStrategy(testStrategyId, "33333.33");

      const updated = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      expect(updated!.deployedNotionalUsd.toFixed(2)).toBe("66666.66");
    });
  });

  describe("deallocateFromStrategy", () => {
    it("reduces deployed notional correctly", async () => {
      // Deploy $60,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("60000.00") },
      });

      // Deallocate $20,000
      await deallocateFromStrategy(testStrategyId, "20000.00");

      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("40000.00");
    });

    it("does not go below zero", async () => {
      // Deploy $10,000
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("10000.00") },
      });

      // Deallocate $20,000 (more than deployed)
      await deallocateFromStrategy(testStrategyId, "20000.00");

      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      // Should be clamped to 0
      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("0.00");
    });

    it("rejects negative deallocation", async () => {
      await expect(
        deallocateFromStrategy(testStrategyId, "-1000.00"),
      ).rejects.toThrow("must be positive");
    });

    it("rejects zero deallocation", async () => {
      await expect(
        deallocateFromStrategy(testStrategyId, "0.00"),
      ).rejects.toThrow("must be positive");
    });
  });

  describe("Atomicity and concurrency", () => {
    it("allocation is atomic (transaction rollback on error)", async () => {
      // This test verifies that if allocation fails, no state change occurs
      await prisma.investmentStrategy.update({
        where: { id: testStrategyId },
        data: { deployedNotionalUsd: new Decimal("99000.00") },
      });

      try {
        await allocateToStrategy(testStrategyId, "5000.00");
      } catch (error) {
        // Expected to fail
      }

      const strategy = await prisma.investmentStrategy.findUnique({
        where: { id: testStrategyId },
      });

      // Should still be 99k (no partial update)
      expect(strategy!.deployedNotionalUsd.toFixed(2)).toBe("99000.00");
    });
  });
});
