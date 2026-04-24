import {
  issueAdminKey,
  issueBreakGlassKey,
  listPrivilegedKeys,
  requestAdminMfaChallenge,
  revokePrivilegedKey,
} from "./authService";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { verifyChallengeToken, signChallengeToken } from "../../utils/jwt";
import { logAudit } from "../audit";
import bcrypt from "bcryptjs";
import { totp } from "otplib";
import { getRabbitMQChannel, QUEUES } from "../../config/rabbitmq";

jest.mock("../../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    otpChallenge: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    apiKey: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../../middleware/auth", () => ({
  generateApiKey: jest.fn(),
}));

jest.mock("../../utils/jwt", () => ({
  signChallengeToken: jest.fn(),
  verifyChallengeToken: jest.fn(),
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../wallet/walletService", () => ({
  ensureWalletForUser: jest.fn().mockResolvedValue({ wallet_created: false }),
}));

jest.mock("../audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock("otplib", () => ({
  totp: {
    check: jest.fn(),
  },
}));

jest.mock("../../config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  QUEUES: {
    OTP_SEND: "otp_send",
  },
}));

describe("authService privileged key coverage", () => {
  const mqChannel = {
    assertQueue: jest.fn().mockResolvedValue(undefined),
    sendToQueue: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getRabbitMQChannel as jest.Mock).mockReturnValue(mqChannel);
    (signChallengeToken as jest.Mock).mockReturnValue("challenge-token");
    (verifyChallengeToken as jest.Mock).mockReturnValue({ userId: "admin-1" });
    (generateApiKey as jest.Mock).mockResolvedValue("acbu_admin_key");
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-code");
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (totp.check as jest.Mock).mockReturnValue(true);
  });

  it("creates admin MFA challenge for sms and logs attribution", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "admin-1",
      tier: "enterprise",
      twoFaMethod: "sms",
      email: null,
      phoneE164: "+2348000000000",
      actorType: "sme",
      organizationId: "org-1",
    });

    const out = await requestAdminMfaChallenge("admin-1");

    expect(out).toEqual({ challenge_token: "challenge-token", method: "sms" });
    expect(prisma.otpChallenge.create).toHaveBeenCalled();
    expect(mqChannel.assertQueue).toHaveBeenCalledWith(QUEUES.OTP_SEND, { durable: true });
    expect(mqChannel.sendToQueue).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin_mfa_challenge_issued",
        performedBy: "admin-1",
        actorType: "sme",
        organizationId: "org-1",
      }),
    );
  });

  it("issues admin key after MFA challenge verification", async () => {
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: "admin-1",
        tier: "enterprise",
        actorType: "sme",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce({
        id: "admin-1",
        twoFaMethod: "totp",
        totpSecretEncrypted: "totp-secret",
      });

    const out = await issueAdminKey({
      actorUserId: "admin-1",
      challengeToken: "challenge-token",
      code: "123456",
      permissions: ["sme:admin", "p2p:write", "enterprise:admin"],
      reason: "Need elevated support troubleshooting",
    });

    expect(out).toEqual({
      api_key: "acbu_admin_key",
      user_id: "admin-1",
      key_type: "ADMIN_KEY",
    });
    expect(generateApiKey).toHaveBeenCalledWith(
      "admin-1",
      ["sme:admin", "enterprise:admin"],
      expect.objectContaining({
        keyType: "ADMIN_KEY",
        organizationId: "org-1",
        createdByUserId: "admin-1",
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin_key_issued",
        keyType: "ADMIN_KEY",
        reason: "Need elevated support troubleshooting",
      }),
    );
  });

  it("issues break-glass key with explicit TTL and emergency metadata", async () => {
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: "admin-1",
        tier: "enterprise",
        actorType: "sme",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce({
        id: "admin-1",
        twoFaMethod: "totp",
        totpSecretEncrypted: "totp-secret",
      });

    const out = await issueBreakGlassKey({
      actorUserId: "admin-1",
      challengeToken: "challenge-token",
      code: "123456",
      permissions: ["gateway:admin"],
      reason: "Incident response",
      ttlMinutes: 20,
    });

    expect(out.key_type).toBe("BREAK_GLASS_KEY");
    expect(out.expires_at).toBeDefined();
    expect(generateApiKey).toHaveBeenCalledWith(
      "admin-1",
      ["gateway:admin"],
      expect.objectContaining({
        keyType: "BREAK_GLASS_KEY",
        emergencyReason: "Incident response",
        emergencyExpiresAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
    );
  });

  it("rejects break-glass key issuance when TTL exceeds max", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "admin-1",
      tier: "enterprise",
      actorType: "sme",
      organizationId: "org-1",
    });

    await expect(
      issueBreakGlassKey({
        actorUserId: "admin-1",
        challengeToken: "challenge-token",
        code: "123456",
        permissions: ["gateway:admin"],
        reason: "Incident response",
        ttlMinutes: 120,
      }),
    ).rejects.toThrow("Break-glass TTL must be between 1 and 60 minutes");
  });

  it("lists privileged keys for admin-tier user", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "admin-1",
      tier: "enterprise",
    });
    (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([
      {
        id: "k1",
        keyType: "ADMIN_KEY",
        permissions: ["sme:admin"],
      },
    ]);

    const out = await listPrivilegedKeys("admin-1");

    expect(out).toHaveLength(1);
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "admin-1",
          keyType: { in: ["ADMIN_KEY", "BREAK_GLASS_KEY"] },
        }),
      }),
    );
  });

  it("revokes privileged key and logs attributed audit event", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "admin-1",
      tier: "enterprise",
      actorType: "sme",
      organizationId: "org-1",
    });
    (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
      id: "k1",
      keyType: "ADMIN_KEY",
    });
    (prisma.apiKey.update as jest.Mock).mockResolvedValue({});

    const out = await revokePrivilegedKey({
      actorUserId: "admin-1",
      keyId: "k1",
      reason: "Session ended",
    });

    expect(out).toEqual({ ok: true });
    expect(prisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "k1" } }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "privileged_key_revoked",
        keyType: "ADMIN_KEY",
        organizationId: "org-1",
        reason: "Session ended",
      }),
    );
  });
});
