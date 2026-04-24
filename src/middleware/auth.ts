import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database";
import bcrypt from "bcryptjs";
import { AppError } from "./errorHandler";
import { logger } from "../config/logger";
import jwt from "jsonwebtoken";

export type Audience = "retail" | "business" | "government";
export type UserTier = "free" | "verified" | "sme" | "enterprise";
export type PermissionScope =
  | "p2p:read"
  | "p2p:write"
  | "p2p:admin"
  | "sme:read"
  | "sme:write"
  | "sme:admin"
  | "gateway:read"
  | "gateway:write"
  | "gateway:admin"
  | "enterprise:read"
  | "enterprise:write"
  | "enterprise:admin";
const API_KEY_PREFIX = "acbu";
const API_KEY_LOOKUP_LENGTH = 12;
const API_KEY_SECRET_LENGTH = 64;
const API_KEY_FORMAT = new RegExp(
  `^${API_KEY_PREFIX}_([a-f0-9]{${API_KEY_LOOKUP_LENGTH}})_([a-f0-9]{${API_KEY_SECRET_LENGTH}})$`,
  "i",
);

export interface AuthRequest extends Request {
  apiKey?: {
    id: string;
    userId: string | null;
    organizationId: string | null;
    permissions: string[];
    rateLimit: number;
  };
  /** Set by audience-specific routes (e.g. /retail, /business, /government) for limits and behaviour. */
  audience?: Audience;
  /** Optional user tier populated by upstream middleware/services for authorization checks. */
  userTier?: UserTier;
}

/**
 * Validate and parse permissions from Prisma JSON field
 * @param permissions - Raw permissions from database (Json type)
 * @returns Array of validated permission strings, or empty array if invalid
 */
function validatePermissions(permissions: unknown): string[] {
  if (!permissions) {
    return [];
  }

  if (Array.isArray(permissions)) {
    return permissions.every((p) => typeof p === "string")
      ? (permissions as string[])
      : [];
  }

  return [];
}

function parseApiKey(
  rawApiKey: string,
): { lookupKey: string; secret: string } | null {
  const match = rawApiKey.trim().match(API_KEY_FORMAT);
  if (!match) {
    return null;
  }

  return {
    lookupKey: match[1].toLowerCase(),
    secret: match[2].toLowerCase(),
  };
}

/**
 * Detect if a string appears to be a JWT token and reject challenge tokens.
 * Challenge tokens CANNOT be used for API access.
 */
function rejectIfJwtToken(token: string): void {
  // JWT tokens have 3 parts separated by dots (header.payload.signature)
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      // Decode without verification to check claims
      const decoded = jwt.decode(token) as Record<string, unknown> | null;
      if (decoded) {
        // Check if this is a challenge token (has 2fa_challenge audience)
        if (decoded.aud === "2fa_challenge" && decoded.iss === "acbu/auth") {
          logger.error("Attempted to use 2FA challenge token for API access");
          throw new AppError(
            "Challenge tokens cannot be used for API access",
            401,
          );
        }
        // Reject any JWT-like token that isn't a standard API key
        logger.warn("Non-API-key JWT token rejected for API access");
        throw new AppError("Invalid credentials format", 401);
      }
    } catch (err) {
      // If jwt.decode fails, it's not a valid JWT, continue with normal validation
      if (err instanceof AppError) throw err;
    }
  }
}

/**
 * Middleware to validate API key
 */
export const validateApiKey = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const apiKey =
      req.headers["x-api-key"] ||
      req.headers["authorization"]?.replace("Bearer ", "");

    if (!apiKey || typeof apiKey !== "string") {
      throw new AppError("API key is required", 401);
    }

    // Reject JWT tokens, especially 2FA challenge tokens
    rejectIfJwtToken(apiKey);

    const parsedApiKey = parseApiKey(apiKey);
    if (!parsedApiKey) {
      throw new AppError("Invalid API key format", 401);
    }

    // Deterministic indexed lookup first.
    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        lookupKey: parsedApiKey.lookupKey,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        user: true,
        organization: true,
      },
    });

    if (!apiKeyRecord) {
      throw new AppError("Invalid API key", 401);
    }

    // Single bcrypt verification.
    const isValid = await bcrypt.compare(
      parsedApiKey.secret,
      apiKeyRecord.keyHash,
    );
    if (!isValid) {
      throw new AppError("Invalid API key", 401);
    }

    // Update lastUsedAt asynchronously (don't block request)
    prisma.apiKey
      .update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((e: any) =>
        logger.error("Failed to update API key lastUsedAt", { e }),
      );

    req.apiKey = {
      id: apiKeyRecord.id,
      userId: apiKeyRecord.userId ?? null,
      organizationId: apiKeyRecord.organizationId ?? null,
      permissions: validatePermissions(apiKeyRecord.permissions),
      rateLimit: apiKeyRecord.rateLimit,
    };

    if (apiKeyRecord.user?.tier) {
      req.userTier = apiKeyRecord.user.tier as UserTier;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Hash API key secret for storage
 */
export async function hashApiKey(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

/**
 * Generate a new API key
 */
export async function generateApiKey(
  userId?: string,
  permissions: string[] = [],
): Promise<string> {
  const crypto = await import("crypto");
  const lookupKey = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(32).toString("hex");
  const apiKey = `${API_KEY_PREFIX}_${lookupKey}_${secret}`;
  const keyHash = await hashApiKey(secret);

  await prisma.apiKey.create({
    data: {
      userId: userId ?? null,
      lookupKey,
      keyHash,
      permissions,
    },
  });

  logger.info("API key generated", {
    userId,
    hasPermissions: permissions.length > 0,
  });
  return apiKey;
}
