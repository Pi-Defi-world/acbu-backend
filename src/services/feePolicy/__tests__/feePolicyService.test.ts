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

import { getBurnFeeBps } from "../feePolicyService";

describe("getBurnFeeBps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns high burn fee when reserve is below 85% of target", async () => {
    mockGetReserveStatus.mockResolvedValueOnce({
      currencies: [
        {
          currency: "NGN",
          targetWeight: 40,
          actualWeight: 33,
        },
      ],
    });

    await expect(getBurnFeeBps("NGN")).resolves.toBe(200);
  });

  it("returns lower burn fee when reserve is above 115% of target", async () => {
    mockGetReserveStatus.mockResolvedValueOnce({
      currencies: [
        {
          currency: "NGN",
          targetWeight: 40,
          actualWeight: 47,
        },
      ],
    });

    await expect(getBurnFeeBps("NGN")).resolves.toBe(10);
  });

  it("returns base burn fee when reserve is between 85% and 115%", async () => {
    mockGetReserveStatus.mockResolvedValueOnce({
      currencies: [
        {
          currency: "NGN",
          targetWeight: 40,
          actualWeight: 40,
        },
      ],
    });

    await expect(getBurnFeeBps("NGN")).resolves.toBe(10);
  });

  it("returns base burn fee at exact threshold boundaries", async () => {
    mockGetReserveStatus.mockResolvedValueOnce({
      currencies: [
        {
          currency: "NGN",
          targetWeight: 100,
          actualWeight: 85,
        },
      ],
    });

    await expect(getBurnFeeBps("NGN")).resolves.toBe(10);

    mockGetReserveStatus.mockResolvedValueOnce({
      currencies: [
        {
          currency: "NGN",
          targetWeight: 100,
          actualWeight: 115,
        },
      ],
    });

    await expect(getBurnFeeBps("NGN")).resolves.toBe(10);
  });
});
