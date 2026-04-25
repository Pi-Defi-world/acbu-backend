import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { signin, signup, verify2fa } from "../services/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";

export const signinSchema = z.object({
  identifier: z.string().min(1, "identifier is required"),
  passcode: z.string().min(1, "passcode is required"),
});

export const signupSchema = z.object({
  username: z.string().min(1, "username is required").max(64),
  passcode: z.string().min(4, "passcode must be at least 4 characters").max(64),
});

export const verify2faSchema = z.object({
  challenge_token: z.string().min(1, "challenge_token is required"),
  code: z.string().min(1, "code is required"),
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
      if (e.message === "Invalid credentials")
        return next(new AppError(e.message, 401));
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
