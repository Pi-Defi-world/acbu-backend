/**
 * Property-Based Tests for Fee Policy Service
 *
 * These tests use fast-check to generate hundreds of random inputs
 * and verify mathematical properties that must always hold true.
 *
 * To run: pnpm add -D fast-check
 * Then: pnpm test -- feePolicyService.pbt.test.ts
 */

import * as fc from "fast-check";

const finiteDouble = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const mockCalculateReserveRatio = jest.fn<Promise<number>, [string]>();
const mockGetReserveStatus = jest.fn<Promise<any>, [string]>();

jest.mock("../../reserve/ReserveTracker", () => ({
  ReserveTracker: {
    SEGMENT_TRANSACTIONS: "transactions",
  },
  reserveTracker: {
    calculateReserveRatio: mockCalculateReserveRatio,
    getReserveStatus: mockGetReserveStatus,
  },
}));

jest.mock("../../../config/env", () => ({
  config: {
    reserve: {
      minRatio: 1.02,
    },
  },
}));

import { getBurnFeeBps, getMintFeeBps } from "../feePolicyService";

describe("Property-Based Tests: getBurnFeeBps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("PROPERTY: Fee is always within sanity bounds [1, 500] BPS", async () => {
    await fc.assert(
      fc.asyncProperty(
        finiteDouble(0.01, 200), // targetWeight
        finiteDouble(0.01, 200), // actualWeight
        async (targetWeight, actualWeight) => {
          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight,
              },
            ],
          });

          const fee = await getBurnFeeBps("NGN");

          // Fee must be within sanity bounds
          expect(fee).toBeGreaterThanOrEqual(1);
          expect(fee).toBeLessThanOrEqual(500);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Fee is one of exactly three valid values [5, 30, 200]", async () => {
    await fc.assert(
      fc.asyncProperty(
        finiteDouble(0.01, 200),
        finiteDouble(0.01, 200),
        async (targetWeight, actualWeight) => {
          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight,
              },
            ],
          });

          const fee = await getBurnFeeBps("NGN");

          // Fee must be exactly one of the three tier values
          expect([5, 30, 200]).toContain(fee);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Monotonicity - fee decreases as reserve weight increases", async () => {
    await fc.assert(
      fc.asyncProperty(
        finiteDouble(10, 100), // targetWeight
        finiteDouble(0.5, 2.0), // ratio1 (actualWeight/targetWeight)
        finiteDouble(0.5, 2.0), // ratio2
        async (targetWeight, ratio1, ratio2) => {
          const actualWeight1 = targetWeight * ratio1;
          const actualWeight2 = targetWeight * ratio2;

          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight: actualWeight1,
              },
            ],
          });

          const fee1 = await getBurnFeeBps("NGN");

          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight: actualWeight2,
              },
            ],
          });

          const fee2 = await getBurnFeeBps("NGN");

          // If actualWeight2 > actualWeight1, then fee2 <= fee1
          // (higher reserves should have same or lower fees)
          if (actualWeight2 > actualWeight1) {
            expect(fee2).toBeLessThanOrEqual(fee1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Boundary consistency - fees at thresholds are deterministic", async () => {
    const testCases = [
      { pctOfTarget: 84.99, expectedFee: 200 },
      { pctOfTarget: 85.0, expectedFee: 30 },
      { pctOfTarget: 85.01, expectedFee: 30 },
      { pctOfTarget: 114.99, expectedFee: 30 },
      { pctOfTarget: 115.0, expectedFee: 30 },
      { pctOfTarget: 115.01, expectedFee: 5 },
    ];

    for (const { pctOfTarget, expectedFee } of testCases) {
      await fc.assert(
        fc.asyncProperty(
          finiteDouble(1, 100), // targetWeight
          async (targetWeight) => {
            const actualWeight = (targetWeight * pctOfTarget) / 100;

            mockGetReserveStatus.mockResolvedValueOnce({
              currencies: [
                {
                  currency: "NGN",
                  targetWeight,
                  actualWeight,
                },
              ],
            });

            const fee = await getBurnFeeBps("NGN");
            expect(fee).toBe(expectedFee);
          },
        ),
        { numRuns: 20 },
      );
    }
  });

  it("PROPERTY: Fee calculation is deterministic for same inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        finiteDouble(1, 100),
        finiteDouble(1, 100),
        async (targetWeight, actualWeight) => {
          // Call twice with same inputs
          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight,
              },
            ],
          });

          const fee1 = await getBurnFeeBps("NGN");

          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight,
              },
            ],
          });

          const fee2 = await getBurnFeeBps("NGN");

          // Same inputs must produce same output
          expect(fee1).toBe(fee2);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("PROPERTY: Total fee never exceeds maximum cap", async () => {
    await fc.assert(
      fc.asyncProperty(
        finiteDouble(0.01, 200),
        finiteDouble(0.01, 200),
        async (targetWeight, actualWeight) => {
          mockGetReserveStatus.mockResolvedValueOnce({
            currencies: [
              {
                currency: "NGN",
                targetWeight,
                actualWeight,
              },
            ],
          });

          const fee = await getBurnFeeBps("NGN");

          // Fee must never exceed 500 BPS (5%)
          expect(fee).toBeLessThanOrEqual(500);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property-Based Tests: getMintFeeBps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("PROPERTY: Fee is always within sanity bounds [1, 500] BPS", async () => {
    await fc.assert(
      fc.asyncProperty(
        finiteDouble(0.5, 2.0), // reserve ratio
        async (ratio) => {
          mockCalculateReserveRatio.mockResolvedValueOnce(ratio);

          const fee = await getMintFeeBps();

          // Fee must be within sanity bounds
          expect(fee).toBeGreaterThanOrEqual(1);
          expect(fee).toBeLessThanOrEqual(500);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Fee is one of exactly two valid values [30, 50]", async () => {
    await fc.assert(
      fc.asyncProperty(finiteDouble(0.5, 2.0), async (ratio) => {
        mockCalculateReserveRatio.mockResolvedValueOnce(ratio);

        const fee = await getMintFeeBps();

        // Fee must be exactly one of the two tier values
        expect([30, 50]).toContain(fee);
      }),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Fee never exceeds maximum cap of 100 BPS", async () => {
    await fc.assert(
      fc.asyncProperty(finiteDouble(0.1, 3.0), async (ratio) => {
        mockCalculateReserveRatio.mockResolvedValueOnce(ratio);

        const fee = await getMintFeeBps();

        // Fee must never exceed 100 BPS cap
        expect(fee).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Monotonicity - fee decreases as reserve ratio increases", async () => {
    await fc.assert(
      fc.asyncProperty(finiteDouble(0.5, 2.0), finiteDouble(0.5, 2.0), async (ratio1, ratio2) => {
        mockCalculateReserveRatio.mockResolvedValueOnce(ratio1);
        const fee1 = await getMintFeeBps();

        mockCalculateReserveRatio.mockResolvedValueOnce(ratio2);
        const fee2 = await getMintFeeBps();

        // If ratio2 > ratio1, then fee2 <= fee1
        // (higher reserve ratio should have same or lower fees)
        if (ratio2 > ratio1) {
          expect(fee2).toBeLessThanOrEqual(fee1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("PROPERTY: Boundary consistency at minRatio threshold", async () => {
    const minRatio = 1.02;
    const testCases = [
      { ratio: minRatio - 0.01, expectedFee: 50 },
      { ratio: minRatio - 0.001, expectedFee: 50 },
      { ratio: minRatio, expectedFee: 30 },
      { ratio: minRatio + 0.001, expectedFee: 30 },
      { ratio: minRatio + 0.01, expectedFee: 30 },
    ];

    for (const { ratio, expectedFee } of testCases) {
      mockCalculateReserveRatio.mockResolvedValueOnce(ratio);
      const fee = await getMintFeeBps();
      expect(fee).toBe(expectedFee);
    }
  });

  it("PROPERTY: Fee calculation is deterministic for same inputs", async () => {
    await fc.assert(
      fc.asyncProperty(finiteDouble(0.5, 2.0), async (ratio) => {
        // Call twice with same inputs
        mockCalculateReserveRatio.mockResolvedValueOnce(ratio);
        const fee1 = await getMintFeeBps();

        mockCalculateReserveRatio.mockResolvedValueOnce(ratio);
        const fee2 = await getMintFeeBps();

        // Same inputs must produce same output
        expect(fee1).toBe(fee2);
      }),
      { numRuns: 50 },
    );
  });
});
