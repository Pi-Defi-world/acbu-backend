/**
 * Signin: identifier (username/email/phone) + passcode.
 * Signup: username + passcode (simple account creation; no email).
 * If 2FA enabled, returns challenge_token (JWT); else issues api_key.
 * OTP (sms/email) is created and published to RabbitMQ OTP_SEND for delivery.
 */
import bcrypt from "bcrypt";
import { totp } from "otplib";
import { randomUUID } from "crypto";
import { config } from "../../config/env";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { signChallengeToken, verifyChallengeToken } from "../../utils/jwt";
import { logger } from "../../config/logger";
import { getRabbitMQChannel } from "../../config/rabbitmq";
import { QUEUES } from "../../config/rabbitmq";
import { ensureWalletForUser } from "../wallet/walletService";
import { logAudit } from "../audit";
import { authBruteGuard } from "../../utils/authBruteGuard";
import {
  PermissionsArraySchema,
  PermissionScope,
} from "../../types/permissions";
import {
  UsernameTakenError,
  InvalidCredentialsError,
  TooManyAttemptsError,
  CaptchaRequiredError,
  TwoFactorChannelNotConfiguredError,
  InvalidOrExpiredChallengeError,
  InvalidCodeError,
  InvalidOrExpiredCodeError,
  TotpNotConfiguredError,
  UnsupportedTwoFactorMethodError,
  AdminTierAccessRequiredError,
  OrganizationContextRequiredError,
  TwoFactorRequiredForAdminError,
  ReasonRequiredError,
  AdminScopeRequiredError,
  BreakGlassTtlError,
  PrivilegedKeyNotFoundError,
  InvalidOrExpiredRefreshTokenError,
  InvalidRefreshTokenError,
  ValidationError,
} from "../../errors/index";

const DUMMY_HASH =
  "$2a$10$CwTycUXWue0Thq9StjUM0uEnOTWj2XOTl0pypEQuA7y2h2H6jX.m2"; // hash for 'dummy'

export interface SignupParams {
  username: string;
  passcode: string;
}

export interface SignupResult {
  user_id: string;
  message: string;
}

export interface SigninParams {
  identifier: string; // username (with/without @), email, or E.164 phone
  passcode: string;
  ip: string;
  captchaToken?: string;
  issueRefreshToken?: boolean;
}

export type SigninResult =
  | { requires_2fa: true; challenge_token: string }
  | {
      api_key: string;
      user_id: string;
      wallet_created?: boolean;
      passphrase?: string;
      encryption_method_required?: boolean;
      stellar_address?: string | null;
      refresh_token?: string;
      refresh_token_expires_at?: string;
    };

export interface Verify2faParams {
  challenge_token: string;
  code: string;
  ip: string;
  issueRefreshToken?: boolean;
}

export interface Verify2faResult {
  api_key: string;
  user_id: string;
  wallet_created?: boolean;
  passphrase?: string;
  encryption_method_required?: boolean;
  stellar_address?: string | null;
  refresh_token?: string;
  refresh_token_expires_at?: string;
}

export interface RequestAdminMfaChallengeResult {
  challenge_token: string;
  method: "totp" | "sms" | "email";
}

export interface IssueAdminKeyParams {
  actorUserId: string;
  challengeToken: string;
  code: string;
  permissions: string[];
  reason: string;
}

export interface IssueBreakGlassKeyParams {
  actorUserId: string;
  challengeToken: string;
  code: string;
  permissions: string[];
  reason: string;
  ttlMinutes?: number;
}

export interface IssuePrivilegedKeyResult {
  api_key: string;
  user_id: string;
  key_type: "ADMIN_KEY" | "BREAK_GLASS_KEY";
  expires_at?: string;
}

export interface RevokePrivilegedKeyParams {
  actorUserId: string;
  keyId: string;
  reason: string;
}

