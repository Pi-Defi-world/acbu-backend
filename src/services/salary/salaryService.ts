import { prisma } from "../../config/database";
import { Decimal } from "@prisma/client/runtime/library";
import { SalaryItem } from "@prisma/client";
import { createTransfer } from "../transfer/transferService";
import { logger, logFinancialEvent } from "../../config/logger";
import { CreateSalaryBatchParams, CreateSalaryBatchResult } from "./types";
import { AppError } from "../../middleware/errorHandler";
import crypto from "crypto";
import { generateId } from '../../utils/idGenerator';

/**
 * Creates a new salary batch with items. Supports idempotency via idempotencyKey.
 */
export async function createSalaryBatch(
  params: CreateSalaryBatchParams,
): Promise<CreateSalaryBatchResult> {
  const {
    organizationId,
    userId,
    totalAmount,
    currency,
    idempotencyKey,
    items,
  } = params;

  // Idempotency check
  if (idempotencyKey) {
    const existing = await prisma.salaryBatch.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      logger.info("Salary batch idempotency hit", {
        idempotencyKey,
        batchId: existing.id,
      });
      return { batchId: existing.id, status: existing.status };
    }
  }

  // Calculate total amount if not provided or to verify
  const calculatedTotal = items.reduce(
    (acc, item) => acc.add(new Decimal(item.amount)),
    new Decimal(0),
  );
  if (totalAmount && !new Decimal(totalAmount).equals(calculatedTotal)) {
    throw new AppError(
      `Total amount mismatch. Expected ${calculatedTotal.toString()}, got ${totalAmount}`,
      400,
    );
  }

  // Create batch and items in a transaction
  const batch = await prisma.salaryBatch.create({
    data: {
      organizationId,
      userId,
      totalAmount: calculatedTotal,
      currency: currency || "ACBU",
      idempotencyKey,
      status: "pending",
      items: {
        create: items.map((item) => ({
          recipientId: item.recipientId,
          recipientAddress: item.recipientAddress,
          amount: new Decimal(item.amount),
          status: "pending",
        })),
      },
    },
  });

  logger.info("Salary batch created", {
    batchId: batch.id,
    userId,
    organizationId,
  });

  const salaryCorrelationId = idempotencyKey ?? generateId();
  logFinancialEvent({
    event: "salary.batch.initiated",
    status: "pending",
    transactionId: batch.id,
    userId: userId ?? batch.id,
    accountId: organizationId ?? userId ?? batch.id,
    idempotencyKey: idempotencyKey ?? batch.id,
    amount: Math.round(calculatedTotal.toNumber() * 100),
    currency: currency || "ACBU",
    correlationId: salaryCorrelationId,
  });

  // Trigger asynchronous processing
  setImmediate(() =>
    processSalaryBatch(batch.id).catch((err) => {
      logger.error("Salary batch background processing failed", {
        batchId: batch.id,
        error: err,
      });
    }),
  );

  return { batchId: batch.id, status: batch.status };
}

/**
 * Processes a salary batch by executing individual transfers concurrently.
 * Items already completed are skipped (resume support).
 * Failed items are marked in DB; the batch status reflects partial/full completion.
 */
export async function processSalaryBatch(batchId: string): Promise<void> {
  const batch = await prisma.salaryBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });

  if (!batch || (batch.status !== "pending" && batch.status !== "failed")) {
    return;
  }

  await prisma.salaryBatch.update({
    where: { id: batchId },
    data: { status: "processing" },
  });

  logger.info("Processing salary batch", {
    batchId,
    itemCount: batch.items.length,
  });

  const BATCH_CONCURRENCY = 10;
  const pending: SalaryItem[] = (batch.items as SalaryItem[]).filter((item) => item.status !== "completed");

  let successCount = (batch.items as SalaryItem[]).filter((i) => i.status === "completed").length;
  let failCount = 0;

  // Process in concurrent chunks of BATCH_CONCURRENCY
  for (let i = 0; i < pending.length; i += BATCH_CONCURRENCY) {
    const chunk = pending.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (item) => {
        const result = await createTransfer({
          senderUserId: batch.userId,
          to: item.recipientAddress,
          amountAcbu: item.amount.toString(),
        });
        await prisma.salaryItem.update({
          where: { id: item.id },
          data: {
            status: result.status,
            transactionId: result.transactionId,
            errorMessage:
              result.status === "failed" ? "Transfer payment failed" : null,
          },
        });
        return result.status;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value === "completed") {
        successCount++;
      } else {
        // fulfilled-but-failed or rejected
        failCount++;
        if (r.status === "rejected") {
          logger.error("Salary item transfer failed", { batchId, error: r.reason });
          // Mark the corresponding item failed; find by position in chunk
          const idx = results.indexOf(r);
          const item = chunk[idx];
          if (item) {
            await prisma.salaryItem.update({
              where: { id: item.id },
              data: {
                status: "failed",
                errorMessage:
                  r.reason instanceof Error ? r.reason.message : "Unknown error",
              },
            });
          }
        }
      }
    }
  }

  const allSucceeded = failCount === 0 && successCount === batch.items.length;
  const anySucceeded = successCount > 0;
  const finalStatus = allSucceeded
    ? "completed"
    : anySucceeded
      ? "partially_completed"
      : "failed";

  await prisma.salaryBatch.update({
    where: { id: batchId },
    data: {
      status: finalStatus,
      completedAt: finalStatus === "completed" ? new Date() : null,
    },
  });

  logFinancialEvent({
    event: "salary.batch.completed",
    status: allSucceeded ? "success" : anySucceeded ? "success" : "failed",
    transactionId: batchId,
    userId: batch.userId ?? batchId,
    accountId: batch.organizationId ?? batch.userId ?? batchId,
    idempotencyKey: batch.idempotencyKey ?? batchId,
    amount: Math.round(batch.totalAmount.toNumber() * 100),
    currency: batch.currency,
    correlationId: generateId(),
  });

  logger.info("Salary batch processing finished", {
    batchId,
    status: finalStatus,
    successCount,
    failCount,
  });
}

