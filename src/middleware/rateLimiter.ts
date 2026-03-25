import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config/env";
import { AuthRequest } from "./auth";
import { cacheService } from "../utils/cache";

/**
 * Create rate limiter based on API key or IP
 */
export const createRateLimiter = (windowMs: number, maxRequests: number) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please try again later.",
        },
      });
    },
  });
};

/**
 * Rate limiter for API key-based requests
 */
export const apiKeyRateLimiter = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.apiKey) {
    return next();
  }

  const now = Date.now();
  const windowMs = config.rateLimitWindowMs;
  const maxRequests = req.apiKey.rateLimit || config.rateLimitMaxRequests;

  // Use window ID in key to ensure atomicity without complex reset logic
  const windowId = Math.floor(now / windowMs);
  const cacheKey = `rate_limit:api_key:${req.apiKey.id}:${windowId}`;

  const cached = await cacheService.increment<{ count: number }>(
    cacheKey,
    "count",
    1,
    {
      ttl: windowMs / 1000,
    },
  );

  if (cached && cached.count > maxRequests) {
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "API key rate limit exceeded",
      },
    });
    return;
  }

  next();
};

/**
 * Standard rate limiter for general endpoints
 */
export const standardRateLimiter = createRateLimiter(
  config.rateLimitWindowMs,
  config.rateLimitMaxRequests,
);
