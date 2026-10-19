import { Keypair } from "@stellar/stellar-sdk";

jest.mock("../src/config/database", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    userContact: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { prisma } from "../src/config/database";
import { logger } from "../src/config/logger";
import {
  normalizeRecipientQuery,
  resolveRecipient,
  resolveRecipientToStellarAddress,
} from "../src/services/recipient/recipientResolver";

const mockUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockUserContact = prisma.userContact as jest.Mocked<typeof prisma.userContact>;

describe("recipientResolver", () => {
  const validStellarAddress = Keypair.random().publicKey();
  // Corrupted address: 56 chars starting with G, but invalid base32 checksum
  const corruptedStellarAddress = "G" + "A".repeat(55);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("normalizeRecipientQuery", () => {
    it("normalizes @username", () => {
      expect(normalizeRecipientQuery("@alice")).toEqual({ kind: "username", value: "alice" });
    });

    it("normalizes phone with + prefix", () => {
      expect(normalizeRecipientQuery("+12345678901")).toEqual({
        kind: "phone",
        value: "+12345678901",
      });
    });

    it("normalizes email", () => {
      expect(normalizeRecipientQuery("Alice@Example.com")).toEqual({
        kind: "email",
        value: "alice@example.com",
      });
    });

    it("identifies 56-char G-prefixed string as raw address", () => {
      expect(normalizeRecipientQuery(validStellarAddress)).toEqual({
        kind: "address",
        value: validStellarAddress,
      });
    });

    it("throws on empty query", () => {
      expect(() => normalizeRecipientQuery("   ")).toThrow("Recipient query is required");
    });
  });

  describe("resolveRecipient", () => {
    it("returns null for raw Stellar address query", async () => {
      const res = await resolveRecipient(validStellarAddress, null);
      expect(res).toBeNull();
    });

    it("resolves user by username", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        username: "alice",
        phoneE164: "+12345678901",
        email: "alice@example.com",
        privacyHideFromSearch: false,
      });

      const res = await resolveRecipient("@alice", null);
      expect(res).toEqual({
        userId: "user-123",
        displayName: "@alice",
        username: "alice",
        maskedPhone: "+123****8901",
        maskedEmail: "al***@example.com",
        canReceive: true,
      });
    });

    it("returns null when user is not found", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await resolveRecipient("@unknown", null);
      expect(res).toBeNull();
    });

    it("returns null when privacyHideFromSearch is true and caller is not recipient nor contact", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-private",
        username: "privateuser",
        phoneE164: null,
        email: null,
        privacyHideFromSearch: true,
      });
      (mockUserContact.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await resolveRecipient("@privateuser", "caller-999");
      expect(res).toBeNull();
    });

    it("returns result when privacyHideFromSearch is true but caller is recipient self", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-private",
        username: "privateuser",
        phoneE164: null,
        email: null,
        privacyHideFromSearch: true,
      });

      const res = await resolveRecipient("@privateuser", "user-private");
      expect(res).not.toBeNull();
      expect(res?.userId).toBe("user-private");
    });
  });

  describe("resolveRecipientToStellarAddress", () => {
    it("returns valid address when raw valid Stellar address is provided", async () => {
      const res = await resolveRecipientToStellarAddress(validStellarAddress, null);
      expect(res).toBe(validStellarAddress);
      expect(mockUser.findFirst).not.toHaveBeenCalled();
    });

    it("returns null and logs warning when raw Stellar address has invalid checksum", async () => {
      const res = await resolveRecipientToStellarAddress(corruptedStellarAddress, null);
      expect(res).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "resolveRecipientToStellarAddress: raw stellar address failed validation",
        expect.objectContaining({ address: expect.any(String) }),
      );
    });

    it("returns stellarAddress when alias resolves to user with valid Stellar address", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        username: "bob",
        phoneE164: null,
        email: null,
        privacyHideFromSearch: false,
      });
      (mockUser.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: validStellarAddress,
      });

      const res = await resolveRecipientToStellarAddress("@bob", null);
      expect(res).toBe(validStellarAddress);
      expect(mockUser.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: { stellarAddress: true },
      });
    });

    it("re-validates and returns null when resolved user has a corrupted Stellar address (invalid checksum)", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-corrupted",
        username: "corrupted_user",
        phoneE164: null,
        email: null,
        privacyHideFromSearch: false,
      });
      (mockUser.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: corruptedStellarAddress,
      });

      const res = await resolveRecipientToStellarAddress("@corrupted_user", null);
      expect(res).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "resolveRecipientToStellarAddress: resolved user has invalid or corrupted stellarAddress",
        { userId: "user-corrupted" },
      );
    });

    it("re-validates and returns null when resolved user has a malformed Stellar address (wrong length/prefix)", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-malformed",
        username: "malformed_user",
        phoneE164: null,
        email: null,
        privacyHideFromSearch: false,
      });
      (mockUser.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: "MALFORMED_G_ADDRESS",
      });

      const res = await resolveRecipientToStellarAddress("@malformed_user", null);
      expect(res).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "resolveRecipientToStellarAddress: resolved user has invalid or corrupted stellarAddress",
        { userId: "user-malformed" },
      );
    });

    it("returns null when resolved user has no stellarAddress (null/undefined)", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: "user-no-addr",
        username: "noaddr",
        phoneE164: null,
        email: null,
        privacyHideFromSearch: false,
      });
      (mockUser.findUnique as jest.Mock).mockResolvedValue({
        stellarAddress: null,
      });

      const res = await resolveRecipientToStellarAddress("@noaddr", null);
      expect(res).toBeNull();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("returns null when alias does not resolve to any user", async () => {
      (mockUser.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await resolveRecipientToStellarAddress("@nonexistent", null);
      expect(res).toBeNull();
      expect(mockUser.findUnique).not.toHaveBeenCalled();
    });
  });
});
