/**
 * Tests for the refresh-token flow (issue #734).
 *
 * The RefreshToken Prisma model and these service functions already
 * existed; the actual gap was that no migration had ever been written to
 * create the `refresh_tokens` table (see
 * prisma/migrations/20260827000000_add_refresh_tokens/migration.sql).
 *
 * These are unit tests against a mocked Prisma client - they verify the
 * service logic (hashing, token-family rotation, audit logging) rather
 * than exercising a real database. A real Postgres instance is required
 * to validate the migration.sql itself applies cleanly; that should be
 * covered by CI, which runs against an actual Postgres service.
 */
import {
  issueRefreshToken,
  refreshAccessToken,
  revokeRefreshToken,
} from "./authService";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { logAudit } from "../audit";

jest.mock("../../config/database", () => ({
  prisma: {
    refreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("../../middleware/auth", () => ({
  generateApiKey: jest.fn(),
}));

jest.mock("../audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

// authService.ts imports config/rabbitmq at module scope (unrelated to the
// refresh-token flow under test here). Mocking it avoids ts-jest compiling
// the real file, which currently has a separate, already-tracked unused-
// import bug (issue #715, PR #849 open) unrelated to this fix.
jest.mock("../../config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  QUEUES: {
    OTP_SEND: "otp_send",
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

describe("refresh token flow (#734)", () => {
  const userId = "user-1";
  const SHA256_HEX = /^[a-f0-9]{64}$/;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("issueRefreshToken", () => {
    it("creates a refresh token row and returns a token + expiry", async () => {
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});

      const result = await issueRefreshToken({ userId });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            tokenHash: expect.stringMatching(SHA256_HEX),
          }),
        }),
      );
      expect(result.refresh_token).toEqual(expect.any(String));
      expect(result.expires_at).toEqual(expect.any(String));
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "refresh_token_issued",
          performedBy: userId,
        }),
      );
    });
  });

  describe("refreshAccessToken", () => {
    const existingToken = {
      id: "rt-1",
      tokenFamilyId: "family-1",
      user: { id: userId, actorType: "retail", organizationId: null },
    };

    it("rejects when no matching, unrevoked, unexpired token exists", async () => {
      (prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        refreshAccessToken({ refresh_token: "bogus" }),
      ).rejects.toThrow("Invalid or expired refresh token");

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(generateApiKey).not.toHaveBeenCalled();
    });

    it("rotates the whole token family and issues a new token + api key", async () => {
      (prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(
        existingToken,
      );
      (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});
      (generateApiKey as jest.Mock).mockResolvedValue("new-api-key");

      const result = await refreshAccessToken({
        refresh_token: "old-refresh-token",
      });

      // The old family must be fully revoked, not just the one token used.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tokenFamilyId: existingToken.tokenFamilyId,
            revokedAt: null,
          }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );

      // A brand new token in a brand new family is issued.
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId }),
        }),
      );
      const createCallFamilyId = (prisma.refreshToken.create as jest.Mock).mock
        .calls[0][0].data.tokenFamilyId;
      expect(createCallFamilyId).not.toEqual(existingToken.tokenFamilyId);

      expect(result.api_key).toBe("new-api-key");
      expect(result.user_id).toBe(userId);
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "refresh_token_rotated" }),
      );
    });
  });

  describe("revokeRefreshToken", () => {
    it("rejects when the token is already revoked or unknown", async () => {
      (prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        revokeRefreshToken({ refresh_token: "bogus" }),
      ).rejects.toThrow("Invalid refresh token");

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it("revokes every token in the family, not just the one presented", async () => {
      (prisma.refreshToken.findFirst as jest.Mock).mockResolvedValue({
        id: "rt-1",
        tokenFamilyId: "family-1",
        user: { id: userId, actorType: "retail", organizationId: null },
      });
      (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const result = await revokeRefreshToken({
        refresh_token: "some-token",
      });

      expect(result).toEqual({ ok: true });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tokenFamilyId: "family-1",
            revokedAt: null,
          }),
        }),
      );
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "refresh_token_revoked" }),
      );
    });
  });
});