const OTP_EXPIRY_MINUTES = 10;
const ADMIN_TIER = "enterprise";
const BREAK_GLASS_DEFAULT_TTL_MINUTES = 15;
const BREAK_GLASS_MAX_TTL_MINUTES = 60;
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const ADMIN_SCOPES = [
  "p2p:admin",
  "sme:admin",
  "gateway:admin",
  "enterprise:admin",
] as const;

function normalizeIdentifier(s: string): {
  kind: "username" | "email" | "phone";
  value: string;
} {
  const trimmed = (s || "").trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("@")) {
    return { kind: "username", value: lower.slice(1).replace(/\s/g, "") };
  }
  if (trimmed.startsWith("+") && /^\+[0-9]{10,15}$/.test(trimmed)) {
    return { kind: "phone", value: trimmed };
  }
  if (trimmed.includes("@") && trimmed.includes(".")) {
    return { kind: "email", value: lower };
  }
  return { kind: "username", value: lower.replace(/\s/g, "") };
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isAdminTierUser(tier: string | null | undefined): boolean {
  return tier === ADMIN_TIER;
}

function validateAdminScopes(scopes: string[]): PermissionScope[] {
  const parsed = PermissionsArraySchema.safeParse(scopes);
  if (!parsed.success) {
    const invalid = parsed.error.errors.map((e) => e.message).join(", ");
    throw new ValidationError(`Invalid permission scope(s): ${invalid}`);
  }
  const adminOnly = parsed.data.filter((s) =>
    (ADMIN_SCOPES as readonly string[]).includes(s),
  );
  if (adminOnly.length === 0) {
    throw new AdminScopeRequiredError();
  }
  return adminOnly as PermissionScope[];
}

async function publishOtp(channel: "sms" | "email", to: string, code: string) {
  const ch = getRabbitMQChannel();
  await ch.assertQueue(QUEUES.OTP_SEND, { durable: true });
  ch.sendToQueue(
    QUEUES.OTP_SEND,
    Buffer.from(JSON.stringify({ channel, to, code })),
    {
      persistent: true,
    },
  );
}

async function verifyMfaChallengeForUser(
  userId: string,
  challengeToken: string,
  code: string,
): Promise<"totp" | "sms" | "email"> {
  const payload = verifyChallengeToken(challengeToken);
  if (payload.userId !== userId) {
    throw new InvalidOrExpiredChallengeError();
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, twoFaMethod: true, totpSecretEncrypted: true },
  });
  if (!user || !user.twoFaMethod) {
    throw new TwoFactorRequiredForAdminError();
  }

  if (user.twoFaMethod === "totp") {
    if (!user.totpSecretEncrypted) {
      throw new TotpNotConfiguredError();
    }
    const valid = totp.check(code, user.totpSecretEncrypted);
    if (!valid) {
      throw new InvalidCodeError();
    }
    return "totp";
  }

  if (user.twoFaMethod === "sms" || user.twoFaMethod === "email") {
    const now = new Date();
    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        userId,
        channel: user.twoFaMethod,
        expiresAt: { gt: now },
        usedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) {
      throw new InvalidOrExpiredCodeError();
    }
    const match = await bcrypt.compare(code, challenge.codeHash);
    if (!match) {
      throw new InvalidCodeError();
    }
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { usedAt: now },
    });
    return user.twoFaMethod;
  }

  throw new UnsupportedTwoFactorMethodError();
}

/**
 * Resolve identifier to user (username, email, or E.164 phone).
 */
export async function resolveUserByIdentifier(identifier: string) {
  const { kind, value } = normalizeIdentifier(identifier);
  const where =
    kind === "username"
      ? { username: value }
      : kind === "phone"
        ? { phoneE164: value }
        : { email: value };
  const user = await prisma.user.findFirst({
    where,
    select: {
      id: true,
      passcodeHash: true,
      twoFaMethod: true,
      failedSigninAttempts: true,
      lockoutUntil: true,
    },
  });

  if (!user) {
    return {
      id: "dummy-id",
      passcodeHash: DUMMY_HASH,
      twoFaMethod: null,
      isDummy: true,
    };
  }

  return { ...user, isDummy: false };
}

