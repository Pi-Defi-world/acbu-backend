import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { ensureAccountActivated } from "../services/stellar/activationService";
import { logger } from "../config/logger";
import {
  fetchWalletBalance,
  getWalletState,
  updateWalletWithConcurrency,
} from "../services/wallet/walletStateService";
import { enrollClientGeneratedWallet } from "../services/wallet/walletService";
import { getIfMatchHeader, setWalletEtagHeader } from "../utils/walletConcurrency";

export const walletEnrollSchema = z
  .object({
    stellar_address: z.string().length(56).regex(/^G/, "Must be a valid Stellar public key"),
    wrapped_key: z.string().min(1).max(512).optional(),
    wrap_algorithm: z.string().min(1).max(64).optional(),
    wrap_kdf: z.string().min(1).max(64).optional(),
  })
  .refine((body) => !body.wrapped_key || (body.wrap_algorithm && body.wrap_kdf), {
    message: "wrapped_key requires wrap_algorithm and wrap_kdf",
    path: ["wrapped_key"],
  });

function sendWalletState(res: Response, state: Awaited<ReturnType<typeof getWalletState>>): void {
  setWalletEtagHeader(res.setHeader.bind(res), state.wallet_version);
  res.json(state);
}

/**
 * GET /users/me/wallet
 * Returns wallet balance snapshot and version; sets ETag for optimistic concurrency.
 */
export async function getWallet(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    sendWalletState(res, await getWalletState(userId));
  } catch (e) {
    next(e);
  }
}

/**
 * GET /users/me/balance
 * Returns balance with ETag derived from walletVersion.
 */
export async function getMeBalance(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const { snapshot, walletVersion } = await fetchWalletBalance(userId);
    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.json({ ...snapshot, wallet_version: walletVersion });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /users/me/wallet
 * Requires If-Match with the current wallet ETag.
 */
export async function putWalletAddress(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const schema = z.object({
      stellar_address: z.string().length(56).regex(/^G/, "Must be a valid Stellar public key"),
    });
    const body = schema.parse(req.body);

    const previous = await prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true, walletVersion: true },
    });

    if (previous?.stellarAddress === body.stellar_address) {
      setWalletEtagHeader(res.setHeader.bind(res), previous.walletVersion);
      res.status(200).json({
        ok: true,
        stellar_address: body.stellar_address,
        changed: false,
        wallet_version: previous.walletVersion,
      });
      return;
    }

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {
      stellarAddress: body.stellar_address,
      encryptedStellarSecret: null,
      keyEncryptionHint: "external",
    });

    logger.info("User wallet replaced", {
      userId,
      previousStellarAddress: previous?.stellarAddress ?? null,
      newStellarAddress: body.stellar_address,
      walletVersion,
    });

    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      stellar_address: body.stellar_address,
      changed: true,
      previous_stellar_address: previous?.stellarAddress ?? null,
      wallet_version: walletVersion,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * DELETE /users/me/wallet
 * Requires If-Match with the current wallet ETag.
 */
export async function deleteWallet(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const previous = await prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true },
    });

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {
      stellarAddress: null,
      encryptedStellarSecret: null,
      keyEncryptionHint: null,
    });

    logger.info("User wallet detached", {
      userId,
      previousStellarAddress: previous?.stellarAddress ?? null,
      walletVersion,
    });

    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      previous_stellar_address: previous?.stellarAddress ?? null,
      wallet_version: walletVersion,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /users/me/wallet/enroll
 * Binds a keypair generated in the client. Optional `wrapped_key` is an
 * opaque backup the client encrypted with a secret this API never sees.
 * Requires If-Match with the current wallet ETag.
 */
export async function postWalletEnroll(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const body = walletEnrollSchema.parse(req.body);

    const walletVersion = await enrollClientGeneratedWallet(userId, getIfMatchHeader(req), {
      stellarAddress: body.stellar_address,
      wrappedKey: body.wrapped_key,
      wrapAlgorithm: body.wrap_algorithm,
      wrapKdf: body.wrap_kdf,
    });

    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      stellar_address: body.stellar_address,
      has_encrypted_backup: body.wrapped_key !== undefined,
      wallet_version: walletVersion,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /users/me/wallet/activate
 * Requires If-Match with the current wallet ETag.
 */
export async function postWalletActivate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true, walletVersion: true },
    });
    if (!user?.stellarAddress) throw new AppError("No wallet address set", 400);

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {});

    const result = await ensureAccountActivated(user.stellarAddress);
    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      stellar_address: user.stellarAddress,
      wallet_version: walletVersion,
      ...result,
    });
  } catch (e) {
    next(e);
  }
}
