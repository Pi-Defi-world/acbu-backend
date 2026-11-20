/**
 * W10-OBS-006 (#1228): Tests proving an audit record is written on every money movement.
 *
 * These tests verify that logAudit is called for mint, burn, and transfer
 * operations — the three financial actions that must have guaranteed audit
 * trails in a regulated financial system.
 */
import { logAudit } from "../services/audit";

// Mock logAudit so we can assert it was called without needing RabbitMQ/DB
jest.mock("../services/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

// Mock prisma
jest.mock("../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    onRampSwap: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    burnTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock logger
jest.mock("../config/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

// Mock contracts
jest.mock("../services/contracts", () => ({
  acbuMintingService: {
    mintFromBasket: jest.fn(),
    mintFromUsdc: jest.fn(),
  },
  acbuBurningService: {
    redeemSingle: jest.fn(),
  },
}));

// Mock stellar client
jest.mock("../services/stellar/client", () => ({
  stellarClient: {
    getKeypair: jest.fn(() => ({ publicKey: () => "GBANKSOURCEACCOUNT1234567890" })),
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
  },
}));

// Mock wallet service
jest.mock("../services/wallet/walletService", () => ({
  assertUserWalletAddress: jest.fn(async (_userId: string, addr: string) => addr),
}));

// Mock limits
jest.mock("../services/limits/limitsService", () => ({
  checkDepositLimits: jest.fn().mockResolvedValue(undefined),
  checkWithdrawalLimits: jest.fn().mockResolvedValue(undefined),
  isMintingPaused: jest.fn().mockResolvedValue(false),
  isCurrencyWithdrawalPaused: jest.fn().mockResolvedValue(false),
}));

// Mock rates
jest.mock("../services/rates", () => {
  const { Decimal } = require("@prisma/client/runtime/library");
  return {
    convertLocalToUsd: jest.fn().mockResolvedValue(new Decimal("100")),
    convertLocalToUsdWithPrecision: jest.fn().mockResolvedValue({
      usdAmount: 100,
      originalAmount: new Decimal("100"),
      acbuEquivalent: new Decimal("10"),
    }),
    getLatestAcbuRate: jest.fn().mockReturnValue({ rate: "0.10" }),
  };
});

// Mock fee policy
jest.mock("../services/feePolicy/feePolicyService", () => ({
  getBurnFeeBps: jest.fn().mockResolvedValue(30),
}));

// Mock wallet state service
jest.mock("../services/wallet/walletStateService", () => ({
  reserveWalletVersion: jest.fn().mockResolvedValue(1),
  fetchWalletBalance: jest.fn().mockResolvedValue({
    snapshot: { balance: "1000000" },
    walletVersion: 1,
  }),
}));

// Mock fee manager
jest.mock("../services/stellar/feeManager", () => ({
  getBaseFee: jest.fn().mockResolvedValue("100"),
  getPaymentFee: jest.fn().mockResolvedValue({
    feeStroops: 120,
    networkFeeStroops: 100,
    buffered: true,
    clampedToCeiling: false,
    maxFeeStroops: 1000000,
  }),
}));

// Mock recipient resolver
jest.mock("../recipient/recipientResolver", () => ({
  normalizeRecipientQuery: jest.fn((to: string) => {
    if (to.startsWith("G") && to.length === 56) {
      return { kind: "address" as const, value: to };
    }
    return { kind: "alias" as const, value: to };
  }),
  resolveRecipient: jest.fn().mockResolvedValue({ userId: "user-recipient" }),
}));

// Mock idempotency
jest.mock("../utils/idempotency", () => ({
  extractIdempotencyKey: jest.fn().mockReturnValue(undefined),
  scopeIdempotencyKey: jest.fn((userId: string, key: string) => `${userId}:${key}`),
}));

// Mock acbu asset
jest.mock("../config/acbuAsset", () => ({
  getAcbuAsset: jest.fn(() => ({
    getCode: () => "ACBU",
    getIssuer: () => "TEST_ISSUER",
  })),
}));

// Mock usdcConvertAndMintJob
jest.mock("../jobs/usdcConvertAndMintJob", () => ({
  enqueueUsdcConvertAndMint: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../config/database";
import { depositFromBasketCurrency } from "../controllers/mintController";
import { burnAcbu } from "../controllers/burnController";
import { createTransfer } from "../services/transfer/transferService";
import type { AuthRequest } from "../middleware/auth";
import type { Response, NextFunction } from "express";
import { Decimal } from "@prisma/client/runtime/library";

const mockedLogAudit = logAudit as jest.MockedFunction<typeof logAudit>;

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  } as unknown as Response;
  return res;
}

function makeNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

function makeAuthRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    apiKey: {
      id: "key-1",
      userId: "user-1",
      organizationId: null,
      permissions: [],
      rateLimit: 100,
    },
    body: {},
    headers: {},
    get: jest.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as AuthRequest;
}

describe("W10-OBS-006: Audit logging on every money movement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLogAudit.mockResolvedValue(undefined);
  });

  // ── Mint (deposit) ────────────────────────────────────────────────────────

  describe("mint/deposit", () => {
    it("writes an audit record on successful deposit (deposit_created)", async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: "tx-mint-1" });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({ id: "tx-mint-1" });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      });
      const acbuMintingService = jest.requireMock("../services/contracts").acbuMintingService;
      acbuMintingService.mintFromBasket.mockResolvedValue({
        transactionHash: "abc123",
        acbuAmount: "10",
      });

      const res = makeRes();
      const next = makeNext();

      await depositFromBasketCurrency(
        makeAuthRequest({
          body: {
            currency: "NGN",
            amount: "100",
            wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          },
        }),
        res,
        next,
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "transaction",
          entityType: "transaction",
          entityId: "tx-mint-1",
          action: "deposit_created",
          performedBy: "user-1",
        }),
      );
    });

    it("writes an audit record on failed deposit (deposit_failed)", async () => {
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: "tx-mint-fail" });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({ id: "tx-mint-fail" });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      });
      const acbuMintingService = jest.requireMock("../services/contracts").acbuMintingService;
      acbuMintingService.mintFromBasket.mockRejectedValue(new Error("Soroban invocation failed"));

      const res = makeRes();
      const next = makeNext();

      await depositFromBasketCurrency(
        makeAuthRequest({
          body: {
            currency: "NGN",
            amount: "100",
            wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          },
        }),
        res,
        next,
      );

      // Should have a deposit_failed audit call
      const failedAuditCall = mockedLogAudit.mock.calls.find(
        (call) => call[0].action === "deposit_failed",
      );
      expect(failedAuditCall).toBeDefined();
      expect(failedAuditCall![0]).toMatchObject({
        eventType: "transaction",
        entityType: "transaction",
        entityId: "tx-mint-fail",
        action: "deposit_failed",
        performedBy: "user-1",
      });
    });
  });

  // ── Burn ──────────────────────────────────────────────────────────────────

  describe("burn", () => {
    it("writes an audit record on successful burn (burn_success)", async () => {
      (prisma.burnTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.burnTransaction.create as jest.Mock).mockResolvedValue({ id: "burn-1" });
      (prisma.burnTransaction.update as jest.Mock).mockResolvedValue({ id: "burn-1" });
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        id: "wallet-1",
        acbuBalance: new Decimal("1000"),
        userId: "user-1",
      });
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});

      const acbuBurningService = jest.requireMock("../services/contracts").acbuBurningService;
      acbuBurningService.redeemSingle.mockResolvedValue({
        transactionHash: "burnhash123",
        acbuAmount: "100",
      });

      const res = makeRes();
      const next = makeNext();

      await burnAcbu(
        makeAuthRequest({
          headers: { "idempotency-key": "burn-key-1" },
          body: {
            acbu_amount: "100",
            currency: "NGN",
          },
        }),
        res,
        next,
      );

      const successAuditCall = mockedLogAudit.mock.calls.find(
        (call) => call[0].action === "burn_success",
      );
      expect(successAuditCall).toBeDefined();
      expect(successAuditCall![0]).toMatchObject({
        eventType: "transaction",
        entityType: "burn_transaction",
        entityId: "burn-1",
        action: "burn_success",
        performedBy: "user-1",
      });
    });

    it("writes an audit record on failed burn (burn_failed)", async () => {
      (prisma.burnTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.burnTransaction.create as jest.Mock).mockResolvedValue({ id: "burn-fail" });
      (prisma.burnTransaction.update as jest.Mock).mockResolvedValue({ id: "burn-fail" });
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        id: "wallet-1",
        acbuBalance: new Decimal("1000"),
        userId: "user-1",
      });

      const acbuBurningService = jest.requireMock("../services/contracts").acbuBurningService;
      acbuBurningService.redeemSingle.mockRejectedValue(new Error("Contract invocation failed"));

      const res = makeRes();
      const next = makeNext();

      await burnAcbu(
        makeAuthRequest({
          headers: { "idempotency-key": "burn-key-fail" },
          body: {
            acbu_amount: "100",
            currency: "NGN",
          },
        }),
        res,
        next,
      );

      const failedAuditCall = mockedLogAudit.mock.calls.find(
        (call) => call[0].action === "burn_failed",
      );
      expect(failedAuditCall).toBeDefined();
      expect(failedAuditCall![0]).toMatchObject({
        eventType: "transaction",
        entityType: "burn_transaction",
        entityId: "burn-fail",
        action: "burn_failed",
        performedBy: "user-1",
      });
    });
  });

  // ── Transfer ───────────────────────────────────────────────────────────────

  describe("transfer", () => {
    it("writes an audit record on transfer initiation (transfer_initiated)", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        kycStatus: "verified",
      });
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: "tx-transfer-1" });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});
      // Resolve recipient as a raw address so we don't need user lookup
      const recipientAddr = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

      await createTransfer({
        senderUserId: "user-1",
        to: recipientAddr,
        amountAcbu: "10",
      });

      const initiatedCall = mockedLogAudit.mock.calls.find(
        (call) => call[0].action === "transfer_initiated",
      );
      expect(initiatedCall).toBeDefined();
      expect(initiatedCall![0]).toMatchObject({
        eventType: "transaction",
        entityType: "transaction",
        entityId: "tx-transfer-1",
        action: "transfer_initiated",
        performedBy: "user-1",
      });
    });

    it("writes an audit record on transfer completion with pre-submitted hash (transfer_completed)", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        kycStatus: "verified",
      });
      (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: "tx-transfer-2" });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});
      const recipientAddr = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

      await createTransfer(
        {
          senderUserId: "user-1",
          to: recipientAddr,
          amountAcbu: "10",
        },
        { submittedBlockchainTxHash: "prehash123" },
      );

      const completedCall = mockedLogAudit.mock.calls.find(
        (call) => call[0].action === "transfer_completed",
      );
      expect(completedCall).toBeDefined();
      expect(completedCall![0]).toMatchObject({
        eventType: "transaction",
        entityType: "transaction",
        entityId: "tx-transfer-2",
        action: "transfer_completed",
        performedBy: "user-1",
      });
    });
  });
});
