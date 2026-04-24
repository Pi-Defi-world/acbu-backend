/**
 * Investment withdrawal: request flow (retail 24h + messaging; business calendar or 1% forced removal).
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { InvestmentWithdrawalRequest } from "@prisma/client";
import { AppError } from "../middleware/errorHandler";
import {
  isBusinessWithdrawalAllowedDate,
  INVESTMENT_FORCED_REMOVAL_FEE_PERCENT,
} from "../config/investment";
import { getRabbitMQChannel } from "../config/rabbitmq";
import { QUEUES } from "../config/rabbitmq";

const requestSchema = z.object({
  amount_acbu: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(Number(s)) && Number(s) > 0,
      "must be positive",
    ),
  audience: z.enum(["retail", "business"]),
  forced_removal: z.boolean().optional(),
});

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * POST /v1/investment/withdraw/request - Request investment withdrawal. Funds available in 24h; notification when ready.
 */
export async function postInvestmentWithdrawRequest(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId ?? null;
    const organizationId = req.apiKey?.organizationId ?? null;
    if (!userId && !organizationId) {
      throw new AppError("User or organization context required", 401);
    }
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { amount_acbu, audience, forced_removal } = parsed.data;
    const amountNum = Number(amount_acbu);

    if (audience === "business") {
      const onAllowedDate = isBusinessWithdrawalAllowedDate();
      if (!onAllowedDate && !forced_removal) {
        res.status(403).json({
          error: "Withdrawal only on allowed dates",
          code: "INVESTMENT_BUSINESS_CALENDAR",
          message:
            "Business investment withdrawals are only allowed on specific dates. Use forced_removal: true to withdraw with 1% fee (funds in 24h).",
          allowed_days: process.env.INVESTMENT_BUSINESS_ALLOWED_DAYS || "1,15",
        });
        return;
      }
    }

    const availableAt = new Date(Date.now() + TWENTY_FOUR_HOURS_MS);
    let feePercent: Decimal | null = null;
    if (audience === "business" && forced_removal) {
      feePercent = new Decimal(INVESTMENT_FORCED_REMOVAL_FEE_PERCENT);
    }

    const record = await prisma.investmentWithdrawalRequest.create({
      data: {
        userId: userId ?? undefined,
        organizationId: organizationId ?? undefined,
        audience,
        amountAcbu: new Decimal(amountNum),
        status: "requested",
        forcedRemoval: audience === "business" && forced_removal === true,
        feePercent,
        availableAt,
      },
    });

    res.status(202).json({
      request_id: record.id,
      status: "requested",
      amount_acbu: amount_acbu,
      available_at: availableAt.toISOString(),
      fee_percent: feePercent?.toNumber() ?? null,
      message:
        audience === "retail"
          ? "Funds will be available in 24 hours. You will receive a notification when ready."
          : "Funds will be available in 24 hours." +
            (feePercent
              ? ` A ${feePercent}% fee applies (forced removal).`
              : ""),
    });
  } catch (e) {
    next(e);
  }
}

const WITHDRAWAL_STATUSES = ["requested", "available", "completed", "cancelled"] as const;

const getWithdrawRequestsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
  status: z.enum(WITHDRAWAL_STATUSES).optional(),
});

/**
 * GET /v1/investment/withdraw/requests?limit=20&cursor=<last_id>&status=<status>
 * List user's investment withdrawal requests with cursor-based pagination and optional status filter.
 * Returns { requests, next_cursor } — pass next_cursor as cursor on the next request.
 */
export async function getInvestmentWithdrawRequests(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId ?? null;
    const organizationId = req.apiKey?.organizationId ?? null;

    const query = getWithdrawRequestsQuerySchema.safeParse(req.query);
    if (!query.success) {
      const msg = query.error.errors.map((x) => x.message).join("; ");
      throw new AppError(msg, 400);
    }
    const { limit, cursor, status } = query.data;

    const where = {
      ...(userId ? { userId } : { organizationId }),
      ...(status ? { status } : {}),
    };

    const list = await prisma.investmentWithdrawalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    res.status(200).json({
      requests: page.map((r: InvestmentWithdrawalRequest) => ({
        id: r.id,
        amount_acbu: r.amountAcbu.toString(),
        status: r.status,
        forced_removal: r.forcedRemoval,
        fee_percent: r.feePercent?.toString() ?? null,
        available_at: r.availableAt.toISOString(),
        created_at: r.createdAt.toISOString(),
      })),
      next_cursor: nextCursor,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Publish investment_withdrawal_ready to NOTIFICATIONS queue (called by job).
 */
export async function publishInvestmentWithdrawalReady(
  userId: string | null,
  amountAcbu: number,
  organizationId?: string | null,
): Promise<void> {
  const ch = getRabbitMQChannel();
  await ch.assertQueue(QUEUES.NOTIFICATIONS, { durable: true });
  ch.sendToQueue(
    QUEUES.NOTIFICATIONS,
    Buffer.from(
      JSON.stringify({
        type: "investment_withdrawal_ready",
        userId,
        organizationId: organizationId ?? null,
        amountAcbu,
        timestamp: new Date().toISOString(),
      }),
    ),
    { persistent: true },
  );
}
