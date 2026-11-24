import { validateApiKey, validateAdminKey, generateApiKey, hashApiKey } from "./auth";
import { prisma as databasePrisma } from "../config/database";
const prisma: any = databasePrisma;
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
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

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import { validateApiKey, generateApiKey, hashApiKey, validateAdminKey } from "./auth";
import { prisma } from "../config/database";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AppError } from "./errorHandler";
import type { AuthRequest } from "./auth";
import type { Request, Response, NextFunction } from "express";

const VALID_KEY = "acbu_" + "a".repeat(12) + "_" + "b".repeat(64);
const VALID_KEY2 = "acbu_" + "c".repeat(12) + "_" + "d".repeat(64);

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({ headers: {}, ...overrides }) as AuthRequest;

const mockRes = {} as Response;
const mockNext = jest.fn() as jest.MockedFunction<NextFunction>;

describe("auth middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.apiKey.update as any).mockResolvedValue({});
  });

  describe("validateApiKey", () => {
    it("rejects request with no API key — 401", async () => {
      await validateApiKey(makeReq(), mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
    });

    it("rejects malformed key format — 401 with message", async () => {
      await validateApiKey(makeReq({ headers: { "x-api-key": "bad_key" } }), mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid API key format");
    });

    it("rejects OAuth access-token style JWTs with typ at+JWT — 401", async () => {
      const oauthStyleToken = jwt.sign(
        { sub: "user-1", aud: "api_session", iss: "acbu/auth" },
        "oauth-shared-secret",
        { header: { typ: "at+JWT", alg: "HS256" } },
      );

      await validateApiKey(
        makeReq({ headers: { authorization: `Bearer ${oauthStyleToken}` } }),
        mockRes,
        mockNext,
      );

      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid credentials format");
      expect(prisma.apiKey.findFirst as any).not.toHaveBeenCalled();
    });

    it("rejects when lookup key not in DB — 401", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue(null);
      await validateApiKey(makeReq({ headers: { "x-api-key": VALID_KEY } }), mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid API key");
      expect(prisma.apiKey.findFirst as any).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: [
                  { keyType: { not: "BREAK_GLASS_KEY" } },
                  { emergencyExpiresAt: { gt: expect.any(Date) } },
                ],
              }),
            ]),
          }),
        }),
      );
    });

    it("rejects when bcrypt compare fails — 401", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: [],
        rateLimit: 100,
        keyHash: "hashed",
        keyType: "USER_KEY",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await validateApiKey(makeReq({ headers: { "x-api-key": VALID_KEY } }), mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid API key");
    });

    it("calls next() with no error and populates req.apiKey on valid key", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: ["p2p:read", "p2p:write"],
        rateLimit: 100,
        keyHash: "hashed",
        keyType: "USER_KEY",
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
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-2",
        userId: "user-2",
        organizationId: null,
        permissions: [],
        rateLimit: 50,
        keyHash: "hashed2",
        keyType: "USER_KEY",
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
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-3",
        userId: "user-3",
        organizationId: null,
        permissions: { invalid: true },
        rateLimit: 100,
        keyHash: "hashed",
        keyType: "USER_KEY",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const req = makeReq({ headers: { "x-api-key": VALID_KEY } });
      await validateApiKey(req, mockRes, mockNext);
      expect(req.apiKey?.permissions).toEqual([]);
    });

    it("updates lastUsedAt asynchronously after valid auth", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-1",
        userId: "user-1",
        organizationId: null,
        permissions: [],
        rateLimit: 100,
        keyHash: "hashed",
        keyType: "USER_KEY",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await validateApiKey(makeReq({ headers: { "x-api-key": VALID_KEY } }), mockRes, mockNext);
      // Allow async update to fire
      await Promise.resolve();
      expect(prisma.apiKey.update as any).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "key-1" } }),
      );
    });
  });

  describe("validateAdminKey", () => {
    it("rejects request with no API key — 401", async () => {
      await validateAdminKey(makeReq(), mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
    });

    it("rejects malformed key format — 401", async () => {
      await validateAdminKey(
        makeReq({ headers: { "x-api-key": "invalid_format" } }),
        mockRes,
        mockNext,
      );
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
    });

    it("rejects non-admin key (USER_KEY) — 403", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-user",
        userId: "user-1",
        organizationId: null,
        permissions: ["p2p:read"],
        rateLimit: 100,
        keyHash: "hashed",
        keyType: "USER_KEY",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const req = makeReq({ headers: { "x-api-key": VALID_KEY } });
      await validateAdminKey(req, mockRes, mockNext);

      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toBe("Admin key required for this operation");
    });

    it("accepts valid ADMIN_KEY — 200/next() and populates req.apiKey and req.adminId", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-admin",
        userId: "admin-user-123",
        organizationId: "org-1",
        permissions: ["admin:write"],
        rateLimit: 1000,
        keyHash: "hashed",
        keyType: "ADMIN_KEY",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const req = makeReq({ headers: { "x-api-key": VALID_KEY } });
      await validateAdminKey(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(req.apiKey).toBeDefined();
      expect(req.apiKey?.keyType).toBe("ADMIN_KEY");
      expect(req.adminId).toBe("admin-user-123");
    });

    it("accepts valid BREAK_GLASS_KEY — 200/next() and sets adminId", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-bg",
        userId: "emergency-user-456",
        organizationId: "org-1",
        permissions: ["admin:write"],
        rateLimit: 1000,
        keyHash: "hashed",
        keyType: "BREAK_GLASS_KEY",
        emergencyReason: "Production Incident",
        emergencyExpiresAt: new Date(Date.now() + 3600000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const req = makeReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
      await validateAdminKey(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(req.apiKey?.keyType).toBe("BREAK_GLASS_KEY");
      expect(req.adminId).toBe("emergency-user-456");
    });

    it("handles pre-existing req.apiKey on request context", async () => {
      const req = makeReq({
        apiKey: {
          id: "key-pre-existing",
          userId: "admin-pre",
          organizationId: null,
          keyType: "ADMIN_KEY",
          createdByUserId: null,
          emergencyReason: null,
          emergencyExpiresAt: null,
          permissions: [],
          rateLimit: 100,
        },
      });

      await validateAdminKey(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
      expect(req.adminId).toBe("admin-pre");
      expect(prisma.apiKey.findFirst as any).not.toHaveBeenCalled();
    });

    it("rejects pre-existing non-admin req.apiKey with 403", async () => {
      const req = makeReq({
        apiKey: {
          id: "key-user-pre",
          userId: "user-pre",
          organizationId: null,
          keyType: "USER_KEY",
          createdByUserId: null,
          emergencyReason: null,
          emergencyExpiresAt: null,
          permissions: [],
          rateLimit: 100,
        },
      });

      await validateAdminKey(req, mockRes, mockNext);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
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
      (prisma.apiKey.create as any).mockResolvedValue({});
      const key = await generateApiKey("user-42", ["p2p:write"]);
      expect(key).toMatch(/^acbu_[a-f0-9]{12}_[a-f0-9]{64}$/);
      expect(prisma.apiKey.create as any).toHaveBeenCalledWith(
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
