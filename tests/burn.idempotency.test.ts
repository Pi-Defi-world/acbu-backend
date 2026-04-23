import { Decimal } from "@prisma/client/runtime/library";

const prismaMock = {
  transaction: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  acbuRate: {
    findFirst: jest.fn(),
  },
};

jest.mock("../src/config/database", () => ({
  prisma: prismaMock,
}));

jest.mock("../src/config/contracts", () => ({
  getContractAddresses: () => ({
    oracle: "",
    reserveTracker: "",
    minting: "",
    burning: "burning-contract-id",
    savingsVault: "",
    lendingPool: "",
    escrow: "",
  }),
  contractAddresses: {
    oracle: "",
    reserveTracker: "",
    minting: "",
    burning: "burning-contract-id",
    savingsVault: "",
    lendingPool: "",
    escrow: "",
  },
}));

jest.mock("../src/services/contracts", () => ({
  acbuBurningService: { redeemSingle: jest.fn() },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: { getKeypair: jest.fn() },
}));

jest.mock("../src/services/audit", () => ({
  logAudit: jest.fn(),
}));

jest.mock("../src/services/limits/limitsService", () => ({
  checkWithdrawalLimits: jest.fn(),
  isCurrencyWithdrawalPaused: jest.fn(),
}));

jest.mock("../src/services/feePolicy/feePolicyService", () => ({
  getBurnFeeBps: jest.fn(),
}));

import { burnAcbu } from "../src/controllers/burnController";

describe("B-074 burn idempotency", () => {
  it("returns original transaction id when blockchain_tx_hash is replayed", async () => {
    const blockchainTxHash = "a".repeat(64);
    const existingTx = {
      id: "tx-1",
      userId: null,
      type: "burn",
      status: "processing",
      usdcAmount: null,
      acbuAmount: null,
      acbuAmountBurned: new Decimal("10"),
      localCurrency: "NGN",
      localAmount: new Decimal("5000"),
      recipientAccount: { account_number: "1" },
      recipientAddress: null,
      fee: new Decimal("0.01"),
      rateSnapshot: { acbu_ngn: null, timestamp: new Date().toISOString() },
      blockchainTxHash,
      confirmations: 0,
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
      completedAt: null,
    };

    prismaMock.transaction.findFirst.mockResolvedValue(existingTx);

    const req: any = {
      body: {
        acbu_amount: "10",
        currency: "NGN",
        recipient_account: {
          account_number: "1",
          bank_code: "000",
          account_name: "Test",
        },
        blockchain_tx_hash: blockchainTxHash,
      },
      apiKey: { userId: "user-1", organizationId: null },
      audience: "retail",
    };

    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await burnAcbu(req, res, next);

    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_id: "tx-1", blockchain_tx_hash: blockchainTxHash }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

