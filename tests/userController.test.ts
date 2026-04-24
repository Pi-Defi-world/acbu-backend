
import { deleteMe } from "../src/controllers/userController";
import { prisma } from "../src/config/database";


jest.mock("../src/config/database", () => ({
  prisma: {
    user: { update: jest.fn() },
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

describe("User Controller - deleteMe (Tombstone)", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      apiKey: { userId: "test-user-id" },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  it("should tombstone user account successfully", async () => {
    await deleteMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({ where: { userId: "test-user-id" } });
    
    // Check if the user record was updated with tombstone values
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: expect.objectContaining({
        username: expect.stringMatching(/^deleted_[a-f0-9]{8}$/),
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
      }),
    });

    expect(mockRes.status).toHaveBeenCalledWith(204);
    expect(mockRes.send).toHaveBeenCalled();
  });

  it("should fail if no userId is provided", async () => {
    mockReq.apiKey = undefined;
    await deleteMe(mockReq as any, mockRes as any, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockNext.mock.calls[0][0].message).toBe("User-scoped API key required");
  });
});