/**
 * Simple account creation: username + passcode. No email. Stellar wallet is created on first signin.
 */
export async function signup(params: SignupParams): Promise<SignupResult> {
  const username = (params.username || "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "");
  if (!username || username.length > 64) {
    throw new ValidationError("Username is required and must be at most 64 characters");
  }
  if (
    !params.passcode ||
    params.passcode.length < 8 ||
    params.passcode.length > 64
  ) {
    throw new ValidationError("Passcode must be 8–64 characters");
  }
  const existing = await prisma.user.findFirst({
    where: { username },
    select: { id: true },
  });
  if (existing) {
    throw new UsernameTakenError();
  }
  const passcodeHash = await bcrypt.hash(params.passcode, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passcodeHash,
    },
    select: { id: true, actorType: true, organizationId: true },
  });
  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "signup",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "USER_KEY",
    organizationId: user.organizationId ?? undefined,
  });
  logger.info("Signup: user created", { userId: user.id, username });
  return {
    user_id: user.id,
    message: "Account created. Sign in with your username and passcode.",
  };
}

/**
 * Signin: verify identifier + passcode. If 2FA on, return challenge_token (and send OTP via RabbitMQ when sms/email); else issue api_key.
 */
export async function signin(params: SigninParams): Promise<SigninResult> {
  const { identifier, passcode, ip, captchaToken } = params;

  // 1. Check brute force status
  const status = await authBruteGuard.getStatus(identifier, ip);
  if (status.locked) {
    throw new TooManyAttemptsError();
  }
  if (status.requiresCaptcha && !captchaToken) {
    throw new CaptchaRequiredError();
  }

  // TODO: Verify captchaToken here if provided

  const user = await resolveUserByIdentifier(identifier);

  if (user?.lockoutUntil && user.lockoutUntil > new Date()) {
    logger.warn("Signin: account locked", { userId: user.id });
    throw new TooManyAttemptsError();
  }

  if (!user || !user.passcodeHash) {
    logger.warn("Signin: user not found or no passcode", {
      identifier:
        identifier.includes("@") && identifier.includes(".")
          ? "***"
          : identifier.slice(0, 6) + "***",
    });
    throw new InvalidCredentialsError();
  }

  const match = await bcrypt.compare(passcode, user.passcodeHash);
  if (!match) {
    const failedAttempts = user.failedSigninAttempts + 1;
    const isLockout = failedAttempts >= config.maxSigninAttempts;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedSigninAttempts: failedAttempts,
        lockoutUntil: isLockout
          ? new Date(Date.now() + config.signinLockoutDurationMs)
          : null,
      },
    });

    logger.warn("Signin: invalid passcode", {
      userId: user.id,
      failedAttempts,
      isLockout,
    });
    throw new InvalidCredentialsError();
  }

  // Success: reset failed attempts
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedSigninAttempts: 0,
      lockoutUntil: null,
    },
  });

  if (user.twoFaMethod) {
    if (user.twoFaMethod === "sms" || user.twoFaMethod === "email") {
      const u = await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true, phoneE164: true },
      });
      const to = user.twoFaMethod === "email" ? u?.email : u?.phoneE164;
      if (!to) throw new TwoFactorChannelNotConfiguredError();
      const code = generateOtpCode();
      const codeHash = await bcrypt.hash(code, 10);
      await prisma.otpChallenge.create({
        data: {
          userId: user.id,
          codeHash,
          channel: user.twoFaMethod,
          expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        },
      });

      try {
        await publishOtp(user.twoFaMethod, to, code);
        logger.debug("OTP published to queue", {
          channel: user.twoFaMethod,
          to: to ? "***" : undefined,
        });
      } catch (err) {
        logger.error("Skipping OTP send due to RabbitMQ error", err);
      }
    }
    const challenge_token = signChallengeToken(user.id);
    await logAudit({
      eventType: "auth",
      entityType: "user",
      entityId: user.id,
      action: "signin_2fa_required",
      performedBy: user.id,
      actorType: user.actorType,
      keyType: "USER_KEY",
      organizationId: user.organizationId ?? undefined,
    });
    logger.info("Signin: 2FA required", {
      userId: user.id,
      method: user.twoFaMethod,
    });
    return { requires_2fa: true, challenge_token };
  }

  const api_key = await generateApiKey(user.id, [], { keyType: "USER_KEY" });
  const wallet = await ensureWalletForUser(user.id);
  const userFull = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stellarAddress: true },
  });

  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "signin_success",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "USER_KEY",
    organizationId: user.organizationId ?? undefined,
  });
  logger.info("Signin: success, API key issued", { userId: user.id });
  const out: {
    api_key: string;
    user_id: string;
    wallet_created?: boolean;
    passphrase?: string;
    encryption_method_required?: boolean;
    stellar_address?: string | null;
    refresh_token?: string;
    refresh_token_expires_at?: string;
  } = { api_key, user_id: user.id, stellar_address: userFull?.stellarAddress };
  if (wallet.wallet_created && wallet.passphrase) {
    out.wallet_created = true;
    out.passphrase = wallet.passphrase;
    out.encryption_method_required = true;
  }

  if (params.issueRefreshToken) {
    const refreshToken = await issueRefreshToken({ userId: user.id });
    out.refresh_token = refreshToken.refresh_token;
    out.refresh_token_expires_at = refreshToken.expires_at;
  }

  return out;
}

