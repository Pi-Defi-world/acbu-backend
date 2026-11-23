import { Request, Response, NextFunction } from "express";
import { verifyCaptcha } from "../services/auth/authService";
import { CaptchaRequiredError } from "../errors";
import { config } from "../config/env";

export function extractCaptchaToken(req: Request): string | undefined {
  const t = req.body?.captcha_token ?? req.body?.captchaToken ?? req.get("x-captcha-token");
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

/**
 * W11-CAR-025: verify CAPTCHA tokens server-side (Cloudflare Turnstile).
 * Mode comes from CAPTCHA_ENFORCEMENT:
 *   off      - skip verification entirely
 *   optional - a supplied token is always verified; a missing token is allowed
 *   strict   - a valid token is required
 */
export function requireCaptcha() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const mode = config.auth.captchaEnforcement;
      if (mode === "off") return next();
      const token = extractCaptchaToken(req);
      if (!token) {
        if (mode === "optional") return next();
        throw new CaptchaRequiredError();
      }
      if (!(await verifyCaptcha(token, req.ip))) throw new CaptchaRequiredError();
      next();
    } catch (err) {
      next(err);
    }
  };
}
