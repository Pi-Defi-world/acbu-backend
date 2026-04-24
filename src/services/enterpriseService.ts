import crypto from "crypto";
import Papa from "papaparse";
import { prisma } from "../config/database";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import {
  bulkTransferRowSchema,
  type BulkTransferRowInput,
} from "../validators/bulkTransferValidator";
import type {
  BulkTransferJobStatus,
  BulkTransferJobResult,
  BulkTransferRowResult,
  ProcessBulkTransferOptions,
  ProcessBulkTransferParams,
} from "./transfer/bulkTransferTypes";

const DEFAULT_CHUNK_SIZE = config.bulkTransfer.chunkSize;
const DEFAULT_MAX_FILE_SIZE_BYTES = config.bulkTransfer.maxFileSizeBytes;

function bufferFromInput(input: Buffer | NodeJS.ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(input)) {
    return Promise.resolve(input);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    input.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    input.on("end", () => resolve(Buffer.concat(chunks)));
    input.on("error", reject);
  });
}

function deriveIdempotencyKey(
  organizationId: string,
  recipient: string,
  amountAcbu: string,
  reference?: string,
  rowKey?: string,
): string {
  return crypto
    .createHash("sha256")
    .update([organizationId, recipient, amountAcbu, reference ?? "", rowKey ?? ""].join("|"))
    .digest("hex");
}

function parseCsvBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    throw new AppError(parsed.errors[0]?.message || "CSV parsing failed", 400);
  }

  const headers = (parsed.meta.fields ?? []).map((header) => header.trim());
  if (headers.length === 0) {
    throw new AppError("CSV file is empty or has no headers", 400);
  }

  const required = ["to", "amount_acbu"];
  const missing = required.filter((header) => !headers.includes(header));

  if (missing.length > 0) {
    throw new AppError(
      `CSV missing required headers: ${missing.join(", ")}`,
      400,
    );
  }

  return { headers, rows: parsed.data as Record<string, string>[] };
}

async function processRow(
  organizationId: string,
  senderUserId: string | undefined,
  row: BulkTransferRowInput,
  rowIndex: number,
): Promise<BulkTransferRowResult> {
  if (!senderUserId) {
    throw new AppError("User-scoped API key required", 401);
  }

  const idempotencyKey = deriveIdempotencyKey(
    organizationId,
    row.to,
    row.amount_acbu,
    row.reference,
    row.idempotency_key,
  );

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });

  if (existing) {
    return {
      rowIndex,
      idempotencyKey,
      status: "skipped",
      transactionId: existing.id,
      errorMessage:
        existing.status === "failed"
          ? "Duplicate transfer already failed previously"
          : "Duplicate transfer already processed previously",
    };
  }

  try {
    const transaction = await prisma.transaction.create({
      data: {
        userId: senderUserId,
        type: "transfer",
        status: "completed",
        recipientAddress: row.to,
        acbuAmount: row.amount_acbu,
        idempotencyKey,
        completedAt: new Date(),
      },
    });

    return {
      rowIndex,
      idempotencyKey,
      status: "success",
      transactionId: transaction.id,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const existingAfterRace = await prisma.transaction.findUnique({
        where: { idempotencyKey },
        select: { id: true, status: true },
      });

      if (existingAfterRace) {
        return {
          rowIndex,
          idempotencyKey,
          status: "skipped",
          transactionId: existingAfterRace.id,
          errorMessage: "Duplicate transfer already processed previously",
        };
      }
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Bulk transfer row failed", {
      rowIndex,
      idempotencyKey,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      rowIndex,
      idempotencyKey,
      status: "failure",
      errorMessage: message,
    };
  }
}

/**
 * Process a bulk transfer CSV file.
 * Uses sequential chunking so each chunk is isolated in its own transaction.
 */
export async function processBulkTransfer(
  params: ProcessBulkTransferParams,
  options: ProcessBulkTransferOptions = {},
): Promise<BulkTransferJobResult> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  const buffer = await bufferFromInput(params.fileContent);
  if (buffer.length > maxFileSizeBytes) {
    throw new AppError("Uploaded file exceeds size limit", 413);
  }

  const { rows } = parseCsvBuffer(buffer);

  const job = await prisma.bulkTransferJob.create({
    data: {
      organizationId: params.organizationId,
      totalRows: rows.length,
      status: rows.length === 0 ? "completed" : "processing",
      processedRows: 0,
      successCount: 0,
      failureCount: 0,
    },
  });

  const allResults: BulkTransferRowResult[] = [];
  let processedRows = 0;
  let successCount = 0;
  let failureCount = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);

    const chunkResults = await prisma.$transaction(async () => {
      const results: BulkTransferRowResult[] = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const rawRow = chunk[i];
        const validation = bulkTransferRowSchema.safeParse(rawRow);
        if (!validation.success) {
          const message = validation.error.issues
            .map((issue: { message: string }) => issue.message)
            .join("; ");
          const idempotencyKey = deriveIdempotencyKey(
            params.organizationId,
            rawRow.to ?? "",
            rawRow.amount_acbu ?? "",
            rawRow.reference,
            rawRow.idempotency_key,
          );
          results.push({
            rowIndex: start + i,
            idempotencyKey,
            status: "failure",
            errorMessage: message,
          });
          continue;
        }

        results.push(
          await processRow(
            params.organizationId,
            params.senderUserId,
            validation.data,
            start + i,
          ),
        );
      }
      return results;
    });

    allResults.push(...chunkResults);
    processedRows += chunk.length;
    successCount = allResults.filter((result) => result.status === "success").length;
    failureCount = allResults.filter((result) => result.status === "failure").length;

    await prisma.bulkTransferJob.update({
      where: { id: job.id },
      data: {
        processedRows,
        successCount,
        failureCount,
      },
    });
  }

  const failureReport = allResults.filter((result) => result.status === "failure");
  await prisma.bulkTransferJob.update({
    where: { id: job.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      successCount,
      failureCount,
      failureReport,
    },
  });

  return {
    jobId: job.id,
    totalRows: rows.length,
    successCount,
    failureCount,
    skippedCount: allResults.filter((result) => result.status === "skipped").length,
    status: "completed",
    createdAt: job.createdAt.toISOString(),
    completedAt: new Date().toISOString(),
    failureReport,
  };
}

/**
 * Fetch a bulk transfer job for an organization.
 *
 * @param jobId - Bulk transfer job ID
 * @param organizationId - Organization ID used to scope access
 * @returns The job result or null if it does not exist for the organization
 */
export async function getBulkTransferJob(jobId: string, organizationId: string) {
  const job = await prisma.bulkTransferJob.findFirst({
    where: { id: jobId, organizationId },
  });

  if (!job) {
    return null;
  }

  return {
    jobId: job.id,
    totalRows: job.totalRows,
    successCount: job.successCount,
    failureCount: job.failureCount,
    skippedCount: 0,
    status: job.status as BulkTransferJobStatus,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    failureReport: (job.failureReport as BulkTransferRowResult[]) ?? [],
  };
}