/**
 * Lists salary batches for an organization or user.
 */
export async function getSalaryBatches(params: {
  organizationId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}) {
  const { organizationId, userId, limit = 20, offset = 0 } = params;

  return prisma.salaryBatch.findMany({
    where: {
      OR: [
        organizationId ? { organizationId } : {},
        userId ? { userId } : {},
      ].filter((o) => Object.keys(o).length > 0),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    include: {
      _count: { select: { items: true } },
    },
  });
}

/**
 * Gets details of a specific salary batch.
 */
export async function getSalaryBatchById(id: string) {
  return prisma.salaryBatch.findUnique({
    where: { id },
    include: { items: true },
  });
}

/**
 * Triggers a salary batch from a schedule.
 */
export async function triggerSchedule(scheduleId: string): Promise<void> {
  const schedule = await prisma.salarySchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule || schedule.status !== "active") return;

  const amountConfig = schedule.amountConfig as unknown as any[]; // Temporary fix until types are perfect
  const totalAmount = amountConfig.reduce(
    (acc, item) => acc.add(new Decimal(item.amount)),
    new Decimal(0),
  );

  await createSalaryBatch({
    organizationId: schedule.organizationId || undefined,
    userId: schedule.userId,
    totalAmount: totalAmount.toString(),
    currency: schedule.currency,
    items: amountConfig.map((item) => ({
      recipientId: item.recipient_id,
      recipientAddress: item.recipient_address,
      amount: item.amount,
    })),
  });

  // Calculate next run (crude implementation)
  const nextRun = new Date();
  if (schedule.cron === "0 0 * * *") {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    nextRun.setUTCHours(0, 0, 0, 0);
  } else {
    nextRun.setUTCMinutes(nextRun.getUTCMinutes() + 1); // Default to 1 min for testing
  }

  await prisma.salarySchedule.update({
    where: { id: scheduleId },
    data: {
      lastRunAt: new Date(),
      nextRunAt: nextRun,
    },
  });
}

/**
 * Creates a recurring salary schedule.
 */
export async function createSalarySchedule(params: {
  organizationId?: string;
  userId: string;
  name: string;
  cron: string;
  amountConfig: any;
  currency?: string;
}) {
  const {
    organizationId,
    userId,
    name,
    cron,
    amountConfig,
    currency = "ACBU",
  } = params;

  // Simple validation for cron
  if (!cron || cron.split(" ").length < 5) {
    throw new AppError("Invalid cron expression", 400);
  }

  // Set initial nextRunAt
  const nextRun = new Date();
  if (cron === "0 0 * * *") {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    nextRun.setUTCHours(0, 0, 0, 0);
  } else {
    nextRun.setUTCMinutes(nextRun.getUTCMinutes() + 1);
  }

  const schedule = await prisma.salarySchedule.create({
    data: {
      organizationId,
      userId,
      name,
      cron,
      amountConfig,
      currency,
      status: "active",
      nextRunAt: nextRun,
    },
  });

  logger.info("Salary schedule created", {
    scheduleId: schedule.id,
    userId,
    name,
    nextRunAt: nextRun,
  });
  return schedule;
}

/**
 * Lists salary schedules for an organization or user.
 */
export async function getSalarySchedules(params: {
  organizationId?: string;
  userId?: string;
}) {
  const { organizationId, userId } = params;

  return prisma.salarySchedule.findMany({
    where: {
      OR: [
        organizationId ? { organizationId } : {},
        userId ? { userId } : {},
      ].filter((o) => Object.keys(o).length > 0),
    },
    orderBy: { createdAt: "desc" },
  });
}
