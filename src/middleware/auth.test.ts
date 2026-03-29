import { validateApiKey, generateApiKey, hashApiKey } from "./auth";
import { prisma } from "../config/database";
import bcrypt from "bcryptjs";
import { AppError } from "./errorHandler";
import type { AuthRequest } from "./auth";
import type { Response, NextFunction } from "express";

jest.mock("../config/database", () => ({
  prisma: {
    apiKey: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    },
  },
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const VALID_KEY = "acbu_" + "a".repeat(12) + "_" + "b".repeat(64);
const VALID_KEY2 = "acbu_" + "c".repeat(12) + "_" + "d".repeat(64);

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({ headers: {}, ...overrides }) as AuthRequest;

const mockRes = {} as Response;
const mockNext = jest.fn() as jest.MockedFunction<NextFunction>;

describe("auth middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.apiKey.update as jest.Mock).mockResolvedValue({});
  });

  describe("validateApiKey", () => {
    it("rejects request with no API key — 401", async () => {
      await validateApiKey(makeReq(), mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
    });

    it("rejects malformed key format — 401 with message", async () => {
      await validateApiKey(
        makeReq({ headers: { "x-api-key": "bad_key" } }),
        mockRes,
        mockNext,
      );
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid API key format");
    });

    it("rejects when lookup key not in DB — 401", async () => {
      (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null);
      await validateApiKey(
        makeReq({ headers: { "x-api-key": VALID_KEY } }),
        mockRes,
        mockNext,
      );
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid API key");
    });

    it("rejects when bcrypt compare fails — 401", async () => {
      (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: [],
        rateLimit: 100,
        keyHash: "hashed",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await validateApiKey(
        makeReq({ headers: { "x-api-key": VALID_KEY } }),
        mockRes,
        mockNext,
      );
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid API key");
    });

    it("calls next() with no error and populates req.apiKey on valid key", async () => {
      (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: ["p2p:read", "p2p:write"],
        rateLimit: 100,
        keyHash: "hashed",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const req = makeReq({ headers: { "x-api-key": VALID_KEY } });
      await validateApiKey(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
      expect(req.apiKey).toMatchObject({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: ["p2p:read", "p2p:write"],
        rateLimit: 100,
      });
    });

    it("accepts Bearer token in Authorization header", async () => {
      (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: "key-2",
        userId: "user-2",
        organizationId: null,
        permissions: [],
        rateLimit: 50,
        keyHash: "hashed2",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const req = makeReq({
        headers: { authorization: `Bearer ${VALID_KEY2}` },
      });
      await validateApiKey(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
      expect(req.apiKey?.userId).toBe("user-2");
    });

    it("treats invalid permissions JSON as empty array", async () => {
      (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: "key-3",
        userId: "user-3",
        organizationId: null,
        permissions: { invalid: true },
        rateLimit: 100,
        keyHash: "hashed",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const req = makeReq({ headers: { "x-api-key": VALID_KEY } });
      await validateApiKey(req, mockRes, mockNext);
      expect(req.apiKey?.permissions).toEqual([]);
    });

    it("updates lastUsedAt asynchronously after valid auth", async () => {
      (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: [],
        rateLimit: 100,
        keyHash: "hashed",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await validateApiKey(
        makeReq({ headers: { "x-api-key": VALID_KEY } }),
        mockRes,
        mockNext,
      );
      // Allow async update to fire
      await Promise.resolve();
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "key-1" } }),
      );
    });
  });

  describe("hashApiKey", () => {
    it("delegates to bcrypt.hash with cost factor 10", async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$10$hashed");
      const result = await hashApiKey("my-secret");
      expect(bcrypt.hash).toHaveBeenCalledWith("my-secret", 10);
      expect(result).toBe("$2b$10$hashed");
    });
  });

  describe("generateApiKey", () => {
    it("creates a DB record and returns key in acbu_<lookup>_<secret> format", async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$10$hash");
      (prisma.apiKey.create as jest.Mock).mockResolvedValue({});
      const key = await generateApiKey("user-42", ["p2p:write"]);
      expect(key).toMatch(/^acbu_[a-f0-9]{12}_[a-f0-9]{64}$/);
      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-42",
            permissions: ["p2p:write"],
          }),
        }),
      );
    });
  });
});
