import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import * as salaryService from "../services/salary/salaryService";

export const salaryItemSchema = z.object({
  recipient_id: z.string().uuid().optional(),
  recipient_address: z.string().min(56).max(56),
  amount: z.string().refine((s) => !isNaN(Number(s)) && Number(s) > 0, {
    message: "Amount must be a positive number",
  }),
});

export const postSalaryDisburseSchema = z.object({
  organization_id: z.string().uuid().optional(),
  total_amount: z.string().optional(),
  currency: z.string().default("ACBU"),
  idempotency_key: z.string().optional(),
  items: z.array(salaryItemSchema).min(1, "At least one item is required"),
});

/**
 * POST /salary/disburse
 * Batch salary disbursement. Supports idempotency and async processing.
 */
export async function postSalaryDisburse(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }

    const body = postSalaryDisburseSchema.parse(req.body);
    const result = await salaryService.createSalaryBatch({
      userId,
      organizationId:
        body.organization_id || req.apiKey?.organizationId || undefined,
      totalAmount: body.total_amount,
      currency: body.currency,
      idempotencyKey: body.idempotency_key,
      items: body.items.map((item) => ({
        recipientId: item.recipient_id,
        recipientAddress: item.recipient_address,
        amount: item.amount,
      })),
    });

    res.status(202).json({
      batch_id: result.batchId,
      status: result.status,
      message: "Salary batch accepted and is being processed.",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    next(e);
  }
}

/**
 * GET /salary/batches
 * List salary batches for the current user/organization.
 */
export async function getSalaryBatches(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    const organizationId = req.apiKey?.organizationId;

    if (!userId && !organizationId) {
      throw new AppError("Authentication required", 401);
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const batches = await salaryService.getSalaryBatches({
      userId: userId || undefined,
      organizationId: organizationId || undefined,
      limit,
      offset,
    });

    res.status(200).json({
      batches: batches.map((b: any) => ({
        batch_id: b.id,
        status: b.status,
        total_amount: b.totalAmount.toString(),
        currency: b.currency,
        created_at: b.createdAt.toISOString(),
        item_count: b._count.items,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export const postSalaryScheduleSchema = z.object({
  organization_id: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required"),
  cron: z.string().min(1, "Cron expression is required"),
  currency: z.string().default("ACBU"),
  amount_config: z
    .array(salaryItemSchema)
    .min(1, "At least one item is required"),
});

/**
 * POST /salary/schedule
 * Schedule recurring salary payments.
 */
export async function postSalarySchedule(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }

    const body = postSalaryScheduleSchema.parse(req.body);
    const schedule = await salaryService.createSalarySchedule({
      userId,
      organizationId:
        body.organization_id || req.apiKey?.organizationId || undefined,
      name: body.name,
      cron: body.cron,
      currency: body.currency,
      amountConfig: body.amount_config,
    });

    res.status(201).json({
      schedule_id: schedule.id,
      status: schedule.status,
      message: "Salary schedule created successfully.",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    next(e);
  }
}

/**
 * GET /salary/schedules
 * List salary schedules.
 */
export async function getSalarySchedules(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    const organizationId = req.apiKey?.organizationId;

    const schedules = await salaryService.getSalarySchedules({
      userId: userId || undefined,
      organizationId: organizationId || undefined,
    });

    res.status(200).json({
      schedules: schedules.map((s: any) => ({
        schedule_id: s.id,
        name: s.name,
        cron: s.cron,
        status: s.status,
        next_run_at: s.nextRunAt?.toISOString(),
      })),
    });
  } catch (e) {
    next(e);
  }
}
