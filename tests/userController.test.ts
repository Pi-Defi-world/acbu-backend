
import { deleteMe, patchMe } from "../src/controllers/userController";
import { prisma } from "../src/config/database";
import bcrypt from "bcrypt";

jest.mock("../src/config/database", () => ({
  prisma: {
    user: { update: jest.fn(), findUnique: jest.fn() },
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

describe("User Controller - patchMe", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  const mockExistingUser = {
    id: "test-user-id",
    username: "alice",
    email: "alice@example.com",
    phoneE164: "+12345678901",
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    phoneVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    privacyHideFromSearch: true,
    passcodeHash: "$2b$10$hashedPasscodeValueExisting",
    kycStatus: "approved",
    countryCode: "USA",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  beforeEach(() => {
    mockReq = {
      apiKey: { userId: "test-user-id" },
      body: {},
    };
    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockExistingUser });
    (prisma.user.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({
        ...mockExistingUser,
        ...data,
      }),
    );
  });

  it("should reset emailVerifiedAt when email is changed", async () => {
    mockReq.body = { email: "newalice@example.com" };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: expect.objectContaining({
        email: "newalice@example.com",
        emailVerifiedAt: null,
      }),
      select: expect.any(Object),
    });
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newalice@example.com",
        email_verified_at: undefined,
      }),
    );
  });

  it("should reset emailVerifiedAt when email is removed (set to null)", async () => {
    mockReq.body = { email: null };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: expect.objectContaining({
        email: null,
        emailVerifiedAt: null,
      }),
      select: expect.any(Object),
    });
  });

  it("should not reset emailVerifiedAt when email is unchanged", async () => {
    mockReq.body = { email: "alice@example.com" };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: {
        email: "alice@example.com",
      },
      select: expect.any(Object),
    });
  });

  it("should reset phoneVerifiedAt when phone_e164 is changed", async () => {
    mockReq.body = { phone_e164: "+19876543210" };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: expect.objectContaining({
        phoneE164: "+19876543210",
        phoneVerifiedAt: null,
      }),
      select: expect.any(Object),
    });
  });

  it("should require current_passcode if user already has a passcode set", async () => {
    mockReq.body = { passcode: "newSecretPasscode" };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Current passcode is required to change passcode",
        statusCode: 400,
      }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("should reject with 401 when current_passcode does not match", async () => {
    jest.spyOn(bcrypt, "compare").mockImplementation(() => Promise.resolve(false) as any);
    mockReq.body = {
      passcode: "newSecretPasscode",
      current_passcode: "wrongCurrentPasscode",
    };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Invalid current passcode",
        statusCode: 401,
      }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("should update passcode when valid current_passcode is provided", async () => {
    jest.spyOn(bcrypt, "compare").mockImplementation(() => Promise.resolve(true) as any);
    jest.spyOn(bcrypt, "hash").mockImplementation(() => Promise.resolve("newHashedPasscode") as any);
    mockReq.body = {
      passcode: "newSecretPasscode",
      current_passcode: "correctCurrentPasscode",
    };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: expect.objectContaining({
        passcodeHash: "newHashedPasscode",
      }),
      select: expect.any(Object),
    });
  });

  it("should allow setting passcode without current_passcode when user has no existing passcode", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockExistingUser,
      passcodeHash: null,
    });
    jest.spyOn(bcrypt, "hash").mockImplementation(() => Promise.resolve("initialHashedPasscode") as any);
    mockReq.body = { passcode: "initialSecretPasscode" };
    await patchMe(mockReq as any, mockRes as any, mockNext);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: expect.objectContaining({
        passcodeHash: "initialHashedPasscode",
      }),
      select: expect.any(Object),
    });
  });
});
