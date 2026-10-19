/**
 * Investment withdrawal: request flow (retail 24h + messaging; business calendar or 1% forced removal).
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { AppError } from "../middleware/errorHandler";
import { encodeCursor, decodeCursor } from "../middleware/pagination";
import {
  INVESTMENT_BUSINESS_ALLOWED_DAYS,
  INVESTMENT_FORCED_REMOVAL_FEE_PERCENT,
} from "../config/investment";
import { getInvestmentWithdrawalTiming } from "../services/investment/withdrawalTimingService";

export const requestSchema = z.object({
  amount_acbu: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Number(s)) && Number(s) > 0, "must be positive"),
  audience: z.enum(["retail", "business"]),
  forced_removal: z.boolean().optional(),
});

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
      throw new AppError("Invalid request", 400, "VALIDATION_ERROR", parsed.error.flatten());
    }
    const { amount_acbu, audience, forced_removal } = parsed.data;
    const timing = await getInvestmentWithdrawalTiming();

    if (audience === "business") {
      if (!timing.isBusinessWithdrawalAllowedDate && !forced_removal) {
        throw new AppError(
          "Business investment withdrawals are only allowed on specific dates. Use forced_removal: true to withdraw with 1% fee (funds in 24h).",
          403,
          "INVESTMENT_BUSINESS_CALENDAR",
          { allowed_days: INVESTMENT_BUSINESS_ALLOWED_DAYS.join(",") },
        );
      }
    }

    const availableAt = timing.availableAt;
    let feePercent: Decimal | null = null;
    if (audience === "business" && forced_removal) {
      feePercent = new Decimal(INVESTMENT_FORCED_REMOVAL_FEE_PERCENT);
    }

    const record = await prisma.investmentWithdrawalRequest.create({
      data: {
        userId: userId ?? undefined,
        organizationId: organizationId ?? undefined,
        audience,
        amountAcbu: new Decimal(amount_acbu),
        status: "requested",
        forcedRemoval: audience === "business" && forced_removal === true,
        feePercent,
        availableAt,
        createdAt: timing.requestedAt,
      },
    });

    res.status(202).json({
      request_id: record.id,
      status: "requested",
      amount_acbu: amount_acbu,
      available_at: availableAt.toISOString(),
      fee_percent: feePercent?.toString() ?? null,
      message:
        audience === "retail"
          ? "Funds will be available in 24 hours. You will receive a notification when ready."
          : "Funds will be available in 24 hours." +
            (feePercent ? ` A ${feePercent}% fee applies (forced removal).` : ""),
    });
  } catch (e) {
    next(e);
  }
}

const WITHDRAWAL_STATUSES = ["requested", "available", "completed", "cancelled"] as const;

export const getWithdrawRequestsQuerySchema = z.object({
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
    // Bind the cursor to the caller's scope (user or org) and verify its
    // signature so it cannot be forged to page into another scope's rows (#405).
    const cursorScope = userId ?? organizationId ?? "";
    const cursorId = decodeCursor(cursor, cursorScope);

    const where = {
      ...(userId ? { userId } : { organizationId }),
      ...(status ? { status } : {}),
    };

    const list = await prisma.investmentWithdrawalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id, cursorScope) : null;
    type WithdrawalRequestRow = (typeof list)[number];

    res.status(200).json({
      requests: page.map((r: WithdrawalRequestRow) => ({
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
