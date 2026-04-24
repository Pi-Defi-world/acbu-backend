
import { exportData, deleteAccount } from "../src/controllers/complianceController";
import { prisma } from "../src/config/database";
import { AppError } from "../src/middleware/errorHandler";

jest.mock("../src/config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    apiKey: { deleteMany: jest.fn() },
    otpChallenge: { deleteMany: jest.fn() },
    userPasskey: { deleteMany: jest.fn() },
    userContact: { deleteMany: jest.fn() },
    guardian: { deleteMany: jest.fn() },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("Compliance Controller", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      apiKey: { userId: "test-user-id" },
    };
    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe("exportData", () => {
    it("should export user data safely", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "test@example.com",
        passcodeHash: "secret-hash",
        encryptedStellarSecret: "secret",
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await exportData(mockReq as any, mockRes as any, mockNext);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "test-user-id" },
        include: expect.any(Object),
      });

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          export_timestamp: expect.any(String),
          user: {
            id: "test-user-id",
            email: "test@example.com",
            // sensitive fields omitted
          },
        })
      );
    });

    it("should handle missing user", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await exportData(mockReq as any, mockRes as any, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe("deleteAccount", () => {
    it("should tombstone user account", async () => {
      await deleteAccount(mockReq as any, mockRes as any, mockNext);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({ where: { userId: "test-user-id" } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "test-user-id" },
        data: expect.objectContaining({
          email: null,
          kycStatus: "deleted",
          privacyHideFromSearch: true,
        }),
      });
      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockRes.send).toHaveBeenCalled();
    });
  });
});