/**
 * Verify 2FA and issue api_key. challenge_token is JWT; code is TOTP or OTP.
 */
export async function verify2fa(
  params: Verify2faParams,
): Promise<Verify2faResult> {
  const { challenge_token, code, ip } = params;
  const payload = verifyChallengeToken(challenge_token);

  // Check brute force for 2FA
  const status = await authBruteGuard.getStatus(payload.userId, ip);
  if (status.locked) {
    throw new TooManyAttemptsError();
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      twoFaMethod: true,
      totpSecretEncrypted: true,
      lockoutUntil: true,
      failedSigninAttempts: true,
    },
  });
  if (!user || !user.twoFaMethod) throw new InvalidCredentialsError();

  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    logger.warn("Verify2FA: account locked", { userId: user.id });
    throw new TooManyAttemptsError();
  }

  const handleFailure = async () => {
    const failedAttempts = user.failedSigninAttempts + 1;
    const isLockout = failedAttempts >= config.maxSigninAttempts;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedSigninAttempts: failedAttempts,
        lockoutUntil: isLockout
          ? new Date(Date.now() + config.signinLockoutDurationMs)
          : null,
      },
    });
  };

  if (user.twoFaMethod === "totp") {
    if (!user.totpSecretEncrypted) throw new TotpNotConfiguredError();
    const valid = totp.check(code, user.totpSecretEncrypted);
    if (!valid) {
      logger.warn("Verify2FA: invalid TOTP", { userId: user.id });
      await handleFailure();
      throw new InvalidCodeError();
    }
  } else if (user.twoFaMethod === "sms" || user.twoFaMethod === "email") {
    const now = new Date();
    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        userId: user.id,
        channel: user.twoFaMethod,
        expiresAt: { gt: now },
        usedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) throw new InvalidOrExpiredCodeError();
    const match = await bcrypt.compare(code, challenge.codeHash);
    if (!match) {
      logger.warn("Verify2FA: invalid OTP", { userId: user.id });
      await handleFailure();
      throw new InvalidCodeError();
    }
  }

  // Success: reset failed attempts
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedSigninAttempts: 0,
      lockoutUntil: null,
    },
  });

  const api_key = await generateApiKey(user.id, []);
  const wallet = await ensureWalletForUser(user.id);
  const userFull = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stellarAddress: true },
  });

  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "verify_2fa_success",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "USER_KEY",
    organizationId: user.organizationId ?? undefined,
  });
  logger.info("Verify2FA: success, API key issued", { userId: user.id });
  const out: {
    api_key: string;
    user_id: string;
    wallet_created?: boolean;
    passphrase?: string;
    encryption_method_required?: boolean;
    stellar_address?: string | null;
    refresh_token?: string;
    refresh_token_expires_at?: string;
  } = { api_key, user_id: user.id, stellar_address: userFull?.stellarAddress };
  if (wallet.wallet_created && wallet.passphrase) {
    out.wallet_created = true;
    out.passphrase = wallet.passphrase;
    out.encryption_method_required = true;
  }

  if (params.issueRefreshToken) {
    const refreshToken = await issueRefreshToken({ userId: user.id });
    out.refresh_token = refreshToken.refresh_token;
    out.refresh_token_expires_at = refreshToken.expires_at;
  }

  return out;
}

