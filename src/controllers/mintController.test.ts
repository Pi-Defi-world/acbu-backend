import { Decimal } from "@prisma/client/runtime/library";
import { depositFromBasketCurrency, mintFromUsdc, confirmMint, verifyMintConfirmationSignature } from "./mintController";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { assertUserWalletAddress } from "../services/wallet/walletService";
import { checkDepositLimits, isMintingPaused } from "../services/limits/limitsService";
import { enqueueUsdcConvertAndMint } from "../jobs/usdcConvertAndMintJob";
import type { AuthRequest } from "../middleware/auth";
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

jest.mock("../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    onRampSwap: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const MINT_CONFIRM_SECRET = "test-mint-confirmation-secret-xyz";

jest.mock("../config/env", () => ({
  config: {
    nodeEnv: "test",
    port: 5000,
    apiVersion: "v1",
    databaseUrl: "",
    prismaAccelerateUrl: "",
    mongodbUri: "",
    rabbitmqUrl: "",
    jwtSecret: "secret",
    jwtExpiresIn: "7d",
    apiKeySalt: "",
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    rateLimitFallbackMaxRequests: 20,
    rateLimitCircuitBreakerThreshold: 5,
    rateLimitCircuitBreakerCooldownMs: 60000,
    logLevel: "info",
    logFile: "logs/app.log",
    flutterwave: { webhookSecret: "" },
    paystack: { secretKey: "" },
    bills: { webhookSecret: "" },
    // W10-SEC-017: HMAC secret for /v1/mint/confirm. Use a literal — jest.mock
    // factories are hoisted before const declarations, so MINT_CONFIRM_SECRET
    // cannot be referenced here.
    mint: { confirmationSecret: "test-mint-confirmation-secret-xyz" },
    mtnMomo: { subscriptionKey: "", apiUserId: "", apiKey: "", baseUrl: "", targetEnvironment: "sandbox" },
    fintech: { currencyProviders: {} },
    stellar: {
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      secretKey: undefined,
      networkPassphrase: "Test SDF Network ; September 2015",
      baseFeeStroops: 100,
      useDynamicFees: false,
      sorobanMaxFeeStroops: 10_000_000,
      sorobanMinFeeStroops: 5000,
      feeSurgeBufferBps: 2000,
      maxPaymentFeeStroops: 1_000_000,
      usdcIssuerTestnet: undefined,
      usdcIssuerMainnet: undefined,
    },
    limits: {
      retail: { depositDailyUsd: 5000, depositMonthlyUsd: 50000 },
      business: { depositDailyUsd: 50000, depositMonthlyUsd: 500000 },
      government: { depositDailyUsd: 500000, depositMonthlyUsd: 5000000 },
      circuitBreaker: { reserveWeightThresholdPct: 10, minReserveRatio: 1.02 },
    },
    contracts: { oracle: "", reserveTracker: "", minting: "", burning: "", savingsVault: "", lendingPool: "", escrow: "" },
  },
}));

jest.mock("../services/contracts", () => ({
  acbuMintingService: {
    mintFromBasket: jest.fn(),
    mintFromUsdc: jest.fn(),
  },
  acbuBurningService: {
    redeemSingle: jest.fn(),
  },
}));

jest.mock("../services/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
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
  const { Decimal } = require("@prisma/client/runtime/library") as {
    Decimal: typeof import("@prisma/client/runtime/library").Decimal;
  };
  return {
    // Issue #787: convertLocalToUsd now returns Decimal, not number.
    // The controller calls .toNumber() at the boundary before checkDepositLimits.
    convertLocalToUsd: jest.fn().mockResolvedValue(new Decimal("100")),
    convertLocalToUsdWithPrecision: jest.fn(),
  };
});

