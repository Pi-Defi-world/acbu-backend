/**
 * GET /v1/transactions/:id - Get transaction by id.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";

export const listTransactionsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(), // last transaction_id from previous page
});

/**
 * GET /v1/transactions?limit=20&cursor=<last_transaction_id>
 * List current user's transactions (mint/burn/transfer) with cursor-based pagination.
 * Returns { transactions, next_cursor }.
 */
export async function listMyTransactions(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      res.status(401).json({ error: "User-scoped API key required" });
      return;
    }

    const query = listTransactionsQuerySchema.safeParse(req.query);
    if (!query.success) {
      const msg = query.error.errors.map((x) => x.message).join("; ");
      res.status(400).json({ error: msg });
      return;
    }
    const { limit, cursor } = query.data;

    const list = await prisma.transaction.findMany({
      where: {
        userId,
        type: { in: ["mint", "burn", "transfer", "bill_payment"] },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        status: true,
        usdcAmount: true,
        acbuAmount: true,
        acbuAmountBurned: true,
        localCurrency: true,
        localAmount: true,
        recipientAddress: true,
        fee: true,
        blockchainTxHash: true,
        confirmations: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const items = page.map((t: (typeof page)[number]) => ({
      transaction_id: t.id,
      type: t.type,
      status: t.status,
      usdc_amount: t.usdcAmount?.toString() ?? null,
      amount_acbu: t.acbuAmount?.toString() ?? null,
      acbu_amount_burned: t.acbuAmountBurned?.toString() ?? null,
      local_currency: t.localCurrency ?? null,
      local_amount: t.localAmount?.toString() ?? null,
      recipient_address: t.recipientAddress ?? null,
      fee: t.fee?.toString() ?? null,
      blockchain_tx_hash: t.blockchainTxHash ?? undefined,
      confirmations: t.confirmations,
      created_at: t.createdAt.toISOString(),
      completed_at: t.completedAt?.toISOString() ?? undefined,
    }));

    res.json({ transactions: items, next_cursor: nextCursor });
  } catch (error) {
    next(error);
  }
}

export async function getTransactionById(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const tx = await prisma.transaction.findUnique({
      where: { id },
    });
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    if (req.apiKey?.userId && tx.userId && tx.userId !== req.apiKey.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.status(200).json({
      transaction_id: tx.id,
      type: tx.type,
      status: tx.status,
      usdc_amount: tx.usdcAmount?.toString() ?? null,
      amount_acbu: tx.acbuAmount?.toString() ?? null,
      acbu_amount_burned: tx.acbuAmountBurned?.toString() ?? null,
      local_currency: tx.localCurrency ?? null,
      local_amount: tx.localAmount?.toString() ?? null,
      recipient_account: tx.recipientAccount ?? null,
      recipient_address: tx.recipientAddress ?? null,
      fee: tx.fee?.toString() ?? null,
      rate_snapshot: tx.rateSnapshot ?? null,
      blockchain_tx_hash: tx.blockchainTxHash ?? null,
      confirmations: tx.confirmations,
      created_at: tx.createdAt.toISOString(),
      completed_at: tx.completedAt?.toISOString() ?? null,
    });
  } catch (error) {
    next(error);
  }
}
