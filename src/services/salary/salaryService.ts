import { prisma } from "../../config/database";
import { Decimal } from "@prisma/client/runtime/library";
import { createTransfer } from "../transfer/transferService";
import { logger } from "../../config/logger";
import { CreateSalaryBatchParams, CreateSalaryBatchResult } from "./types";
import { AppError } from "../../middleware/errorHandler";

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
 * Processes a salary batch by executing individual transfers.
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

  let allSucceeded = true;
  let anySucceeded = false;

  for (const item of batch.items) {
    if (item.status === "completed") {
      anySucceeded = true;
      continue;
    }

    try {
      // In a real scenario, we might need the organization's or user's signing key.
      // For now, we'll use the transferService which might be configured with a system key
      // or we might need to pass a specialized getSenderSigningKey.
      // Since this is a salary disbursement, it's often from a corporate wallet.

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

      if (result.status === "completed") {
        anySucceeded = true;
      } else if (result.status === "failed") {
        allSucceeded = false;
      }
      // If pending, we don't mark allSucceeded as false yet, but it's not completed either.
      if (result.status !== "completed") {
        allSucceeded = false;
      }
    } catch (err) {
      allSucceeded = false;
      logger.error("Salary item transfer failed", {
        itemId: item.id,
        error: err,
      });
      await prisma.salaryItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  }

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

  logger.info("Salary batch processing finished", {
    batchId,
    status: finalStatus,
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

  const amountConfig = schedule.amountConfig as any[];
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
