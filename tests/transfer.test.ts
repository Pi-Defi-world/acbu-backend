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

jest.mock("../src/config/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { prisma } from "../src/config/database";
import { createTransfer } from "../src/services/transfer/transferService";

const mockUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockTx = prisma.transaction as jest.Mocked<typeof prisma.transaction>;

const SENDER_STELLAR = "G" + "A".repeat(55);
const RECIPIENT_STELLAR = "G" + "B".repeat(55);
const SENDER_ID = "user-sender-1";

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
    const addr = "g" + "A".repeat(55);
    expect(normalizeRecipientQuery(addr).kind).toBe("username");
  });

  it("throws on empty input", () => {
    expect(() => normalizeRecipientQuery("")).toThrow("Recipient query is required");
  });
});

describe("createTransfer", () => {
  beforeEach(() => jest.clearAllMocks());

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

  it("rejects when sender not found", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" })
    ).rejects.toThrow("Sender user not found");
  });

  it("rejects unverified sender (KYC)", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValue({
      stellarAddress: SENDER_STELLAR,
      kycStatus: "pending",
    });

    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "10" })
    ).rejects.toThrow("KYC required");
  });

  it("rejects recipient not found", async () => {
    (mockUser.findUnique as jest.Mock).mockResolvedValue({
      stellarAddress: SENDER_STELLAR,
      kycStatus: "verified",
    });
    (mockUser.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      createTransfer({ senderUserId: SENDER_ID, to: "@ghost", amountAcbu: "10" })
    ).rejects.toThrow("Recipient not found or not available");
  });

  it("rejects self-transfer", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ stellarAddress: SENDER_STELLAR, kycStatus: "verified" }) // sender
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

  it("creates a pending transaction when no signing key provided", async () => {
    (mockUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ stellarAddress: SENDER_STELLAR, kycStatus: "verified" }) // sender
      .mockResolvedValueOnce({ stellarAddress: RECIPIENT_STELLAR }); // recipient stellar lookup
    (mockUser.findFirst as jest.Mock).mockResolvedValue({
      id: "user-bob",
      username: "bob",
      phoneE164: null,
      email: null,
      privacyHideFromSearch: false,
    });
    (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-123" });

    const result = await createTransfer({ senderUserId: SENDER_ID, to: "@bob", amountAcbu: "5.5" });

    expect(result.transactionId).toBe("tx-123");
    expect(result.status).toBe("pending");
    expect(mockTx.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: SENDER_ID,
          type: "transfer",
          status: "pending",
          recipientAddress: RECIPIENT_STELLAR,
          acbuAmount: "5.5",
        }),
      })
    );
  });
});
