import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { processBulkTransfer, getBulkTransferJob } from "../../src/services/enterpriseService";
import { logger } from "../../src/config/logger";
import { prisma } from "../../src/config/database";

jest.mock("../../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const createdTransactions = new Map<string, { id: string; status: string }>();
const jobs = new Map<string, any>();
let txCounter = 0;
let jobCounter = 0;

jest.mock("../../src/config/database", () => ({
  prisma: {
    bulkTransferJob: {
      create: jest.fn(async ({ data }: any) => {
        const job = {
          id: `job-${++jobCounter}`,
          createdAt: new Date("2026-04-23T00:00:00.000Z"),
          ...data,
        };
        jobs.set(job.id, job);
        return job;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const job = jobs.get(where.id);
        Object.assign(job, data);
        jobs.set(job.id, job);
        return job;
      }),
      findFirst: jest.fn(async ({ where }: any) => jobs.get(where.id)),
    },
    transaction: {
      findUnique: jest.fn(async ({ where }: any) =>
        createdTransactions.get(where.idempotencyKey) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        if (createdTransactions.has(data.idempotencyKey)) {
          const err: any = new Error("Unique constraint failed on the fields: (`idempotency_key`)");
          err.code = "P2002";
          throw err;
        }
        const transaction = {
          id: `tx-${++txCounter}`,
          status: data.status,
          recipientAddress: data.recipientAddress,
          acbuAmount: data.acbuAmount,
          idempotencyKey: data.idempotencyKey,
        };
        createdTransactions.set(data.idempotencyKey, transaction);
        return transaction;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn()),
  },
}));

const mockPrisma = prisma as unknown as any;

const applyDefaultPrismaMocks = () => {
  mockPrisma.bulkTransferJob.create.mockImplementation(async ({ data }: any) => {
    const job = {
      id: `job-${++jobCounter}`,
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
      ...data,
    };
    jobs.set(job.id, job);
    return job;
  });

  mockPrisma.bulkTransferJob.update.mockImplementation(async ({ where, data }: any) => {
    const job = jobs.get(where.id);
    Object.assign(job, data);
    jobs.set(job.id, job);
    return job;
  });

  mockPrisma.bulkTransferJob.findFirst.mockImplementation(async ({ where }: any) => jobs.get(where.id));

  mockPrisma.transaction.findUnique.mockImplementation(async ({ where }: any) =>
    createdTransactions.get(where.idempotencyKey) ?? null,
  );

  mockPrisma.transaction.create.mockImplementation(async ({ data }: any) => {
    if (createdTransactions.has(data.idempotencyKey)) {
      const err: any = new Error("Unique constraint failed on the fields: (`idempotency_key`)");
      err.code = "P2002";
      throw err;
    }
    const transaction = {
      id: `tx-${++txCounter}`,
      status: data.status,
      recipientAddress: data.recipientAddress,
      acbuAmount: data.acbuAmount,
      idempotencyKey: data.idempotencyKey,
    };
    createdTransactions.set(data.idempotencyKey, transaction);
    return transaction;
  });

  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn());
};

const makeCsv = (rows: Array<Record<string, string>>) => {
  const headers = ["to", "amount_acbu", "reference", "idempotency_key"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => {
          const value = row[header] ?? "";
          if (value.includes(",") || value.includes('"')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
};

const resetState = () => {
  createdTransactions.clear();
  jobs.clear();
  txCounter = 0;
  jobCounter = 0;
  jest.clearAllMocks();
  applyDefaultPrismaMocks();
};

describe("bulk transfer service", () => {
  beforeEach(resetState);

  it("processes a valid 10-row CSV successfully", async () => {
    const csv = makeCsv(
      Array.from({ length: 10 }, (_, index) => ({
        to: `recipient-${index}`,
        amount_acbu: "1.25",
        reference: `ref-${index}`,
        idempotency_key: `key-${index}`,
      })),
    );

    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(result.status).toBe("completed");
    expect(result.successCount).toBe(10);
    expect(result.failureCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.failureReport).toHaveLength(0);
    expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(10);
  });

  it("processes 100 rows in chunked batches", async () => {
    const csv = makeCsv(
      Array.from({ length: 100 }, (_, index) => ({
        to: `recipient-${index}`,
        amount_acbu: "2.5",
        reference: `ref-${index}`,
        idempotency_key: `key-${index}`,
      })),
    );

    const result = await processBulkTransfer(
      {
        organizationId: "org-1",
        senderUserId: "user-1",
        fileContent: Buffer.from(csv),
      },
      { chunkSize: 25 },
    );

    expect(result.successCount).toBe(100);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(4);
  });

  it("returns consistent results on idempotent re-upload", async () => {
    const csv = makeCsv([
      {
        to: "recipient-a",
        amount_acbu: "3.5",
        reference: "ref-a",
        idempotency_key: "key-a",
      },
      {
        to: "recipient-b",
        amount_acbu: "4.5",
        reference: "ref-b",
        idempotency_key: "key-b",
      },
    ]);

    const first = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });
    const second = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(first.successCount).toBe(2);
    expect(second.skippedCount).toBe(2);
    expect(createdTransactions.size).toBe(2);
  });

  it("records partial failures and continues processing", async () => {
    const csv = makeCsv([
      { to: "recipient-a", amount_acbu: "1.0", reference: "ref-a", idempotency_key: "key-a" },
      { to: "recipient-b", amount_acbu: "1.0", reference: "ref-b", idempotency_key: "key-b" },
      { to: "recipient-c", amount_acbu: "1.0", reference: "ref-c", idempotency_key: "key-c" },
    ]);

    mockPrisma.transaction.create.mockImplementationOnce(async ({ data }: any) => ({
      id: "tx-1",
      status: data.status,
      recipientAddress: data.recipientAddress,
      acbuAmount: data.acbuAmount,
      idempotencyKey: data.idempotencyKey,
    }));
    mockPrisma.transaction.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error("Recipient not available"), { code: "X" });
    });
    mockPrisma.transaction.create.mockImplementationOnce(async ({ data }: any) => ({
      id: "tx-3",
      status: data.status,
      recipientAddress: data.recipientAddress,
      acbuAmount: data.acbuAmount,
      idempotencyKey: data.idempotencyKey,
    }));

    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.failureReport).toHaveLength(1);
    expect(result.failureReport[0].errorMessage).toContain("Recipient not available");
  });

  it("completes immediately for an empty CSV", async () => {
    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from("to,amount_acbu\n"),
    });

    expect(result.totalRows).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.status).toBe("completed");
  });

  it("rejects invalid CSV headers before processing rows", async () => {
    await expect(
      processBulkTransfer({
        organizationId: "org-1",
        senderUserId: "user-1",
        fileContent: Buffer.from("recipient,amount\nfoo,1\n"),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockPrisma.bulkTransferJob.create).not.toHaveBeenCalled();
  });

  it("records a malformed row as failure", async () => {
    const csv = makeCsv([{ to: "recipient-a", amount_acbu: "-1", reference: "ref-a", idempotency_key: "key-a" }]);

    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.failureReport[0].rowIndex).toBe(0);
  });

  it("marks all rows failed when every row is invalid", async () => {
    const csv = makeCsv([
      { to: "recipient-a", amount_acbu: "abc", reference: "ref-a", idempotency_key: "key-a" },
      { to: "recipient-b", amount_acbu: "-5", reference: "ref-b", idempotency_key: "key-b" },
    ]);

    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(result.status).toBe("completed");
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(2);
    expect(result.failureReport).toHaveLength(2);
  });

  it("skips duplicate idempotency keys in the same upload", async () => {
    const csv = makeCsv([
      { to: "recipient-a", amount_acbu: "1.0", reference: "ref-a", idempotency_key: "same-key" },
      { to: "recipient-a", amount_acbu: "1.0", reference: "ref-a", idempotency_key: "same-key" },
    ]);

    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(result.successCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(createdTransactions.size).toBe(1);
  });

  it("does not log recipient identifiers or transfer amounts", async () => {
    const csv = makeCsv([{ to: "recipient-secret", amount_acbu: "999.123", reference: "ref-a", idempotency_key: "key-a" }]);

    await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    const logText = JSON.stringify((logger.info as any).mock.calls);
    expect(logText).not.toContain("recipient-secret");
    expect(logText).not.toContain("999.123");
  });

  it("handles a duplicate race condition gracefully", async () => {
    let calls = 0;
    mockPrisma.transaction.findUnique.mockImplementation(async ({ where }: any) => {
      calls += 1;
      if (calls === 1) return null;
      return { id: "tx-race", status: "completed" };
    });
    mockPrisma.transaction.create.mockImplementation(async () => {
      const err: any = new Error("Unique constraint failed");
      err.code = "P2002";
      throw err;
    });

    const csv = makeCsv([{ to: "recipient-a", amount_acbu: "1.0", reference: "ref-a", idempotency_key: "race-key" }]);

    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    expect(result.skippedCount).toBe(1);
    expect(result.failureCount).toBe(0);
  });

  it("processes 10k rows within the SLO", async () => {
    const csv = makeCsv(
      Array.from({ length: 10000 }, (_, index) => ({
        to: `recipient-${index}`,
        amount_acbu: "1.0",
        reference: `ref-${index}`,
        idempotency_key: `key-${index}`,
      })),
    );

    const startedAt = Date.now();
    const result = await processBulkTransfer(
      {
        organizationId: "org-1",
        senderUserId: "user-1",
        fileContent: Buffer.from(csv),
      },
      { chunkSize: 250 },
    );
    const elapsed = Date.now() - startedAt;

    expect(result.totalRows).toBe(10000);
    expect(result.successCount).toBe(10000);
    expect(elapsed).toBeLessThan(60000);
  });

  it("returns a persisted bulk job when fetched by id", async () => {
    const csv = makeCsv([{ to: "recipient-a", amount_acbu: "1.0", reference: "ref-a", idempotency_key: "key-a" }]);
    const result = await processBulkTransfer({
      organizationId: "org-1",
      senderUserId: "user-1",
      fileContent: Buffer.from(csv),
    });

    const job = await getBulkTransferJob(result.jobId, "org-1");
    expect(job?.jobId).toBe(result.jobId);
    expect(job?.status).toBe("completed");
  });
});
