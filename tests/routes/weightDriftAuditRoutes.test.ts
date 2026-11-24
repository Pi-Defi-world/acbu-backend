import express, { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import weightDriftAuditRoutes from "../../src/routes/weightDriftAuditRoutes";
import { errorHandler } from "../../src/middleware/errorHandler";
import { prisma as databasePrisma } from "../../src/config/database";
import { weightDriftAuditService } from "../../src/services/reserve/WeightDriftAuditService";

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

jest.mock("../../src/services/reserve/WeightDriftAuditService", () => ({
  weightDriftAuditService: {
    listAudits: jest.fn(),
    getAudit: jest.fn(),
    createAudit: jest.fn(),
    calculateDriftReport: jest.fn(),
    approveAudit: jest.fn(),
    rejectAudit: jest.fn(),
  },
}));

const VALID_KEY = "acbu_" + "a".repeat(12) + "_" + "b".repeat(64);

describe("Weight Drift Audit Routes - Admin Auth Protection", () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.apiKey.update as any).mockResolvedValue({});

    app = express();
    app.use(express.json());
    app.use("/v1/admin/weight-drift-audits", weightDriftAuditRoutes);
    app.use(errorHandler);
  });

  it("returns 401 when unauthenticated request calls admin route", async () => {
    const res = await request(app).get("/v1/admin/weight-drift-audits");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("returns 401 when malformed API key is provided", async () => {
    const res = await request(app)
      .get("/v1/admin/weight-drift-audits")
      .set("x-api-key", "invalid-key-format");

    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated key has USER_KEY type", async () => {
    (prisma.apiKey.findFirst as any).mockResolvedValue({
      id: "key-user-1",
      userId: "user-1",
      organizationId: null,
      permissions: ["p2p:read"],
      rateLimit: 100,
      keyHash: "hashed",
      keyType: "USER_KEY",
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const res = await request(app).get("/v1/admin/weight-drift-audits").set("x-api-key", VALID_KEY);

    expect(res.status).toBe(403);
    expect(res.body.error?.message).toContain("Admin key required");
  });

  it("allows access and returns 200 when authenticated with ADMIN_KEY", async () => {
    (prisma.apiKey.findFirst as any).mockResolvedValue({
      id: "key-admin-1",
      userId: "admin-user-1",
      organizationId: "org-1",
      permissions: ["admin:write"],
      rateLimit: 1000,
      keyHash: "hashed",
      keyType: "ADMIN_KEY",
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (weightDriftAuditService.listAudits as jest.Mock).mockResolvedValue({
      audits: [],
      total: 0,
    });

    const res = await request(app).get("/v1/admin/weight-drift-audits").set("x-api-key", VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      audits: [],
      pagination: { limit: 20, offset: 0, total: 0 },
    });
  });

  it("allows access with Bearer header when authenticated with BREAK_GLASS_KEY", async () => {
    (prisma.apiKey.findFirst as any).mockResolvedValue({
      id: "key-bg-1",
      userId: "emergency-admin-1",
      organizationId: "org-1",
      permissions: ["admin:write"],
      rateLimit: 1000,
      keyHash: "hashed",
      keyType: "BREAK_GLASS_KEY",
      emergencyReason: "Urgent fix",
      emergencyExpiresAt: new Date(Date.now() + 3600000),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (weightDriftAuditService.listAudits as jest.Mock).mockResolvedValue({
      audits: [],
      total: 0,
    });

    const res = await request(app)
      .get("/v1/admin/weight-drift-audits")
      .set("Authorization", `Bearer ${VALID_KEY}`);

    expect(res.status).toBe(200);
  });
});
