import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import {
  issueAdminKey,
  issueBreakGlassKey,
  listPrivilegedKeys,
  requestAdminMfaChallenge,
  revokePrivilegedKey,
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
});

export const signupSchema = z.object({
  username: z.string().min(1, "username is required").max(64),
  passcode: z.string().min(4, "passcode must be at least 4 characters").max(64),
});

export const verify2faSchema = z.object({
  challenge_token: z.string().min(1, "challenge_token is required"),
  code: z.string().min(1, "code is required"),
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
    if (e instanceof Error) {
      if (e.message === "Username already taken")
        return next(new AppError(e.message, 409));
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
      ip: req.ip || req.socket.remoteAddress || "unknown",
      captchaToken: body.captcha_token,
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
    res.status(200).json(payload);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (e instanceof Error) {
      if (
        e.message === "Invalid credentials" ||
        e.message === "Too many attempts. Please try again later." ||
        e.message === "CAPTCHA required"
      ) {
        const statusCode = e.message === "Invalid credentials" ? 401 : 403;
        return next(new AppError(e.message, statusCode));
      }
      if (e.message === "2FA channel not configured")
        return next(new AppError(e.message, 400));
      if (e.message === "OTP delivery unavailable")
        return next(new AppError(e.message, 503));
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
    res.status(200).json({ ok: true });
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
      ip: req.ip || req.socket.remoteAddress || "unknown",
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
    res.status(200).json(payload);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (e instanceof Error) {
      if (
        e.message === "Invalid credentials" ||
        e.message === "Too many attempts. Please try again later."
      ) {
        const statusCode = e.message === "Invalid credentials" ? 401 : 403;
        return next(new AppError(e.message, statusCode));
      }
      if (e.message === "Invalid or expired challenge")
        return next(new AppError(e.message, 401));
      if (
        e.message === "Invalid code" ||
        e.message === "Invalid or expired code"
      )
        return next(new AppError(e.message, 401));
      if (
        e.message === "TOTP not configured" ||
        e.message === "Unsupported 2FA method"
      )
        return next(new AppError(e.message, 400));
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
    if (e instanceof Error) {
      if (e.message === "Admin-tier access required") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "Organization context required for admin-tier users") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "2FA required for admin-tier users") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "2FA channel not configured") {
        return next(new AppError(e.message, 400));
      }
    }
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
    if (e instanceof Error) {
      if (e.message === "Admin-tier access required") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "Organization context required for admin-tier users") {
        return next(new AppError(e.message, 403));
      }
      if (
        e.message === "Invalid code" ||
        e.message === "Invalid or expired code" ||
        e.message === "Invalid or expired challenge"
      ) {
        return next(new AppError(e.message, 401));
      }
      if (
        e.message === "Reason is required" ||
        e.message === "At least one admin scope is required" ||
        e.message === "Unsupported 2FA method" ||
        e.message === "TOTP not configured"
      ) {
        return next(new AppError(e.message, 400));
      }
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
    if (e instanceof Error) {
      if (e.message === "Admin-tier access required") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "Organization context required for admin-tier users") {
        return next(new AppError(e.message, 403));
      }
      if (
        e.message === "Invalid code" ||
        e.message === "Invalid or expired code" ||
        e.message === "Invalid or expired challenge"
      ) {
        return next(new AppError(e.message, 401));
      }
      if (
        e.message === "Reason is required" ||
        e.message === "At least one admin scope is required" ||
        e.message.startsWith("Break-glass TTL") ||
        e.message === "Unsupported 2FA method" ||
        e.message === "TOTP not configured"
      ) {
        return next(new AppError(e.message, 400));
      }
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
    if (
      e instanceof Error &&
      (e.message === "Admin-tier access required" ||
        e.message === "Organization context required for admin-tier users")
    ) {
      return next(new AppError(e.message, 403));
    }
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
    if (e instanceof Error) {
      if (e.message === "Admin-tier access required") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "Organization context required for admin-tier users") {
        return next(new AppError(e.message, 403));
      }
      if (e.message === "Privileged key not found") {
        return next(new AppError(e.message, 404));
      }
      if (e.message === "Reason is required") {
        return next(new AppError(e.message, 400));
      }
    }
    next(e);
  }
}