jest.mock("../services/stellar/client", () => ({
  stellarClient: {
    getKeypair: jest.fn(() => ({ publicKey: jest.fn(() => "GBANKSOURCEACCOUNT1234567890") })),
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
const mockedAssertUserWalletAddress = assertUserWalletAddress as jest.Mock;
const mockedCheckDepositLimits = checkDepositLimits as jest.Mock;
const mockedIsMintingPaused = isMintingPaused as jest.Mock;
const mockedEnqueueUsdcConvertAndMint = enqueueUsdcConvertAndMint as jest.Mock;

const mockedOnRampSwapCreate = prisma.onRampSwap.create as jest.Mock;
const mockedOnRampSwapFindFirst = prisma.onRampSwap.findFirst as jest.Mock;
const mockedTransactionCreate = prisma.transaction.create as jest.Mock;
const mockedTransactionFindFirst = prisma.transaction.findFirst as jest.Mock;
const mockedTransactionFindUnique = prisma.transaction.findUnique as jest.Mock;
const mockedTransactionUpdate = prisma.transaction.update as jest.Mock;
const mockedConvertLocalToUsdWithPrecision = jest.requireMock("../services/rates")
  .convertLocalToUsdWithPrecision as jest.Mock;

describe("mintController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAssertUserWalletAddress.mockImplementation(
      async (_userId, walletAddress) => walletAddress,
    );
    mockedCheckDepositLimits.mockResolvedValue(undefined);
    mockedIsMintingPaused.mockResolvedValue(false);
    mockedEnqueueUsdcConvertAndMint.mockResolvedValue(undefined);
    mockedConvertLocalToUsdWithPrecision.mockResolvedValue({
      usdAmount: 100,
      originalAmount: new Decimal("100"),
      acbuEquivalent: new Decimal("10"),
    });
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
    mockedUserFindUnique.mockResolvedValue({
      stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        apiKey: {
          id: "key-1",
          userId: "user-1",
          organizationId: null,
          permissions: [],
          rateLimit: 100,
        },
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
        apiKey: {
          id: "key-1",
          userId: "user-1",
          organizationId: null,
          permissions: [],
          rateLimit: 100,
        },
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

  it("mints ACBU from the basket deposit and records the on-chain hash", async () => {
    mockedTransactionCreate.mockResolvedValue({ id: "tx-1" });
    mockedTransactionUpdate.mockResolvedValue({ id: "tx-1" });
    const mintFromBasket =
      jest.requireMock("../services/contracts").acbuMintingService.mintFromBasket;
    mintFromBasket.mockResolvedValue({ transactionHash: "abc123", acbuAmount: "10" });

    const res = makeRes();
    const next = makeNext();
    await depositFromBasketCurrency(
      {
        apiKey: {
          id: "key-1",
          userId: "user-1",
          organizationId: null,
          permissions: [],
          rateLimit: 100,
        },
        body: {
          currency: "NGN",
          amount: "100",
          wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
      } as unknown as AuthRequest,
      res,
      next,
    );

    expect(mintFromBasket).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "GBANKSOURCEACCOUNT1234567890",
        recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      }),
    );
    expect(mockedTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-1" },
        data: expect.objectContaining({
          status: "completed",
          blockchainTxHash: "abc123",
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
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
        apiKey: {
          id: "key-1",
          userId: "user-1",
          organizationId: null,
          permissions: [],
          rateLimit: 100,
        },
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
        apiKey: {
          id: "key-1",
          userId: "user-1",
          organizationId: null,
          permissions: [],
          rateLimit: 100,
        },
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

// ── W10-SEC-017: confirmMint and verifyMintConfirmationSignature tests ────────

/** Build a correctly-signed mint-confirmation request for tests. */
function makeMintConfirmRequest(
  body: Record<string, unknown>,
  overrides: { secret?: string; timestamp?: number; skipTimestamp?: boolean; skipSignature?: boolean } = {},
): Request & { rawBody?: Buffer } {
  const secret = overrides.secret ?? MINT_CONFIRM_SECRET;
  const ts = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  return {
    headers: {
      "content-type": "application/json",
      ...(overrides.skipTimestamp ? {} : { "x-mint-timestamp": String(ts) }),
      ...(overrides.skipSignature ? {} : { "x-mint-signature": signature }),
    },
    body,
    rawBody,
  } as unknown as Request & { rawBody?: Buffer };
}

const CONFIRM_BODY = {
  transaction_id: "tx-confirm-1",
  partner_reference: "PARTNER-REF-001",
  amount: "1000",
  currency: "NGN",
  confirmed_at: Math.floor(Date.now() / 1000),
};

describe("verifyMintConfirmationSignature middleware", () => {
  it("passes when signature and timestamp are valid", () => {
    const req = makeMintConfirmRequest(CONFIRM_BODY);
    const res = makeRes();
    const next = makeNext();

    verifyMintConfirmationSignature(req as Request, res, next);

    expect(next).toHaveBeenCalledWith(); // called with no args = success
  });

  it("rejects when x-mint-signature header is missing", () => {
    const req = makeMintConfirmRequest(CONFIRM_BODY, { skipSignature: true });
    const res = makeRes();
    const next = makeNext();

    expect(() => verifyMintConfirmationSignature(req as Request, res, next)).toThrow("Missing x-mint-signature header");
  });

  it("rejects when x-mint-timestamp header is missing", () => {
    const req = makeMintConfirmRequest(CONFIRM_BODY, { skipTimestamp: true });
    const res = makeRes();
    const next = makeNext();

    expect(() => verifyMintConfirmationSignature(req as Request, res, next)).toThrow("Missing x-mint-timestamp header");
  });

  it("rejects when signature is computed with wrong secret", () => {
    const req = makeMintConfirmRequest(CONFIRM_BODY, { secret: "wrong-secret" });
    const res = makeRes();
    const next = makeNext();

    expect(() => verifyMintConfirmationSignature(req as Request, res, next)).toThrow("Invalid mint confirmation signature");
  });

  it("rejects when timestamp is outside tolerance window", () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 400; // >5 min ago
    const req = makeMintConfirmRequest(CONFIRM_BODY, { timestamp: staleTimestamp });
    const res = makeRes();
    const next = makeNext();

    verifyMintConfirmationSignature(req as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("confirmMint controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsMintingPaused.mockResolvedValue(false);
  });

  it("returns 200 and mints ACBU on valid confirmation", async () => {
    mockedTransactionFindUnique.mockResolvedValue({
      id: "tx-confirm-1",
      status: "pending",
      userId: "user-1",
      rateSnapshot: {},
      acbuAmount: null,
      blockchainTxHash: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
    (prisma.transaction.update as jest.Mock).mockResolvedValue({ id: "tx-confirm-1" });

    const mintFromBasket = jest.requireMock("../services/contracts").acbuMintingService.mintFromBasket;
    mintFromBasket.mockResolvedValue({ transactionHash: "deadbeef", acbuAmount: "10" });

    const mockedConvertLocalToUsdWithPrecision = jest.requireMock("../services/rates").convertLocalToUsdWithPrecision as jest.Mock;
    mockedConvertLocalToUsdWithPrecision.mockResolvedValue({
      usdAmount: 100,
      originalAmount: new Decimal("1000"),
      acbuEquivalent: new Decimal("10"),
    });

    const req = makeMintConfirmRequest(CONFIRM_BODY);
    const res = makeRes();
    const next = makeNext();

    await confirmMint(req as Request, res, next);

    expect(mintFromBasket).toHaveBeenCalledWith(
      expect.objectContaining({
        txId: "tx-confirm-1",
        recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        transaction_id: "tx-confirm-1",
        status: "completed",
        blockchain_tx_hash: "deadbeef",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 200 without re-minting for already-completed transaction (idempotency)", async () => {
    mockedTransactionFindUnique.mockResolvedValue({
      id: "tx-confirm-1",
      status: "completed",
      userId: "user-1",
      rateSnapshot: {},
      acbuAmount: new Decimal("10"),
      blockchainTxHash: "abc123",
    });

    const mintFromBasket = jest.requireMock("../services/contracts").acbuMintingService.mintFromBasket;
    const req = makeMintConfirmRequest(CONFIRM_BODY);
    const res = makeRes();
    const next = makeNext();

    await confirmMint(req as Request, res, next);

    expect(mintFromBasket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", transaction_id: "tx-confirm-1" }),
    );
  });

  it("returns 404 when transaction_id does not exist", async () => {
    mockedTransactionFindUnique.mockResolvedValue(null);

    const req = makeMintConfirmRequest(CONFIRM_BODY);
    const res = makeRes();
    const next = makeNext();

    await confirmMint(req as Request, res, next);

    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
  });

  it("returns 503 when circuit-breaker is tripped", async () => {
    mockedTransactionFindUnique.mockResolvedValue({
      id: "tx-confirm-1",
      status: "pending",
      userId: "user-1",
      rateSnapshot: {},
    });
    mockedIsMintingPaused.mockResolvedValue(true);

    const req = makeMintConfirmRequest(CONFIRM_BODY);
    const res = makeRes();
    const next = makeNext();

    await confirmMint(req as Request, res, next);

    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain("paused");
  });

  it("rejects invalid body with 400 VALIDATION_ERROR", async () => {
    const req = makeMintConfirmRequest({ transaction_id: "" }); // missing required fields
    const res = makeRes();
    const next = makeNext();

    await confirmMint(req as Request, res, next);

    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });
});