/**
 * Generate a short-lived challenge for admin key lifecycle operations.
 */
export async function requestAdminMfaChallenge(
  actorUserId: string,
): Promise<RequestAdminMfaChallengeResult> {
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      tier: true,
      twoFaMethod: true,
      email: true,
      phoneE164: true,
      actorType: true,
      organizationId: true,
    },
  });
  if (!user || !isAdminTierUser(user.tier)) {
    throw new AdminTierAccessRequiredError();
  }
  if (!user.organizationId) {
    throw new OrganizationContextRequiredError();
  }
  if (!user.twoFaMethod) {
    throw new TwoFactorRequiredForAdminError();
  }

  if (user.twoFaMethod === "sms" || user.twoFaMethod === "email") {
    const to = user.twoFaMethod === "email" ? user.email : user.phoneE164;
    if (!to) {
      throw new TwoFactorChannelNotConfiguredError();
    }
    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    await prisma.otpChallenge.create({
      data: {
        userId: user.id,
        codeHash,
        channel: user.twoFaMethod,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    });
    await publishOtp(user.twoFaMethod, to, code);
  }

  const challenge_token = signChallengeToken(user.id);
  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "admin_mfa_challenge_issued",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "USER_KEY",
    organizationId: user.organizationId,
  });

  return {
    challenge_token,
    method: user.twoFaMethod as "totp" | "sms" | "email",
  };
}

export async function issueAdminKey(
  params: IssueAdminKeyParams,
): Promise<IssuePrivilegedKeyResult> {
  const user = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { id: true, tier: true, actorType: true, organizationId: true },
  });
  if (!user || !isAdminTierUser(user.tier)) {
    throw new AdminTierAccessRequiredError();
  }
  if (!user.organizationId) {
    throw new OrganizationContextRequiredError();
  }

  const reason = params.reason.trim();
  if (!reason) {
    throw new ReasonRequiredError();
  }

  const permissions = validateAdminScopes(params.permissions);

  await verifyMfaChallengeForUser(user.id, params.challengeToken, params.code);

  const apiKey = await generateApiKey(user.id, permissions, {
    keyType: "ADMIN_KEY",
    organizationId: user.organizationId,
    createdByUserId: user.id,
  });

  await logAudit({
    eventType: "auth",
    entityType: "api_key",
    action: "admin_key_issued",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "ADMIN_KEY",
    organizationId: user.organizationId,
    reason,
    newValue: { permissions },
  });

  return {
    api_key: apiKey,
    user_id: user.id,
    key_type: "ADMIN_KEY",
  };
}

