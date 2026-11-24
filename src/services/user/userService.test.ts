import { tombstoneDeleteUser } from "./userService";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import crypto from "crypto";

jest.mock("../../config/database", () => ({
  prisma: {
    $transaction: jest.fn(),
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

jest.mock("crypto", () => ({
  randomUUID: jest.fn(() => "12345678-abcd-efgh-ijkl-mnopqrstuv99"),
}));

describe("userService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("tombstoneDeleteUser", () => {
    const userId = "test-user-id";

    it("should execute a transaction with correct deletions and user update", async () => {
      const mockTransaction = jest.fn(async (callback) => {
        // Simulate the transaction callback
        const mockTx = {
          apiKey: { deleteMany: jest.fn() },
          otpChallenge: { deleteMany: jest.fn() },
          userPasskey: { deleteMany: jest.fn() },
          userContact: { deleteMany: jest.fn() },
          guardian: { deleteMany: jest.fn() },
          user: { update: jest.fn() },
        };
        await callback(mockTx);
        return mockTx;
      });

      (prisma.$transaction as jest.Mock).mockImplementation(mockTransaction);

      await tombstoneDeleteUser(userId, "deleteAccount");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should delete API keys for the user", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      expect(mockTx.apiKey.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it("should delete OTP challenges for the user", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      expect(mockTx.otpChallenge.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it("should delete user passphrases for the user", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      expect(mockTx.userPasskey.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it("should delete user contacts (as both sender and recipient)", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      // Check that deleteMany was called twice for userContact
      expect(mockTx.userContact.deleteMany).toHaveBeenCalledTimes(2);
      expect(mockTx.userContact.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { userId },
      });
      expect(mockTx.userContact.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { contactUserId: userId },
      });
    });

    it("should delete guardians (as both user and guardian)", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      // Check that deleteMany was called twice for guardian
      expect(mockTx.guardian.deleteMany).toHaveBeenCalledTimes(2);
      expect(mockTx.guardian.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { userId },
      });
      expect(mockTx.guardian.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { guardianUserId: userId },
      });
    });

    it("should tombstone the user record with correct fields", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          username: "deleted_12345678",
          email: null,
          phoneE164: null,
          stellarAddress: null,
          kycStatus: "deleted",
          encryptedStellarSecret: null,
          keyEncryptionHint: null,
          passcodeHash: null,
          twoFaMethod: null,
          totpSecretEncrypted: null,
          privacyHideFromSearch: true,
        },
      });
    });

    it("should log with 'deleteAccount' message for deleteAccount source", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteAccount");

      expect(logger.info).toHaveBeenCalledWith("Account tombstone deleted", {
        userId,
      });
    });

    it("should log with 'deleteMe' message for deleteMe source", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId, "deleteMe");

      expect(logger.info).toHaveBeenCalledWith("Account tombstone deleted (legacy endpoint)", {
        userId,
      });
    });

    it("should use default source of 'deleteAccount' when not specified", async () => {
      const mockTx = {
        apiKey: { deleteMany: jest.fn().mockResolvedValue({}) },
        otpChallenge: { deleteMany: jest.fn().mockResolvedValue({}) },
        userPasskey: { deleteMany: jest.fn().mockResolvedValue({}) },
        userContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        guardian: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        await cb(mockTx);
      });

      await tombstoneDeleteUser(userId);

      expect(logger.info).toHaveBeenCalledWith("Account tombstone deleted", {
        userId,
      });
    });

    it("should handle transaction errors", async () => {
      const transactionError = new Error("Transaction failed");
      (prisma.$transaction as jest.Mock).mockRejectedValue(transactionError);

      await expect(tombstoneDeleteUser(userId)).rejects.toThrow("Transaction failed");
    });
  });
});
