import { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth";
import { getGovernmentTreasury } from "./governmentController";
import { prisma } from "../config/database";
import { basketService } from "../services/basket";

jest.mock("../config/database", () => ({
  prisma: {
    transaction: {
      findMany: jest.fn(),
    },
    reserve: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../services/basket", () => ({
  basketService: {
    getCurrentBasket: jest.fn(),
  },
}));

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

describe("governmentController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
      { currency: "NGN", weight: 18 },
      { currency: "KES", weight: 12 },
    ]);
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.reserve.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns seeded basket currencies even when there are no treasury transactions yet", async () => {
    const res = makeRes();

    await getGovernmentTreasury(
      {
        apiKey: { userId: null, organizationId: "org-seeded" },
      } as unknown as AuthRequest,
      res,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.byCurrency).toHaveLength(2);
    expect(body.byCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: "NGN",
          targetWeight: 18,
          reserveExposure: expect.objectContaining({ total: 0 }),
        }),
        expect.objectContaining({
          currency: "KES",
          targetWeight: 12,
        }),
      ]),
    );
  });

  it("uses the treasury cache for repeated reads by the same organization", async () => {
    const req = {
      apiKey: { userId: null, organizationId: "org-cache" },
    } as unknown as AuthRequest;

    await getGovernmentTreasury(req, makeRes(), makeNext());
    await getGovernmentTreasury(req, makeRes(), makeNext());

    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.reserve.findMany).toHaveBeenCalledTimes(1);
    expect(basketService.getCurrentBasket).toHaveBeenCalledTimes(1);
  });
});
