import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database";
import bcrypt from "bcryptjs";
import { AppError } from "./errorHandler";
import { logger } from "../config/logger";

export type Audience = "retail" | "business" | "government";
export type UserTier = "free" | "verified" | "sme" | "enterprise";
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
      permissions: (apiKeyRecord.permissions as string[]) || [],
      rateLimit: apiKeyRecord.rateLimit,
    };

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
      permissions: permissions as any,
    },
  });

  logger.info("API key generated", {
    userId,
    hasPermissions: permissions.length > 0,
  });
  return apiKey;
}
