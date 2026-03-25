import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { createTransfer } from "../services/transfer/transferService";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";

const createTransferSchema = z.object({
  to: z.string().min(1, "to is required"),
  amount_acbu: z
    .string()
    .min(1, "amount_acbu is required")
    .refine((s) => /^\d+(\.\d{1,7})?$/.test(s) && Number(s) > 0, {
      message:
        "amount_acbu must be a positive number with up to 7 decimal places",
    }),
});

/**
 * POST /transfers
 * Body: { to: string, amount_acbu: string }. to = alias (@user, E.164, email) or raw G... (56 chars).
 * Returns { transaction_id, status }. No stellarAddress in response.
 */
export async function postTransfers(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }
    const body = createTransferSchema.parse(req.body);
    const result = await createTransfer(
      {
        senderUserId: userId,
        to: body.to.trim(),
        amountAcbu: body.amount_acbu.trim(),
      },
      // getSenderSigningKey not passed: tx stays pending until key/worker is wired
    );
    res.status(201).json({
      transaction_id: result.transactionId,
      status: result.status,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (
      e instanceof Error &&
      (e.message === "Recipient not found or not available" ||
        e.message === "Sender user not found")
    ) {
      return next(new AppError(e.message, 404));
    }
    if (e instanceof Error && e.message === "Cannot transfer to yourself") {
      return next(new AppError(e.message, 400));
    }
    if (
      e instanceof Error &&
      e.message.includes("KYC required to make payments")
    ) {
      return next(new AppError(e.message, 403));
    }
    next(e);
  }
}

const getTransfersQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(), // last transaction_id from previous page
});

/**
 * GET /transfers?limit=20&cursor=<last_transaction_id>
 * List current user's transfers with cursor-based pagination.
 * Returns { transfers, next_cursor } — pass next_cursor as cursor on the next request.
 */
export async function getTransfers(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }

    const query = getTransfersQuerySchema.safeParse(req.query);
    if (!query.success) {
      const msg = query.error.errors.map((x) => x.message).join("; ");
      throw new AppError(msg, 400);
    }
    const { limit, cursor } = query.data;

    const list = await prisma.transaction.findMany({
      where: { userId, type: "transfer" },
      orderBy: { createdAt: "desc" },
      take: limit + 1, // fetch one extra to determine if there's a next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        acbuAmount: true,
        recipientAddress: true,
        blockchainTxHash: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const items = page.map((t: (typeof page)[number]) => ({
      transaction_id: t.id,
      status: t.status,
      amount_acbu: t.acbuAmount?.toString() ?? null,
      blockchain_tx_hash: t.blockchainTxHash ?? undefined,
      created_at: t.createdAt.toISOString(),
      completed_at: t.completedAt?.toISOString() ?? undefined,
    }));

    res.json({ transfers: items, next_cursor: nextCursor });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * GET /transfers/:id
 * Transfer details; optionally exposes blockchain_tx_hash for advanced/support.
 */
export async function getTransferById(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }
    const { id } = req.params;
    const tx = await prisma.transaction.findFirst({
      where: { id, userId, type: "transfer" },
      select: {
        id: true,
        status: true,
        acbuAmount: true,
        recipientAddress: true,
        blockchainTxHash: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!tx) {
      throw new AppError("Transfer not found", 404);
    }
    res.json({
      transaction_id: tx.id,
      status: tx.status,
      amount_acbu: tx.acbuAmount?.toString() ?? null,
      recipient_address: undefined, // hide in default
      blockchain_tx_hash: tx.blockchainTxHash ?? undefined,
      created_at: tx.createdAt.toISOString(),
      completed_at: tx.completedAt?.toISOString() ?? undefined,
    });
  } catch (e) {
    next(e);
  }
}
