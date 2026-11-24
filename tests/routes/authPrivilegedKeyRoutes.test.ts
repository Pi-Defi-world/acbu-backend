// W10-BE-005: requireAdminKeyType must actually guard privileged key management.
import express, { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import authRoutes from "../../src/routes/authRoutes";
import { errorHandler } from "../../src/middleware/errorHandler";
import { prisma as databasePrisma } from "../../src/config/database";
import type { ApiKeyType } from "../../src/middleware/auth";

const prisma: any = databasePrisma;

jest.mock("../../src/config/database", () => ({
  prisma: {
    apiKey: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock("../../src/config/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock("../../src/middleware/rateLimiter", () => ({
  authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiKeyRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  twoFaRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../../src/controllers/authController", () => {
  const handler = (name: string) => (_req: unknown, res: any) =>
    res.json({ ok: true, route: name });

  return {
    getPrivilegedKeys: handler("getPrivilegedKeys"),
    postAdminMfaChallenge: handler("postAdminMfaChallenge"),
    postIssueAdminKey: handler("postIssueAdminKey"),
    postIssueBreakGlassKey: handler("postIssueBreakGlassKey"),
    postRevokePrivilegedKey: handler("postRevokePrivilegedKey"),
    postRefreshAccessToken: handler("postRefreshAccessToken"),
    postRevokeRefreshToken: handler("postRevokeRefreshToken"),
    postSignin: handler("postSignin"),
    postSignout: handler("postSignout"),
    postSignup: handler("postSignup"),
    postVerify2fa: handler("postVerify2fa"),
  };
});

const VALID_KEY = "acbu_" + "a".repeat(12) + "_" + "b".repeat(64);

function mockKey(keyType: ApiKeyType) {
  (prisma.apiKey.findFirst as any).mockResolvedValue({
    id: `key-${keyType}`,
    userId: "user-1",
    organizationId: "org-1",
    permissions: ["p2p:read"],
    rateLimit: 100,
    keyHash: "hashed",
    keyType,
  });
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
}

describe("Privileged key routes - admin key type enforcement (W10-BE-005)", () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.apiKey.update as any).mockResolvedValue({});

    app = express();
    app.use(express.json());
    app.use("/v1/auth", authRoutes);
    app.use(errorHandler);
  });

  describe("GET /v1/auth/keys/privileged", () => {
    it("returns 401 when no API key is provided", async () => {
      const res = await request(app).get("/v1/auth/keys/privileged");
      expect(res.status).toBe(401);
    });

    it("returns 403 for a USER_KEY", async () => {
      mockKey("USER_KEY");

      const res = await request(app).get("/v1/auth/keys/privileged").set("x-api-key", VALID_KEY);

      expect(res.status).toBe(403);
      expect(res.body.error?.message).toContain("Admin key required");
    });

    it("allows an ADMIN_KEY", async () => {
      mockKey("ADMIN_KEY");

      const res = await request(app).get("/v1/auth/keys/privileged").set("x-api-key", VALID_KEY);

      expect(res.status).toBe(200);
      expect(res.body.route).toBe("getPrivilegedKeys");
    });

    it("allows a BREAK_GLASS_KEY", async () => {
      mockKey("BREAK_GLASS_KEY");

      const res = await request(app)
        .get("/v1/auth/keys/privileged")
        .set("Authorization", `Bearer ${VALID_KEY}`);

      expect(res.status).toBe(200);
    });
  });

  describe("POST /v1/auth/keys/:id/revoke", () => {
    it("returns 403 for a USER_KEY", async () => {
      mockKey("USER_KEY");

      const res = await request(app)
        .post("/v1/auth/keys/key-admin-1/revoke")
        .set("x-api-key", VALID_KEY)
        .send({ reason: "compromised" });

      expect(res.status).toBe(403);
      expect(res.body.error?.message).toContain("Admin key required");
    });

    it("allows an ADMIN_KEY", async () => {
      mockKey("ADMIN_KEY");

      const res = await request(app)
        .post("/v1/auth/keys/key-admin-1/revoke")
        .set("x-api-key", VALID_KEY)
        .send({ reason: "compromised" });

      expect(res.status).toBe(200);
      expect(res.body.route).toBe("postRevokePrivilegedKey");
    });
  });

  describe("bootstrap paths stay reachable with a USER_KEY", () => {
    it("allows issuing an admin key (no admin key exists yet)", async () => {
      mockKey("USER_KEY");

      const res = await request(app)
        .post("/v1/auth/keys/admin")
        .set("x-api-key", VALID_KEY)
        .send({
          reason: "initial provisioning",
          permissions: ["p2p:admin"],
          challenge_token: "t",
          code: "000000",
        });

      expect(res.status).toBe(200);
      expect(res.body.route).toBe("postIssueAdminKey");
    });

    it("allows issuing a break-glass key during recovery", async () => {
      mockKey("USER_KEY");

      const res = await request(app)
        .post("/v1/auth/keys/break-glass")
        .set("x-api-key", VALID_KEY)
        .send({ reason: "recovery", permissions: [], challenge_token: "t", code: "000000" });

      expect(res.status).toBe(200);
      expect(res.body.route).toBe("postIssueBreakGlassKey");
    });

    it("allows requesting the admin MFA challenge before any admin key exists", async () => {
      mockKey("USER_KEY");

      const res = await request(app)
        .post("/v1/auth/admin/challenge")
        .set("x-api-key", VALID_KEY)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.route).toBe("postAdminMfaChallenge");
    });
  });
});