export async function issueBreakGlassKey(
  params: IssueBreakGlassKeyParams,
): Promise<IssuePrivilegedKeyResult> {
  const user = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { id: true, tier: true, actorType: true, organizationId: true },
  });
  if (!user || !isAdminTierUser(user.tier)) {
    throw new AdminTierAccessRequiredError();
  }
  if (!user.organizationId) {
    throw new OrganizationContextRequiredError();
  }

  const reason = params.reason.trim();
  if (!reason) {
    throw new ReasonRequiredError();
  }

  const ttlMinutes = params.ttlMinutes ?? BREAK_GLASS_DEFAULT_TTL_MINUTES;
  if (ttlMinutes < 1 || ttlMinutes > BREAK_GLASS_MAX_TTL_MINUTES) {
    throw new BreakGlassTtlError();
  }

  const permissions =
    params.permissions.length > 0
      ? validateAdminScopes(params.permissions)
      : [...ADMIN_SCOPES];

  await verifyMfaChallengeForUser(user.id, params.challengeToken, params.code);

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const apiKey = await generateApiKey(user.id, permissions, {
    keyType: "BREAK_GLASS_KEY",
    organizationId: user.organizationId,
    createdByUserId: user.id,
    expiresAt,
    emergencyReason: reason,
    emergencyExpiresAt: expiresAt,
  });

  await logAudit({
    eventType: "auth",
    entityType: "api_key",
    action: "break_glass_key_issued",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "BREAK_GLASS_KEY",
    organizationId: user.organizationId,
    reason,
    newValue: { permissions, expiresAt: expiresAt.toISOString() },
  });

  return {
    api_key: apiKey,
    user_id: user.id,
    key_type: "BREAK_GLASS_KEY",
    expires_at: expiresAt.toISOString(),
  };
}

export async function listPrivilegedKeys(actorUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, tier: true },
  });
  if (!user || !isAdminTierUser(user.tier)) {
    throw new AdminTierAccessRequiredError();
  }

  const keys = await prisma.apiKey.findMany({
    where: {
      userId: actorUserId,
      keyType: { in: ["ADMIN_KEY", "BREAK_GLASS_KEY"] },
    },
    select: {
      id: true,
      keyType: true,
      permissions: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      emergencyReason: true,
      emergencyExpiresAt: true,
      lastUsedAt: true,
      createdByUserId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return keys;
}

export async function revokePrivilegedKey(
  params: RevokePrivilegedKeyParams,
): Promise<{ ok: true }> {
  const user = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { id: true, tier: true, actorType: true, organizationId: true },
  });
  if (!user || !isAdminTierUser(user.tier)) {
    throw new AdminTierAccessRequiredError();
  }

  const reason = params.reason.trim();
  if (!reason) {
    throw new ReasonRequiredError();
  }

  const targetKey = await prisma.apiKey.findFirst({
    where: {
      id: params.keyId,
      userId: user.id,
      keyType: { in: ["ADMIN_KEY", "BREAK_GLASS_KEY"] },
      revokedAt: null,
    },
    select: { id: true, keyType: true },
  });
  if (!targetKey) {
    throw new PrivilegedKeyNotFoundError();
  }

  await prisma.apiKey.update({
    where: { id: targetKey.id },
    data: { revokedAt: new Date() },
  });

  await logAudit({
    eventType: "auth",
    entityType: "api_key",
    entityId: targetKey.id,
    action: "privileged_key_revoked",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: targetKey.keyType,
    organizationId: user.organizationId ?? undefined,
    reason,
  });

  return { ok: true };
}

export interface IssueRefreshTokenParams {
  userId: string;
}

export interface IssueRefreshTokenResult {
  refresh_token: string;
  expires_at: string;
}

export interface RefreshAccessTokenParams {
  refresh_token: string;
}

export interface RefreshAccessTokenResult {
  api_key: string;
  refresh_token: string;
  user_id: string;
  expires_at: string;
}

export interface RevokeRefreshTokenParams {
  refresh_token: string;
}

function generateSecureRefreshToken(): string {
  const bytes = Buffer.from(randomUUID()).toString('base64');
  return bytes + Buffer.from(randomUUID()).toString('base64');
}

async function hashRefreshToken(token: string): Promise<string> {
  return bcrypt.hash(token, 12);
}

/**
 * Issue a new refresh token with a new token family.
 * This is called during initial authentication.
 */
