import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import {
  issueAdminKey,
  issueBreakGlassKey,
  issueRefreshToken,
  listPrivilegedKeys,
  refreshAccessToken,
  requestAdminMfaChallenge,
  revokePrivilegedKey,
  revokeRefreshToken,
  signin,
  signup,
  verify2fa,
} from "../services/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";

export const signinSchema = z.object({
  identifier: z.string().min(1, "identifier is required"),
  passcode: z.string().min(1, "passcode is required"),
  captcha_token: z.string().optional(),
  issue_refresh_token: z.boolean().optional(),
});

export const signupSchema = z.object({
  username: z.string().min(1, "username is required").max(64),
  passcode: z.string().min(8, "passcode must be at least 8 characters").max(64),
});

export const verify2faSchema = z.object({
  challenge_token: z.string().min(1, "challenge_token is required"),
  code: z.string().min(1, "code is required"),
  issue_refresh_token: z.boolean().optional(),
});

const issueAdminKeySchema = z.object({
  challenge_token: z.string().min(1, "challenge_token is required"),
  code: z.string().min(1, "code is required"),
  permissions: z.array(z.string()).min(1, "permissions are required"),
  reason: z.string().min(1, "reason is required").max(255),
});

const issueBreakGlassKeySchema = z.object({
  challenge_token: z.string().min(1, "challenge_token is required"),
  code: z.string().min(1, "code is required"),
  permissions: z.array(z.string()).default([]),
  reason: z.string().min(1, "reason is required").max(255),
  ttl_minutes: z.number().int().min(1).max(60).optional(),
});

const revokePrivilegedKeySchema = z.object({
  reason: z.string().min(1, "reason is required").max(255),
});

const refreshAccessTokenSchema = z.object({
  refresh_token: z.string().min(1, "refresh_token is required"),
});

const revokeRefreshTokenSchema = z.object({
  refresh_token: z.string().min(1, "refresh_token is required"),
});

function getRequestIp(req: AuthRequest): string {
  const connection = (req as AuthRequest & {
    connection?: { remoteAddress?: string | null };
  }).connection;

  return req.ip || req.socket?.remoteAddress || connection?.remoteAddress || "unknown";
}

/**
 * POST /auth/signup
 * Body: { username, passcode }
 * Simple account creation; no email. Returns { user_id, message }.
 */
export async function postSignup(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = signupSchema.parse(req.body);
    const result = await signup({
      username: body.username.trim(),
      passcode: body.passcode,
    });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /auth/signin
 * Body: { identifier (username/email/phone), passcode }
 * Returns { api_key, user_id } or { requires_2fa: true, challenge_token }.
 */
export async function postSignin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = signinSchema.parse(req.body);
    const result = await signin({
      identifier: body.identifier.trim(),
      passcode: body.passcode,
      ip: getRequestIp(req),
      captchaToken: body.captcha_token,
      issueRefreshToken: body.issue_refresh_token,
    });
    if ("requires_2fa" in result) {
      res
        .status(200)
        .json({ requires_2fa: true, challenge_token: result.challenge_token });
      return;
    }
    const payload: Record<string, unknown> = {
      api_key: result.api_key,
      user_id: result.user_id,
      stellar_address: result.stellar_address,
    };
    if (result.wallet_created) payload.wallet_created = true;
    if (result.passphrase) payload.passphrase = result.passphrase;
    if (result.encryption_method_required)
      payload.encryption_method_required = true;
    if (result.refresh_token) payload.refresh_token = result.refresh_token;
    if (result.refresh_token_expires_at)
      payload.refresh_token_expires_at = result.refresh_token_expires_at;
    res.status(200).json(payload);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /auth/signout
 * Revokes the API key used in this request. Requires auth.
 */
export async function postSignout(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const keyId = req.apiKey?.id;
    if (!keyId) return next(new AppError("API key required", 401));
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

/**
 * POST /auth/signin/verify-2fa
 * Body: { challenge_token, code }
 * Returns { api_key, user_id }.
 */
export async function postVerify2fa(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = verify2faSchema.parse(req.body);
    const result = await verify2fa({
      challenge_token: body.challenge_token,
      code: body.code,
      ip: getRequestIp(req),
      issueRefreshToken: body.issue_refresh_token,
    });
    const payload: Record<string, unknown> = {
      api_key: result.api_key,
      user_id: result.user_id,
      stellar_address: result.stellar_address,
    };
    if (result.wallet_created) payload.wallet_created = true;
    if (result.passphrase) payload.passphrase = result.passphrase;
    if (result.encryption_method_required)
      payload.encryption_method_required = true;
    if (result.refresh_token) payload.refresh_token = result.refresh_token;
    if (result.refresh_token_expires_at)
      payload.refresh_token_expires_at = result.refresh_token_expires_at;
    res.status(200).json(payload);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /auth/admin/challenge
 * Creates a short-lived challenge for privileged key operations.
 */
export async function postAdminMfaChallenge(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId;
    if (!actorUserId) {
      return next(new AppError("API key required", 401));
    }
    const result = await requestAdminMfaChallenge(actorUserId);
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

/**
 * POST /auth/keys/admin
 * Issues an admin-scoped API key after MFA challenge verification.
 */
export async function postIssueAdminKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId;
    if (!actorUserId) {
      return next(new AppError("API key required", 401));
    }
    const body = issueAdminKeySchema.parse(req.body);
    const result = await issueAdminKey({
      actorUserId,
      challengeToken: body.challenge_token,
      code: body.code,
      permissions: body.permissions,
      reason: body.reason,
    });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /auth/keys/break-glass
 * Issues a short-lived emergency admin key after MFA challenge verification.
 */
export async function postIssueBreakGlassKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId;
    if (!actorUserId) {
      return next(new AppError("API key required", 401));
    }
    const body = issueBreakGlassKeySchema.parse(req.body);
    const result = await issueBreakGlassKey({
      actorUserId,
      challengeToken: body.challenge_token,
      code: body.code,
      permissions: body.permissions,
      reason: body.reason,
      ttlMinutes: body.ttl_minutes,
    });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * GET /auth/keys/privileged
 * Lists current user's privileged keys (admin + break-glass).
 */
export async function getPrivilegedKeys(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId;
    if (!actorUserId) {
      return next(new AppError("API key required", 401));
    }
    const keys = await listPrivilegedKeys(actorUserId);
    res.status(200).json({ keys });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /auth/keys/:id/revoke
 * Revokes an admin or break-glass key owned by current user.
 */
export async function postRevokePrivilegedKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId;
    if (!actorUserId) {
      return next(new AppError("API key required", 401));
    }
    const keyId = req.params.id;
    if (!keyId) {
      return next(new AppError("key id is required", 400));
    }
    const body = revokePrivilegedKeySchema.parse(req.body);
    const result = await revokePrivilegedKey({
      actorUserId,
      keyId,
      reason: body.reason,
    });
    res.status(200).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /auth/refresh-token
 * Refresh access token using refresh token with family rotation.
 */
export async function postRefreshAccessToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = refreshAccessTokenSchema.parse(req.body);
    const result = await refreshAccessToken({
      refresh_token: body.refresh_token,
    });
    res.status(200).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /auth/refresh-token/revoke
 * Revoke a refresh token and its entire family.
 */
export async function postRevokeRefreshToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = revokeRefreshTokenSchema.parse(req.body);
    const result = await revokeRefreshToken({
      refresh_token: body.refresh_token,
    });
    res.status(200).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}
