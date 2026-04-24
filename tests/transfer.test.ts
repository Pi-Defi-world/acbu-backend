import { normalizeRecipientQuery } from "../src/services/recipient/recipientResolver";

jest.mock("../src/config/database", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
    },
    userContact: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: {
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
  },
}));

jest.mock("../src/services/stellar/feeManager", () => ({
  getBaseFee: jest.fn().mockResolvedValue("100"),
}));

// Mock the Stellar SDK so TransactionBuilder/Keypair/Operation don't hit real crypto.
// All mock state is self-contained inside the factory — jest.mock is hoisted before
// any const declarations, so external variables would be undefined at factory time.
jest.mock("@stellar/stellar-sdk", () => {
  const mockTx = { sign: jest.fn() };
  const mockBuilder = { addOperation: jest.fn().mockReturnThis(), build: jest.fn().mockReturnValue(mockTx) };
  return {
    ...jest.requireActual("@stellar/stellar-sdk"),
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({ publicKey: () => "G" + "A".repeat(55) }),
      random: jest.fn(),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => mockBuilder),
    Operation: { payment: jest.fn().mockReturnValue({}) },
    Asset: jest.requireActual("@stellar/stellar-sdk").Asset,
  };
});

jest.mock("../src/config/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { prisma } from "../src/config/database";
import { createTransfer } from "../src/services/transfer/transferService";
import { stellarClient } from "../src/services/stellar/client";

const mockUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockTx = prisma.transaction as jest.Mocked<typeof prisma.transaction>;

const SENDER_STELLAR = "G" + "A".repeat(55);
const RECIPIENT_STELLAR = "G" + "B".repeat(55);
const SENDER_ID = "user-sender-1";

const verifiedSender = { stellarAddress: SENDER_STELLAR, kycStatus: "verified" };
const bobUser = {
  id: "user-bob",
  username: "bob",
  phoneE164: null,
  email: null,
  privacyHideFromSearch: false,
};

describe("normalizeRecipientQuery", () => {
  it("parses @username", () => {
    expect(normalizeRecipientQuery("@alice")).toEqual({ kind: "username", value: "alice" });
  });

  it("parses bare username", () => {
    expect(normalizeRecipientQuery("alice")).toEqual({ kind: "username", value: "alice" });
  });

  it("parses E.164 phone", () => {
    expect(normalizeRecipientQuery("+2348012345678")).toEqual({ kind: "phone", value: "+2348012345678" });
  });

  it("parses email", () => {
    expect(normalizeRecipientQuery("User@Example.com")).toEqual({ kind: "email", value: "user@example.com" });
  });

  it("parses valid Stellar address (base32 uppercase)", () => {
    const addr = "G" + "A".repeat(55);
    expect(normalizeRecipientQuery(addr)).toEqual({ kind: "address", value: addr });
  });

  it("does not treat lowercase-g string as Stellar address", () => {
    expect(normalizeRecipientQuery("g" + "A".repeat(55)).kind).toBe("username");
  });

  it("throws on empty input", () => {
    expect(() => normalizeRecipientQuery("")).toThrow("Recipient query is required");
  });
});

describe("createTransfer", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── amount validation ────────────────────────────────────────────────────────

  it("rejects scientific notation amount", async () => {
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "1e5" })
    ).rejects.toThrow("amount_acbu must be a positive number");
  });

  it("rejects zero amount", async () => {
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "0" })
    ).rejects.toThrow("amount_acbu must be a positive number");
  });

  it("rejects amount with more than 7 decimal places", async () => {
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "1.12345678" })
    ).rejects.toThrow("amount_acbu must be a positive number");
  });

  it("accepts amount with exactly 7 decimal places (does not throw on amount)", async () => {
    // Will fail later on sender lookup — just confirms amount passes validation
    (mockUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "1.1234567" })
    ).rejects.toThrow("Sender user not found");
  });

  // ── sender checks ────────────────────────────────────────────────────────────

  it("rejects when sender not found", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" })
    ).rejects.toThrow("Sender user not found");
  });

  it("rejects unverified sender (KYC) before doing recipient lookup", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValue({
      stellarAddress: SENDER_STELLAR,
      kycStatus: "pending",
    });
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" })
    ).rejects.toThrow("KYC required");
    // recipient lookup (findFirst) must NOT have been called
    expect(mockUser.findFirst).not.toHaveBeenCalled();
  });

  // ── recipient checks ─────────────────────────────────────────────────────────

  it("rejects recipient not found", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValue(verifiedSender);
    (mockUser.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@ghost", amountAcbu: "10" })
    ).rejects.toThrow("Recipient not found or not available");
  });

  it("rejects self-transfer", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce(verifiedSender)           // sender
      .mockResolvedValueOnce({ stellarAddress: SENDER_STELLAR }); // recipient stellar lookup
    (mockUser.findFirst as jest.Mock).mockResolvedValue({
      id: SENDER_ID,
      username: "alice",
      phoneE164: null,
      email: null,
      privacyHideFromSearch: false,
    });
    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@alice", amountAcbu: "10" })
    ).rejects.toThrow("Cannot transfer to yourself");
  });

  // ── happy path: pending (no signing key) ─────────────────────────────────────

  it("creates a pending transaction when no signing key provided", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce(verifiedSender)
      .mockResolvedValueOnce({ stellarAddress: RECIPIENT_STELLAR });
    (mockUser.findFirst as jest.Mock).mockResolvedValue(bobUser);
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-123" });

    const result = await createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "5.5" });

    expect(result.transactionId).toBe("tx-123");
    expect(result.status).toBe("pending");
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  // ── submittedBlockchainTxHash shortcut ───────────────────────────────────────

  it("marks completed immediately when submittedBlockchainTxHash is provided", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce(verifiedSender)
      .mockResolvedValueOnce({ stellarAddress: RECIPIENT_STELLAR });
    (mockUser.findFirst as jest.Mock).mockResolvedValue(bobUser);
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-456" });
    (mockTx.update as jest.Mock).mockResolvedValue({});

    const result = await createTransfer(
      { senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" },
      { submittedBlockchainTxHash: "abc123hash" },
    );

    expect(result.status).toBe("completed");
    expect(mockTx.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", blockchainTxHash: "abc123hash" }),
      })
    );
  });

  // ── getSenderSigningKey: success ─────────────────────────────────────────────

  it("submits Stellar payment and marks completed when signing key is provided", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce(verifiedSender)
      .mockResolvedValueOnce({ stellarAddress: RECIPIENT_STELLAR });
    (mockUser.findFirst as jest.Mock).mockResolvedValue(bobUser);
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-789" });
    (mockTx.update as jest.Mock).mockResolvedValue({});

    const mockServer = {
      loadAccount: jest.fn().mockResolvedValue({}),
      submitTransaction: jest.fn().mockResolvedValue({ hash: "stellar-tx-hash" }),
    };
    (stellarClient.getServer as jest.Mock).mockReturnValue(mockServer);

    const result = await createTransfer(
      { senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" },
      { getSenderSigningKey: async () => "STEST_SECRET_KEY" },
    );

    expect(result.status).toBe("completed");
    expect(result.transactionId).toBe("tx-789");
    expect(mockTx.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", blockchainTxHash: "stellar-tx-hash" }),
      })
    );
  });

  // ── getSenderSigningKey: Stellar submission fails ────────────────────────────

  it("marks transaction failed when Stellar submission throws", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce(verifiedSender)
      .mockResolvedValueOnce({ stellarAddress: RECIPIENT_STELLAR });
    (mockUser.findFirst as jest.Mock).mockResolvedValue(bobUser);
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-fail" });
    (mockTx.update as jest.Mock).mockResolvedValue({});

    const mockServer = {
      loadAccount: jest.fn().mockRejectedValue(new Error("Horizon unavailable")),
    };
    (stellarClient.getServer as jest.Mock).mockReturnValue(mockServer);

    const result = await createTransfer(
      { senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" },
      { getSenderSigningKey: async () => "STEST_SECRET_KEY" },
    );

    expect(result.status).toBe("failed");
    expect(mockTx.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  // ── getSenderSigningKey returns null ─────────────────────────────────────────

  it("stays pending when getSenderSigningKey returns null", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce(verifiedSender)
      .mockResolvedValueOnce({ stellarAddress: RECIPIENT_STELLAR });
    (mockUser.findFirst as jest.Mock).mockResolvedValue(bobUser);
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-nokey" });

    const result = await createTransfer(
      { senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" },
      { getSenderSigningKey: async () => null },
    );

    expect(result.status).toBe("pending");
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  // ── raw Stellar address as recipient ─────────────────────────────────────────

  it("accepts raw Stellar address as recipient", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValueOnce(verifiedSender);
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-raw" });

    const result = await createTransfer({
      senderUserId: SENDER_ID,
      to: RECIPIENT_STELLAR,
      amountAcbu: "1",
    });

    expect(result.status).toBe("pending");
    expect(mockTx.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recipientAddress: RECIPIENT_STELLAR }),
      })
    );
  });
});
