import { Decimal } from "@prisma/client/runtime/library";

// Provide required env vars before any module that validates them is loaded
process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret";

// Mock prisma before importing the service
jest.mock("../src/config/database", () => ({
  prisma: {
    transaction: {
      aggregate: jest.fn(),
    },
  },
}));

// Mock ReserveTracker circuit breaker dependencies
jest.mock("../src/services/reserve/ReserveTracker", () => ({
  reserveTracker: {
    getReserveStatus: jest.fn(),
    calculateReserveRatio: jest.fn(),
  },
  ReserveTracker: {
    SEGMENT_TRANSACTIONS: "transactions",
  },
}));

import { prisma } from "../src/config/database";
import {
  checkDepositLimits,
  checkWithdrawalLimits,
} from "../src/services/limits/limitsService";

const mockAggregate = prisma.transaction.aggregate as jest.Mock;

const ORG_ID = "org-aaaaaaaa-0000-0000-0000-000000000001";

// Business limits: $50,000 daily / $500,000 monthly
const BUSINESS_DEPOSIT_DAILY = 50_000;

function makeAggregateResult(sum: number | null) {
  return {
    _sum: {
      usdcAmount: sum !== null ? new Decimal(sum) : null,
      acbuAmountBurned: sum !== null ? new Decimal(sum) : null,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("checkDepositLimits — org-scoped (B-011)", () => {
  it("allows deposit when org is under daily cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(10_000)) // daily
      .mockResolvedValueOnce(makeAggregateResult(10_000)); // monthly

    await expect(
      checkDepositLimits("business", 5_000, null, ORG_ID),
    ).resolves.toBeUndefined();
  });

  it("blocks deposit when org would exceed daily cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(48_000)) // daily: 48k used
      .mockResolvedValueOnce(makeAggregateResult(48_000)); // monthly

    await expect(
      checkDepositLimits("business", 3_000, null, ORG_ID), // 48k + 3k = 51k > 50k
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("blocks deposit exactly at daily cap boundary", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(BUSINESS_DEPOSIT_DAILY - 1)) // 1 under cap
      .mockResolvedValueOnce(makeAggregateResult(0));

    await expect(
      checkDepositLimits("business", 2, null, ORG_ID), // pushes over by 1
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("allows deposit exactly at daily cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(45_000))
      .mockResolvedValueOnce(makeAggregateResult(45_000));

    await expect(
      checkDepositLimits("business", 5_000, null, ORG_ID), // exactly 50k
    ).resolves.toBeUndefined();
  });

  it("blocks deposit when org would exceed monthly cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(0)) // daily fine
      .mockResolvedValueOnce(makeAggregateResult(498_000)); // monthly: 498k used

    await expect(
      checkDepositLimits("business", 3_000, null, ORG_ID), // 498k + 3k = 501k > 500k
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("uses organizationId dimension — queries include org transactions with userId=null", async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult(0));
    await checkDepositLimits("business", 100, null, ORG_ID);

    // Both daily and monthly queries should have been called
    expect(mockAggregate).toHaveBeenCalledTimes(2);

    // The where clause should contain OR with direct organizationId filter
    const [firstCall] = mockAggregate.mock.calls;
    const where = firstCall[0].where;
    expect(where).toHaveProperty("OR");
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ organizationId: ORG_ID }),
      ]),
    );
  });

  it("retail org cannot exceed lower retail daily cap ($5,000)", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(4_900))
      .mockResolvedValueOnce(makeAggregateResult(4_900));

    await expect(
      checkDepositLimits("retail", 200, null, ORG_ID), // 4900 + 200 = 5100 > 5000
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("no actor (userId=null, organizationId=null) hits the null-fallback path", async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult(0));
    await checkDepositLimits("retail", 100, null, null);

    const [firstCall] = mockAggregate.mock.calls;
    const where = firstCall[0].where;
    expect(where).toMatchObject({ userId: null });
    expect(where).not.toHaveProperty("OR");
  });
});

describe("checkWithdrawalLimits — org-scoped (B-011)", () => {
  it("allows withdrawal when org is under daily cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(10_000))
      .mockResolvedValueOnce(makeAggregateResult(10_000));

    await expect(
      checkWithdrawalLimits("business", 5_000, "NGN", null, ORG_ID),
    ).resolves.toBeUndefined();
  });

  it("blocks withdrawal when org would exceed daily cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(98_000)) // daily
      .mockResolvedValueOnce(makeAggregateResult(98_000)); // monthly

    await expect(
      checkWithdrawalLimits("business", 3_000, "NGN", null, ORG_ID), // 98k + 3k > 100k
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("blocks withdrawal when org would exceed monthly cap", async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult(0)) // daily fine
      .mockResolvedValueOnce(makeAggregateResult(798_000)); // monthly

    await expect(
      checkWithdrawalLimits("business", 3_000, "NGN", null, ORG_ID), // 798k + 3k > 800k
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("uses organizationId dimension in withdrawal queries", async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult(0));
    await checkWithdrawalLimits("business", 100, "KES", null, ORG_ID);

    expect(mockAggregate).toHaveBeenCalledTimes(2);
    const [firstCall] = mockAggregate.mock.calls;
    const where = firstCall[0].where;
    expect(where).toHaveProperty("OR");
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ organizationId: ORG_ID }),
      ]),
    );
  });
});
