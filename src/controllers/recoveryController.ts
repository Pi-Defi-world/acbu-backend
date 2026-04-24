import { Response, NextFunction } from "express";
import { z } from "zod";
import { Request } from "express";
import {
  unlockApp,
  verifyRecoveryOtp,
} from "../services/recovery/recoveryService";
import { AppError } from "../middleware/errorHandler";
import { DeviceFingerprint } from "../services/recovery/deviceVerification";

const unlockAppSchema = z.object({
  identifier: z.string().min(1, "identifier is required"),
  passcode: z.string().min(1, "passcode is required"),
  device_fingerprint: z.object({
    user_agent: z.string().optional(),
    ip: z.string().optional(),
    accept_language: z.string().optional(),
    accept_encoding: z.string().optional(),
    timezone: z.string().optional(),
    screen_resolution: z.string().optional(),
    platform: z.string().optional(),
  }).optional(),
});

const verifyRecoveryOtpSchema = z.object({
  challenge_token: z.string().min(1, "challenge_token is required"),
  code: z.string().min(1, "code is required"),
  device_fingerprint: z.object({
    user_agent: z.string().optional(),
    ip: z.string().optional(),
    accept_language: z.string().optional(),
    accept_encoding: z.string().optional(),
    timezone: z.string().optional(),
    screen_resolution: z.string().optional(),
    platform: z.string().optional(),
  }).optional(),
  trust_device: z.boolean().optional(),
});

/**
 * POST /recovery/unlock
 * Body: { identifier: string (email or E.164 phone), passcode: string }
 * Returns { challenge_token, channel }.
 */
export async function postUnlock(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = unlockAppSchema.parse(req.body);
    // Extract device fingerprint from request headers and body
    const deviceFingerprint: DeviceFingerprint = {
      userAgent: req.headers['user-agent'] as string || 'unknown',
      ip: req.ip || req.connection.remoteAddress || '0.0.0.0',
      acceptLanguage: req.headers['accept-language'] as string,
      acceptEncoding: req.headers['accept-encoding'] as string,
      platform: req.headers['sec-ch-ua-platform'] as string,
      ...body.device_fingerprint,
    };

    const result = await unlockApp({
      identifier: body.identifier.trim(),
      passcode: body.passcode,
      deviceFingerprint,
    });
    res.status(200).json({
      challenge_token: result.challenge_token,
      channel: result.channel,
      requires_device_verification: result.requires_device_verification,
      device_id: result.device_id,
      rate_limit_info: result.rate_limit_info,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (e instanceof Error) {
      if (e.message === "User not found or recovery not enabled")
        return next(new AppError(e.message, 404));
      if (e.message === "Invalid passcode")
        return next(new AppError(e.message, 401));
      if (e.message.includes("identifier"))
        return next(new AppError(e.message, 400));
      if (e.message === "Recovery channel not configured")
        return next(new AppError(e.message, 400));
      if (e.message === "OTP delivery unavailable")
        return next(new AppError(e.message, 503));
      if (e.message.includes("Rate limit exceeded"))
        return next(new AppError(e.message, 429));
      if (e.message.includes("Too many attempts"))
        return next(new AppError(e.message, 429));
    }
    next(e);
  }
}

/**
 * POST /recovery/unlock/verify
 * Body: { challenge_token: string, code: string }
 * Returns { api_key, user_id }.
 */
export async function postUnlockVerify(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = verifyRecoveryOtpSchema.parse(req.body);
    // Extract device fingerprint from request headers and body
    const deviceFingerprint: DeviceFingerprint | undefined = body.device_fingerprint ? {
      userAgent: req.headers['user-agent'] as string || 'unknown',
      ip: req.ip || req.connection.remoteAddress || '0.0.0.0',
      acceptLanguage: req.headers['accept-language'] as string,
      acceptEncoding: req.headers['accept-encoding'] as string,
      platform: req.headers['sec-ch-ua-platform'] as string,
      ...body.device_fingerprint,
    } : undefined;

    const result = await verifyRecoveryOtp({
      challenge_token: body.challenge_token,
      code: body.code,
      deviceFingerprint,
      trust_device: body.trust_device,
    });
    res.status(200).json({
      api_key: result.api_key,
      user_id: result.user_id,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (e instanceof Error) {
      if (
        e.message === "Invalid or expired code" ||
        e.message === "Invalid code"
      )
        return next(new AppError(e.message, 401));
      if (e.message === "Invalid or expired challenge")
        return next(new AppError(e.message, 401));
    }
    next(e);
  }
}