export async function issueRefreshToken(
  params: IssueRefreshTokenParams,
): Promise<IssueRefreshTokenResult> {
  const { userId } = params;
  const token = generateSecureRefreshToken();
  const tokenHash = await hashRefreshToken(token);
  const tokenFamilyId = randomUUID();
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenFamilyId,
      tokenHash,
      expiresAt,
    },
  });

  await logAudit({
    eventType: "auth",
    entityType: "refresh_token",
    action: "refresh_token_issued",
    performedBy: userId,
    actorType: "user",
    keyType: "USER_KEY",
    newValue: { tokenFamilyId },
  });

  logger.info("Refresh token issued", { userId, tokenFamilyId });

  return {
    refresh_token: token,
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * Validate a refresh token and rotate it (token-family rotation).
 * When a refresh token is used, the entire family should be invalidated
 * to detect token theft. A new token in a new family is issued.
 */
export async function refreshAccessToken(
  params: RefreshAccessTokenParams,
): Promise<RefreshAccessTokenResult> {
  const { refresh_token } = params;

  const tokenHash = await hashRefreshToken(refresh_token);
  const now = new Date();

  const existingToken = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: {
      user: {
        select: {
          id: true,
          actorType: true,
          organizationId: true,
        },
      },
    },
  });

  if (!existingToken) {
    throw new InvalidOrExpiredRefreshTokenError();
  }

  const { user, tokenFamilyId } = existingToken;

  // Token-family rotation: invalidate all tokens in the same family
  // This detects token theft - if an attacker tries to use an old token,
  // the family will already be revoked
  await prisma.refreshToken.updateMany({
    where: {
      tokenFamilyId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      replacedByToken: tokenHash,
    },
  });

  // Issue a new API key
  const api_key = await generateApiKey(user.id, [], { keyType: "USER_KEY" });

  // Issue a new refresh token in a NEW family
  const newToken = generateSecureRefreshToken();
  const newTokenHash = await hashRefreshToken(newToken);
  const newTokenFamilyId = randomUUID();
  const newExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenFamilyId: newTokenFamilyId,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
    },
  });

  await logAudit({
    eventType: "auth",
    entityType: "refresh_token",
    entityId: existingToken.id,
    action: "refresh_token_rotated",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "USER_KEY",
    organizationId: user.organizationId ?? undefined,
    oldValue: { oldTokenFamilyId: tokenFamilyId },
    newValue: { newTokenFamilyId },
  });

  logger.info("Refresh token rotated", {
    userId: user.id,
    oldTokenFamilyId: tokenFamilyId,
    newTokenFamilyId,
  });

  return {
    api_key,
    refresh_token: newToken,
    user_id: user.id,
    expires_at: newExpiresAt.toISOString(),
  };
}

/**
 * Revoke a refresh token and its entire family.
 */
export async function revokeRefreshToken(
  params: RevokeRefreshTokenParams,
): Promise<{ ok: true }> {
  const { refresh_token } = params;

  const tokenHash = await hashRefreshToken(refresh_token);
  const now = new Date();

  const existingToken = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
    },
    include: {
      user: {
        select: {
          id: true,
          actorType: true,
          organizationId: true,
        },
      },
    },
  });

  if (!existingToken) {
    throw new InvalidRefreshTokenError();
  }

  const { user, tokenFamilyId } = existingToken;

  // Revoke all tokens in the family
  await prisma.refreshToken.updateMany({
    where: {
      tokenFamilyId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });

  await logAudit({
    eventType: "auth",
    entityType: "refresh_token",
    entityId: existingToken.id,
    action: "refresh_token_revoked",
    performedBy: user.id,
    actorType: user.actorType,
    keyType: "USER_KEY",
    organizationId: user.organizationId ?? undefined,
  });

  logger.info("Refresh token family revoked", {
    userId: user.id,
    tokenFamilyId,
  });

  return { ok: true };
}
