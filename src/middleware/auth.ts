import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import bcrypt from 'bcryptjs';
import { AppError } from './errorHandler';
import { logger } from '../config/logger';

export type Audience = 'retail' | 'business' | 'government';

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
}

/**
 * Middleware to validate API key
 */
export const validateApiKey = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey || typeof apiKey !== 'string') {
      throw new AppError('API key is required', 401);
    }

    // Find API key in database
    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        keyHash: await hashApiKey(apiKey),
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        user: true,
        organization: true,
      },
    });

    if (!apiKeyRecord) {
      throw new AppError('Invalid API key', 401);
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() },
    });

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
 * Hash API key for storage
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, 10);
}

/**
 * Generate a new API key
 */
export async function generateApiKey(userId?: string, permissions: string[] = []): Promise<string> {
  const crypto = await import('crypto');
  const apiKey = `acbu_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = await hashApiKey(apiKey);

  await prisma.apiKey.create({
    data: {
      userId: userId ?? null,
      keyHash,
      permissions: permissions as any,
    },
  });

  logger.info('API key generated', { userId, hasPermissions: permissions.length > 0 });
  return apiKey;
}
