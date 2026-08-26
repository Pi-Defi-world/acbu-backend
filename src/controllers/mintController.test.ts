import { depositFromBasketCurrency, mintFromUsdc } from "./mintController";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { assertUserWalletAddress } from "../services/wallet/walletService";
import { checkDepositLimits, isMintingPaused } from "../services/limits/limitsService";
import { enqueueUsdcConvertAndMint } from "../jobs/usdcConvertAndMintJob";
import type { AuthRequest } from "../middleware/auth";
import type { Response, NextFunction } from "express";

jest.mock("../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    onRampSwap: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../services/contracts", () => ({
  acbuMintingService: {
    mintFromBasket: jest.fn(),
    mintFromUsdc: jest.fn(),
  },
}));

jest.mock("../services/wallet/walletService", () => ({
  assertUserWalletAddress: jest.fn(),
}));

jest.mock("../jobs/usdcConvertAndMintJob", () => ({
  enqueueUsdcConvertAndMint: jest.fn(),
}));

jest.mock("../services/limits/limitsService", () => ({
  checkDepositLimits: jest.fn(),
  isMintingPaused: jest.fn(),
}));

jest.mock("../services/rates", () => {
  // Import Decimal lazily to avoid hoisting issues with jest.mock
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Decimal } = require("@prisma/client/runtime/library") as { Decimal: typeof import("@prisma/client/runtime/library").Decimal };
  return {
    // Issue #787: convertLocalToUsd now returns Decimal, not number.
    // The controller calls .toNumber() at the boundary before checkDepositLimits.
    convertLocalToUsd: jest.fn().mockResolvedValue(new Decimal("100")),
    convertLocalToUsdWithPrecision: jest.fn(),
  };
});

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

const mockedUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockedAssertUserWalletAddress = assertUserWalletAddress as jest.Mock;
const mockedCheckDepositLimits = checkDepositLimits as jest.Mock;
const mockedIsMintingPaused = isMintingPaused as jest.Mock;
const mockedEnqueueUsdcConvertAndMint = enqueueUsdcConvertAndMint as jest.Mock;

const mockedOnRampSwapCreate = prisma.onRampSwap.create as jest.Mock;
const mockedOnRampSwapFindFirst = prisma.onRampSwap.findFirst as jest.Mock;
const mockedTransactionCreate = prisma.transaction.create as jest.Mock;
const mockedTransactionFindFirst = prisma.transaction.findFirst as jest.Mock;

describe("mintController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAssertUserWalletAddress.mockImplementation(async (_userId, walletAddress) => walletAddress);
    mockedCheckDepositLimits.mockResolvedValue(undefined);
    mockedIsMintingPaused.mockResolvedValue(false);
    mockedEnqueueUsdcConvertAndMint.mockResolvedValue(undefined);
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
    mockedAssertUserWalletAddress.mockImplementation(async () => {
      throw new AppError("Wallet address does not match user", 403);
    });
    mockedUserFindUnique.mockResolvedValue({ stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });
    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        apiKey: { id: "key-1", userId: "user-1", organizationId: null, permissions: [], rateLimit: 100 },
        body: {
          currency: "NGN",
          amount: "100",
          wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      } as unknown as AuthRequest,
      res,
      next,
    );

    expect(mockedAssertUserWalletAddress).toHaveBeenCalled();
    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Wallet address does not match user");
  });

  it("rejects unsupported basket deposit currencies with a clear error", async () => {
    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        apiKey: { id: "key-1", userId: "user-1", organizationId: null, permissions: [], rateLimit: 100 },
        body: {
          currency: "JPY",
          amount: "100",
          wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      } as unknown as AuthRequest,
      res,
      next,
    );

    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("currency must be one of");
  });

  it("returns the existing mint transaction on duplicate idempotency key", async () => {
    mockedTransactionFindFirst.mockResolvedValue({
      id: "tx-duplicate",
      status: "pending",
      localCurrency: "NGN",
      localAmount: { toString: () => "100" },
    });

    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        apiKey: { id: "key-1", userId: "user-1", organizationId: null, permissions: [], rateLimit: 100 },
        get: jest.fn().mockReturnValue("repeat-key"),
        body: {
          currency: "NGN",
          amount: "100",
          wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      } as unknown as AuthRequest,
      res,
      next,
    );

    expect(mockedTransactionCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: "tx-duplicate",
        status: "pending",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the existing on-ramp swap on duplicate idempotency key", async () => {
    mockedOnRampSwapFindFirst.mockResolvedValue({
      id: "swap-duplicate",
      status: "pending_convert",
    });

    const res = makeRes();
    const next = makeNext();
    await mintFromUsdc(
      {
        apiKey: { id: "key-1", userId: "user-1", organizationId: null, permissions: [], rateLimit: 100 },
        get: jest.fn().mockReturnValue("duplicate-usdc"),
        body: {
          usdc_amount: "10",
          wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      } as unknown as AuthRequest,
      res,
      next,
    );

    expect(mockedOnRampSwapCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        on_ramp_swap_id: "swap-duplicate",
        status: "pending_convert",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
