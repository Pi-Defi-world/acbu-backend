import { depositFromBasketCurrency } from "./mintController";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import type { AuthRequest } from "../middleware/auth";
import type { Response, NextFunction } from "express";

jest.mock("../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
  },
}));

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

const mockedUserFindUnique = prisma.user.findUnique as jest.Mock;

describe("mintController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects /mint/deposit when API key has no user context", async () => {
    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        body: {
          currency: "NGN",
          amount: "100",
          wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      } as AuthRequest,
      res,
      next,
    );

    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("User context required for deposit");
  });

  it("rejects /mint/deposit when wallet_address does not match the user's stored wallet", async () => {
    mockedUserFindUnique.mockResolvedValue({ stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });
    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        apiKey: { id: "key-1", userId: "user-1", organizationId: null, permissions: [], rateLimit: 100 },
        body: {
          currency: "NGN",
          amount: "100",
          wallet_address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        },
      } as AuthRequest,
      res,
      next,
    );

    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Wallet address does not match user");
  });
});
