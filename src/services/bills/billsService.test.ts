import { Decimal } from "@prisma/client/runtime/library";

const mockTransactionCreate = jest.fn();
const mockTransactionUpdate = jest.fn();
const mockTransactionFindUnique = jest.fn();
const mockWebhookCreate = jest.fn();
const mockLogAudit = jest.fn();
const mockEnqueueWebhook = jest.fn();
const mockCheckWithdrawalLimits = jest.fn();
const mockIsCurrencyWithdrawalPaused = jest.fn();
const mockGetCatalog = jest.fn();
const mockPayBill = jest.fn();
const mockRefundBill = jest.fn();

jest.mock("../../config/database", () => ({
  prisma: {
    transaction: {
      create: mockTransactionCreate,
      update: mockTransactionUpdate,
      findUnique: mockTransactionFindUnique,
    },
    webhook: {
      create: mockWebhookCreate,
    },
  },
}));

jest.mock("../audit", () => ({
  logAudit: mockLogAudit,
}));

jest.mock("../webhook", () => ({
  enqueueWebhook: mockEnqueueWebhook,
}));

jest.mock("../limits/limitsService", () => ({
  checkWithdrawalLimits: mockCheckWithdrawalLimits,
  isCurrencyWithdrawalPaused: mockIsCurrencyWithdrawalPaused,
}));

jest.mock("./simulatedBillsPartner", () => ({
  simulatedBillsPartner: {
    providerId: "simulated",
    getCatalog: mockGetCatalog,
    payBill: mockPayBill,
    refundBill: mockRefundBill,
  },
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prisma } from "../../config/database";
import { logAudit } from "../audit";
import { enqueueWebhook } from "../webhook";
import { payBill, refundBillPayment } from "./billsService";

describe("billsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLS_PROVIDER;

    mockGetCatalog.mockResolvedValue([
      {
        id: "ikeja-electric",
        name: "Ikeja Electric",
        provider: "simulated",
        category: "electricity",
        countryCode: "NGA",
        requiredFields: [],
        products: [
          {
            id: "prepaid",
            name: "Prepaid Token",
            currency: "NGN",
            minAmount: 500,
            maxAmount: 50000,
          },
        ],
      },
    ]);
    mockIsCurrencyWithdrawalPaused.mockResolvedValue(false);
    mockCheckWithdrawalLimits.mockResolvedValue(undefined);
    mockTransactionUpdate.mockResolvedValue({});
    mockWebhookCreate.mockResolvedValue({ id: "webhook-1" });
    mockEnqueueWebhook.mockResolvedValue(null);
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("creates, reconciles, and audits a successful bill payment", async () => {
    mockTransactionCreate.mockResolvedValue({
      id: "tx-1",
      rateSnapshot: { provider: "simulated" },
    });
    mockPayBill.mockResolvedValue({
      provider: "simulated",
      providerReference: "bill-ref-1",
      dispatchStatus: "processing",
      reconciliationEvent: {
        provider: "simulated",
        transactionId: "tx-1",
        providerReference: "bill-ref-1",
        status: "completed",
        amount: 5000,
        currency: "NGN",
        rawPayload: { accepted: true },
      },
    });
    mockTransactionFindUnique.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      type: "bill_payment",
      localAmount: new Decimal(5000),
      localCurrency: "NGN",
      rateSnapshot: { provider: "simulated" },
      recipientAddress: "bill-ref-1",
    });

    const result = await payBill({
      userId: "user-1",
      audience: "retail",
      billerId: "ikeja-electric",
      productId: "prepaid",
      customerReference: "12345678901",
      amount: 5000,
      metadata: { channel: "api" },
    });

    expect(result).toEqual({
      transactionId: "tx-1",
      status: "completed",
      provider: "simulated",
      providerReference: "bill-ref-1",
      billerId: "ikeja-electric",
      productId: "prepaid",
      localAmount: 5000,
      currency: "NGN",
      reconciled: true,
    });
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        type: "bill_payment",
        status: "pending",
        acbuAmountBurned: new Decimal(5000),
        localCurrency: "NGN",
        localAmount: new Decimal(5000),
      }),
    });
    expect(prisma.transaction.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "tx-1" },
        data: expect.objectContaining({
          status: "processing",
          recipientAddress: "bill-ref-1",
        }),
      }),
    );
    expect(prisma.transaction.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "tx-1" },
        data: expect.objectContaining({
          status: "completed",
          recipientAddress: "bill-ref-1",
        }),
      }),
    );
    expect(prisma.webhook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: "tx-1",
        eventType: "bills:simulated:completed",
        status: "processed",
      }),
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "tx-1",
        action: "bill_payment_created",
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "tx-1",
        action: "bill_payment_completed",
      }),
    );
    expect(enqueueWebhook).toHaveBeenCalledWith(
      "transaction.completed",
      expect.objectContaining({
        transaction_id: "tx-1",
        type: "bill_payment",
        provider: "simulated",
        amount: 5000,
        currency: "NGN",
      }),
      "tx-1",
    );
  });

  it("refunds a completed bill payment through reconciliation", async () => {
    mockTransactionFindUnique
      .mockResolvedValueOnce({
        id: "tx-1",
        userId: "user-1",
        type: "bill_payment",
        status: "completed",
        localAmount: new Decimal(5000),
        localCurrency: "NGN",
        recipientAddress: "bill-ref-1",
        rateSnapshot: { provider: "simulated" },
      })
      .mockResolvedValueOnce({
        id: "tx-1",
        userId: "user-1",
        type: "bill_payment",
        localAmount: new Decimal(5000),
        localCurrency: "NGN",
        recipientAddress: "bill-ref-1",
        rateSnapshot: { provider: "simulated" },
      });
    mockRefundBill.mockResolvedValue({
      provider: "simulated",
      providerReference: "bill-ref-1",
      reconciliationEvent: {
        provider: "simulated",
        transactionId: "tx-1",
        providerReference: "bill-ref-1",
        status: "refunded",
        amount: 5000,
        currency: "NGN",
        reason: "duplicate payment",
        rawPayload: { refunded: true },
      },
    });

    const result = await refundBillPayment({
      transactionId: "tx-1",
      reason: "duplicate payment",
    });

    expect(result).toEqual({
      transactionId: "tx-1",
      provider: "simulated",
      providerReference: "bill-ref-1",
      status: "refunded",
    });
    expect(mockRefundBill).toHaveBeenCalledWith({
      transactionId: "tx-1",
      providerReference: "bill-ref-1",
      amount: 5000,
      currency: "NGN",
      reason: "duplicate payment",
    });
    expect(prisma.webhook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: "tx-1",
        eventType: "bills:simulated:refunded",
        status: "processed",
      }),
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-1" },
        data: expect.objectContaining({
          status: "refunded",
          recipientAddress: "bill-ref-1",
        }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "tx-1",
        action: "bill_payment_refunded",
      }),
    );
    expect(enqueueWebhook).not.toHaveBeenCalled();
  });
});
