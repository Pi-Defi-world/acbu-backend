import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/database";
import bcrypt from "bcrypt";
import { AppError } from "./errorHandler";
import { logger } from "../config/logger";
import { EXPECTED_JWT_TYP } from "./authMiddleware";
import { requireAdminApiKey } from "./adminAuth";
import { PermissionScopeEnum, PermissionScope } from "../types/permissions";

export type Audience = "retail" | "business" | "government";
export type UserTier = "free" | "verified" | "sme" | "enterprise";
export type ApiKeyType = "USER_KEY" | "ADMIN_KEY" | "BREAK_GLASS_KEY";
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
    keyType: ApiKeyType;
    createdByUserId: string | null;
    emergencyReason: string | null;
    emergencyExpiresAt: Date | null;
    permissions: PermissionScope[];
    rateLimit: number;
  };
  adminId?: string;
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
function validatePermissions(permissions: unknown): PermissionScope[] {
  if (!Array.isArray(permissions)) {
    if (permissions != null) {
      logger.warn("Invalid permissions in API key record (not an array)", {
        raw: permissions,
      });
    }
    return [];
  }
  const valid: PermissionScope[] = [];
  const invalid: unknown[] = [];
  for (const p of permissions) {
    const r = PermissionScopeEnum.safeParse(p);
    if (r.success) valid.push(r.data);
    else invalid.push(p);
  }
  if (invalid.length > 0) {
    logger.warn("Dropped invalid permission scopes from API key record", {
      invalid,
    });
  }
  return valid;
}

function parseApiKey(rawApiKey: string): { lookupKey: string; secret: string } | null {
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
      const decodedComplete = jwt.decode(token, { complete: true });
      if (decodedComplete && typeof decodedComplete !== "string") {
        const typ = decodedComplete.header?.typ;
        if (!typ || typ.trim().toUpperCase() !== EXPECTED_JWT_TYP) {
          logger.warn("Non-JWT typ token rejected for API access", { typ });
          throw new AppError("Invalid credentials format", 401);
        }

        const decoded = decodedComplete.payload as Record<string, unknown>;
        // Check if this is a challenge token (has 2fa_challenge audience)
        if (decoded.aud === "2fa_challenge" && decoded.iss === "acbu/auth") {
          logger.error("Attempted to use 2FA challenge token for API access");
          throw new AppError("Challenge tokens cannot be used for API access", 401);
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
    const apiKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");

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
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          {
            OR: [
              { keyType: { not: "BREAK_GLASS_KEY" } },
              { emergencyExpiresAt: { gt: new Date() } },
            ],
          },
        ],
      },
      include: {
        user: true,
        organization: true,
      },
    });

    if (!apiKeyRecord) {
      throw new AppError("Invalid API key", 401);
    }

    // Reject API keys whose associated user is disabled or deleted
    if (apiKeyRecord.userId && apiKeyRecord.user) {
      if (apiKeyRecord.user.deletedAt !== null) {
        logger.warn("API key validation rejected: user account deleted", {
          userId: apiKeyRecord.userId,
          apiKeyId: apiKeyRecord.id,
        });
        throw new AppError("Invalid API key", 401);
      }
      if ((apiKeyRecord.user as any).isDisabled === true) {
        logger.warn("API key validation rejected: user account disabled", {
          userId: apiKeyRecord.userId,
          apiKeyId: apiKeyRecord.id,
        });
        throw new AppError("Invalid API key", 401);
      }
    }

    // Single bcrypt verification.
    const isValid = await bcrypt.compare(parsedApiKey.secret, apiKeyRecord.keyHash);
    if (!isValid) {
      throw new AppError("Invalid API key", 401);
    }

    // Update lastUsedAt asynchronously (don't block request)
    prisma.apiKey
      .update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((e: any) => logger.error("Failed to update API key lastUsedAt", { e }));

    req.apiKey = {
      id: apiKeyRecord.id,
      userId: apiKeyRecord.userId ?? null,
      organizationId: apiKeyRecord.organizationId ?? null,
      keyType: apiKeyRecord.keyType,
      createdByUserId: apiKeyRecord.createdByUserId ?? null,
      emergencyReason: apiKeyRecord.emergencyReason ?? null,
      emergencyExpiresAt: apiKeyRecord.emergencyExpiresAt ?? null,
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

export const ADMIN_KEY_TYPES: ApiKeyType[] = ["ADMIN_KEY", "BREAK_GLASS_KEY"];

/**
 * Middleware to validate admin API key
 * Requires a valid API key with ADMIN_KEY or BREAK_GLASS_KEY type.
 * Sets req.adminId for downstream route handlers / audit trails.
 */
export const validateAdminKey = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.apiKey) {
      await new Promise<void>((resolve, reject) => {
        validateApiKey(req, res, (err?: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    if (!req.apiKey) {
      throw new AppError("API key is required", 401);
    }

    if (!ADMIN_KEY_TYPES.includes(req.apiKey.keyType)) {
      throw new AppError("Admin key required for this operation", 403);
    }

    req.adminId = req.apiKey.userId ?? req.apiKey.createdByUserId ?? req.apiKey.id;

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
  permissions: PermissionScope[] = [],
  options?: {
    organizationId?: string | null;
    keyType?: ApiKeyType;
    expiresAt?: Date;
    emergencyReason?: string;
    emergencyExpiresAt?: Date;
    createdByUserId?: string;
    rateLimit?: number;
  },
): Promise<string> {
  const crypto = await import("crypto");
  const lookupKey = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(32).toString("hex");
  const apiKey = `${API_KEY_PREFIX}_${lookupKey}_${secret}`;
  const keyHash = await hashApiKey(secret);

  await prisma.apiKey.create({
    data: {
      userId: userId ?? null,
      organizationId: options?.organizationId ?? null,
      keyType: options?.keyType ?? "USER_KEY",
      createdByUserId: options?.createdByUserId ?? null,
      emergencyReason: options?.emergencyReason ?? null,
      emergencyExpiresAt: options?.emergencyExpiresAt,
      lookupKey,
      keyHash,
      permissions,
      expiresAt: options?.expiresAt,
      rateLimit: options?.rateLimit,
    },
  });

  logger.info("API key generated", {
    userId,
    keyType: options?.keyType ?? "USER_KEY",
    hasPermissions: permissions.length > 0,
  });
  return apiKey;
}
