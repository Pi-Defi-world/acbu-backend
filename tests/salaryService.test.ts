/**
 * W2-B-038 — Salary service tests
 *
 * Acceptance: salary tests pass. Covers:
 *  - createSalaryBatch: normal path, idempotency hit, total mismatch validation,
 *    async background processing kick-off
 *  - processSalaryBatch: all-success, partial-failure, all-failed, resume-support
 *    (skip already-completed items), rejected transfers write failedItemWrites
 *  - getSalaryBatches: pagination, org/user filter
 *  - createSalarySchedule: normal path, invalid cron rejection
 *  - triggerSchedule: fires createSalaryBatch, updates nextRunAt/lastRunAt,
 *    skips non-active schedules
 */

/// <reference types="jest" />

import { Decimal } from "@prisma/client/runtime/library";

// ── In-memory stores ──────────────────────────────────────────────────────────

type BatchRow = {
  id: string;
  organizationId: string | null;
  userId: string;
  status: string;
  totalAmount: Decimal;
  currency: string;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  items: ItemRow[];
};

type ItemRow = {
  id: string;
  batchId: string;
  recipientId: string | null;
  recipientAddress: string;
  amount: Decimal;
  status: string;
  transactionId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScheduleRow = {
  id: string;
  organizationId: string | null;
  userId: string;
  name: string;
  cron: string;
  amountConfig: unknown;
  currency: string;
  status: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const db: {
  batches: Map<string, BatchRow>;
  items: Map<string, ItemRow>;
  schedules: Map<string, ScheduleRow>;
  transactionBatch: Array<() => Promise<unknown>>;
} = {
  batches: new Map(),
  items: new Map(),
  schedules: new Map(),
  transactionBatch: [],
};

let _seq = 0;
function uid(): string {
  _seq += 1;
  return `id-${_seq}`;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../src/config/database", () => ({
  prisma: {
    salaryBatch: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    salaryItem: {
      update: jest.fn(),
    },
    salarySchedule: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

jest.mock("../src/services/transfer/transferService", () => ({
  createTransfer: jest.fn(),
}));

// Bypass setImmediate deferral in createSalaryBatch so processSalaryBatch runs
// synchronously inside tests.
jest.mock("../src/utils/retry", () => ({
  retryWithBackoff: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

// dateUtils: pin deterministic next-run timestamps
jest.mock("../src/utils/dateUtils", () => ({
  getInitialDailyMidnight: jest.fn(() => new Date("2026-09-02T00:00:00.000Z")),
  getNextDailyMidnight: jest.fn(() => new Date("2026-09-03T00:00:00.000Z")),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────
import {
  createSalaryBatch,
  processSalaryBatch,
  getSalaryBatches,
  createSalarySchedule,
  triggerSchedule,
} from "../src/services/salary/salaryService";
import { prisma } from "../src/config/database";
import { createTransfer } from "../src/services/transfer/transferService";
import { AppError } from "../src/middleware/errorHandler";

const mockBatch = prisma.salaryBatch as jest.Mocked<typeof prisma.salaryBatch>;
const mockItem = prisma.salaryItem as jest.Mocked<typeof prisma.salaryItem>;
const mockSchedule = prisma.salarySchedule as jest.Mocked<typeof prisma.salarySchedule>;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockCreateTransfer = createTransfer as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<BatchRow> = {}): BatchRow {
  const id = uid();
  return {
    id,
    organizationId: "org-1",
    userId: "user-1",
    status: "pending",
    totalAmount: new Decimal("1000.00"),
    currency: "ACBU",
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    items: [],
    ...overrides,
  };
}

function makeItem(batchId: string, overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: uid(),
    batchId,
    recipientId: null,
    recipientAddress: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
    amount: new Decimal("500.00"),
    status: "pending",
    transactionId: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: uid(),
    organizationId: "org-1",
    userId: "user-1",
    name: "Monthly Payroll",
    cron: "0 0 * * *",
    amountConfig: [
      {
        recipient_id: "rec-1",
        recipient_address: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
        amount: "500.00",
      },
    ],
    currency: "ACBU",
    status: "active",
    lastRunAt: null,
    nextRunAt: new Date("2026-09-01T00:00:00.000Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Silence setImmediate in createSalaryBatch background kick-off
const realSetImmediate = global.setImmediate;
beforeAll(() => {
  global.setImmediate = ((fn: () => void) => {
    fn();
    return {} as NodeJS.Immediate;
  }) as typeof setImmediate;
});
afterAll(() => {
  global.setImmediate = realSetImmediate;
});

// ── Test suites ───────────────────────────────────────────────────────────────

describe("createSalaryBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // $transaction called with an array of Prisma promises (array form)
    mockTransaction.mockResolvedValue([]);
  });

  it("creates a batch and returns batchId + pending status", async () => {
    const batch = makeBatch({ id: "batch-1", status: "pending" });
    mockBatch.create.mockResolvedValue(batch);

    // findUnique is called twice: once for idempotency check, once in processSalaryBatch
    mockBatch.findUnique
      .mockResolvedValueOnce(null)                    // idempotency check → no existing batch
      .mockResolvedValueOnce({ ...batch, items: [] }); // processSalaryBatch lookup
    mockBatch.update.mockResolvedValue({ ...batch, status: "completed" });

    const result = await createSalaryBatch({
      userId: "user-1",
      organizationId: "org-1",
      currency: "ACBU",
      items: [
        {
          recipientAddress: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
          amount: "500.00",
        },
        {
          recipientAddress: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123457",
          amount: "500.00",
        },
      ],
    });

    expect(result.batchId).toBe("batch-1");
    expect(result.status).toBe("pending");
    expect(mockBatch.create).toHaveBeenCalledTimes(1);

    // Verify items are nested in the create call
    const createArg = mockBatch.create.mock.calls[0][0];
    expect(createArg.data.items.create).toHaveLength(2);
    expect(createArg.data.currency).toBe("ACBU");
  });

  it("returns idempotency hit without creating a new batch", async () => {
    const existing = makeBatch({ id: "existing-batch", status: "completed" });
    mockBatch.findUnique.mockResolvedValue(existing);

    const result = await createSalaryBatch({
      userId: "user-1",
      currency: "ACBU",
      idempotencyKey: "key-abc",
      items: [
        {
          recipientAddress: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
          amount: "500.00",
        },
      ],
    });

    expect(result.batchId).toBe("existing-batch");
    expect(result.status).toBe("completed");
    expect(mockBatch.create).not.toHaveBeenCalled();
  });

  it("throws AppError 400 when provided totalAmount does not match sum of items", async () => {
    mockBatch.findUnique.mockResolvedValue(null);

    await expect(
      createSalaryBatch({
        userId: "user-1",
        currency: "ACBU",
        totalAmount: "9999.00", // wrong
        items: [
          {
            recipientAddress: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
            amount: "500.00",
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockBatch.create).not.toHaveBeenCalled();
  });

  it("accepts correct totalAmount matching item sum", async () => {
    const batch = makeBatch({ id: "batch-correct-total" });
    mockBatch.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...batch, items: [] });
    mockBatch.create.mockResolvedValue(batch);
    mockBatch.update.mockResolvedValue({ ...batch, status: "completed" });

    const result = await createSalaryBatch({
      userId: "user-1",
      currency: "ACBU",
      totalAmount: "500.00",
      items: [
        {
          recipientAddress: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
          amount: "500.00",
        },
      ],
    });

    expect(result.batchId).toBe("batch-correct-total");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("processSalaryBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Array form: prisma.$transaction([prismaPromise1, prismaPromise2, ...])
    mockTransaction.mockResolvedValue([]);
  });

  it("marks batch completed when all transfers succeed", async () => {
    const item1 = makeItem("batch-ok", { id: "item-1", status: "pending" });
    const item2 = makeItem("batch-ok", { id: "item-2", status: "pending" });
    const batch = makeBatch({
      id: "batch-ok",
      status: "pending",
      items: [item1, item2],
      totalAmount: new Decimal("1000.00"),
    });

    mockBatch.findUnique.mockResolvedValue(batch);
    mockBatch.update.mockResolvedValue({ ...batch, status: "completed" });
    mockItem.update.mockResolvedValue({} as any);
    mockCreateTransfer.mockResolvedValue({ transactionId: "tx-1", status: "completed" });

    await processSalaryBatch("batch-ok");

    // First update: processing; second update: completed
    expect(mockBatch.update).toHaveBeenCalledTimes(2);
    const finalUpdate = mockBatch.update.mock.calls[1][0];
    expect(finalUpdate.data.status).toBe("completed");
    expect(finalUpdate.data.completedAt).toBeInstanceOf(Date);
  });

  it("marks batch partially_completed when some transfers fail", async () => {
    const item1 = makeItem("batch-partial", { id: "item-ok", status: "pending" });
    const item2 = makeItem("batch-partial", { id: "item-fail", status: "pending" });
    const batch = makeBatch({
      id: "batch-partial",
      status: "pending",
      items: [item1, item2],
      totalAmount: new Decimal("1000.00"),
    });

    mockBatch.findUnique.mockResolvedValue(batch);
    mockBatch.update.mockResolvedValue({ ...batch });
    mockItem.update.mockResolvedValue({} as any);

    // First item succeeds, second fails (fulfilled-but-failed status)
    mockCreateTransfer
      .mockResolvedValueOnce({ transactionId: "tx-1", status: "completed" })
      .mockResolvedValueOnce({ transactionId: "tx-2", status: "failed" });

    await processSalaryBatch("batch-partial");

    const finalUpdate = mockBatch.update.mock.calls[1][0];
    expect(finalUpdate.data.status).toBe("partially_completed");
    expect(finalUpdate.data.completedAt).toBeNull();
  });

  it("marks batch failed when all transfers fail", async () => {
    const item = makeItem("batch-all-fail", { status: "pending" });
    const batch = makeBatch({
      id: "batch-all-fail",
      status: "pending",
      items: [item],
      totalAmount: new Decimal("500.00"),
    });

    mockBatch.findUnique.mockResolvedValue(batch);
    mockBatch.update.mockResolvedValue({ ...batch });
    mockItem.update.mockResolvedValue({} as any);
    mockCreateTransfer.mockResolvedValue({ transactionId: "tx-1", status: "failed" });

    await processSalaryBatch("batch-all-fail");

    const finalUpdate = mockBatch.update.mock.calls[1][0];
    expect(finalUpdate.data.status).toBe("failed");
  });

  it("skips already-completed items (resume support)", async () => {
    const done = makeItem("batch-resume", { id: "item-done", status: "completed" });
    const pending = makeItem("batch-resume", { id: "item-pending", status: "pending" });
    const batch = makeBatch({
      id: "batch-resume",
      status: "pending",
      items: [done, pending],
      totalAmount: new Decimal("1000.00"),
    });

    mockBatch.findUnique.mockResolvedValue(batch);
    mockBatch.update.mockResolvedValue({ ...batch });
    mockItem.update.mockResolvedValue({} as any);
    mockCreateTransfer.mockResolvedValue({ transactionId: "tx-new", status: "completed" });

    await processSalaryBatch("batch-resume");

    // createTransfer should only be called for the pending item
    expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
    const finalUpdate = mockBatch.update.mock.calls[1][0];
    // 1 already completed + 1 newly completed = 2 = total
    expect(finalUpdate.data.status).toBe("completed");
  });

  it("writes failed item status via $transaction when transfer rejects", async () => {
    const item = makeItem("batch-reject", { id: "item-reject", status: "pending" });
    const batch = makeBatch({
      id: "batch-reject",
      status: "pending",
      items: [item],
      totalAmount: new Decimal("500.00"),
    });

    mockBatch.findUnique.mockResolvedValue(batch);
    mockBatch.update.mockResolvedValue({ ...batch });
    mockItem.update.mockResolvedValue({} as any);
    mockCreateTransfer.mockRejectedValue(new Error("Stellar network error"));

    await processSalaryBatch("batch-reject");

    // $transaction should have been called to write the failure
    expect(mockTransaction).toHaveBeenCalled();
    const finalUpdate = mockBatch.update.mock.calls[1][0];
    expect(finalUpdate.data.status).toBe("failed");
  });

  it("returns early if batch is not found", async () => {
    mockBatch.findUnique.mockResolvedValue(null);

    await processSalaryBatch("ghost-batch");

    expect(mockBatch.update).not.toHaveBeenCalled();
    expect(mockCreateTransfer).not.toHaveBeenCalled();
  });

  it("returns early if batch status is already completed", async () => {
    const batch = makeBatch({ id: "batch-done", status: "completed", items: [] });
    mockBatch.findUnique.mockResolvedValue(batch);

    await processSalaryBatch("batch-done");

    expect(mockBatch.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getSalaryBatches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns batches filtered by userId with default pagination", async () => {
    const batch = {
      ...makeBatch({ userId: "user-42" }),
      _count: { items: 3 },
    };
    mockBatch.findMany.mockResolvedValue([batch]);

    const result = await getSalaryBatches({ userId: "user-42" });

    expect(result).toHaveLength(1);
    expect(mockBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        skip: 0,
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("applies limit and offset", async () => {
    mockBatch.findMany.mockResolvedValue([]);

    await getSalaryBatches({ organizationId: "org-1", limit: 5, offset: 10 });

    expect(mockBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
  });

  it("includes _count.items in the query", async () => {
    mockBatch.findMany.mockResolvedValue([]);

    await getSalaryBatches({ userId: "user-1" });

    const callArg = mockBatch.findMany.mock.calls[0][0];
    expect(callArg.include).toMatchObject({ _count: { select: { items: true } } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("createSalarySchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a schedule and returns it", async () => {
    const schedule = makeSchedule({ id: "sched-1" });
    mockSchedule.create.mockResolvedValue(schedule);

    const result = await createSalarySchedule({
      userId: "user-1",
      organizationId: "org-1",
      name: "Monthly Payroll",
      cron: "0 0 * * *",
      currency: "ACBU",
      amountConfig: [
        {
          recipient_address: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
          amount: "500.00",
        },
      ],
    });

    expect(result.id).toBe("sched-1");
    expect(mockSchedule.create).toHaveBeenCalledTimes(1);

    const createArg = mockSchedule.create.mock.calls[0][0];
    expect(createArg.data.status).toBe("active");
    expect(createArg.data.nextRunAt).toEqual(new Date("2026-09-02T00:00:00.000Z"));
  });

  it("throws AppError 400 for invalid cron expression (too few parts)", async () => {
    await expect(
      createSalarySchedule({
        userId: "user-1",
        name: "Bad schedule",
        cron: "* * *", // only 3 parts, needs 5
        currency: "ACBU",
        amountConfig: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockSchedule.create).not.toHaveBeenCalled();
  });

  it("throws AppError 400 for empty cron string", async () => {
    await expect(
      createSalarySchedule({
        userId: "user-1",
        name: "Bad schedule",
        cron: "",
        currency: "ACBU",
        amountConfig: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("defaults currency to ACBU when not provided", async () => {
    const schedule = makeSchedule({ currency: "ACBU" });
    mockSchedule.create.mockResolvedValue(schedule);

    await createSalarySchedule({
      userId: "user-1",
      name: "Payroll",
      cron: "0 0 * * *",
      amountConfig: [],
      // no currency
    });

    const createArg = mockSchedule.create.mock.calls[0][0];
    expect(createArg.data.currency).toBe("ACBU");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("triggerSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockResolvedValue([]);
  });

  it("fires createSalaryBatch and updates lastRunAt/nextRunAt", async () => {
    const schedule = makeSchedule({ id: "sched-trigger", cron: "0 0 * * *" });
    mockSchedule.findUnique.mockResolvedValue(schedule);
    mockSchedule.update.mockResolvedValue(schedule);

    // createSalaryBatch internals
    mockBatch.findUnique
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({ ...makeBatch(), items: [] }); // processSalaryBatch
    mockBatch.create.mockResolvedValue(makeBatch({ status: "pending" }));
    mockBatch.update.mockResolvedValue(makeBatch({ status: "completed" }));

    await triggerSchedule("sched-trigger");

    expect(mockBatch.create).toHaveBeenCalledTimes(1);
    expect(mockSchedule.update).toHaveBeenCalledWith({
      where: { id: "sched-trigger" },
      data: {
        lastRunAt: expect.any(Date),
        nextRunAt: new Date("2026-09-03T00:00:00.000Z"),
      },
    });
  });

  it("returns early if schedule is not found", async () => {
    mockSchedule.findUnique.mockResolvedValue(null);

    await triggerSchedule("ghost-schedule");

    expect(mockBatch.create).not.toHaveBeenCalled();
    expect(mockSchedule.update).not.toHaveBeenCalled();
  });

  it("returns early if schedule status is not active", async () => {
    const schedule = makeSchedule({ status: "paused" });
    mockSchedule.findUnique.mockResolvedValue(schedule);

    await triggerSchedule(schedule.id);

    expect(mockBatch.create).not.toHaveBeenCalled();
    expect(mockSchedule.update).not.toHaveBeenCalled();
  });

  it("uses a 60s future nextRunAt for non-daily cron expressions", async () => {
    const schedule = makeSchedule({
      id: "sched-custom-cron",
      cron: "*/5 * * * *", // every 5 minutes
      amountConfig: [
        {
          recipient_id: "rec-1",
          recipient_address: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456",
          amount: "100.00",
        },
      ],
    });
    mockSchedule.findUnique.mockResolvedValue(schedule);
    mockSchedule.update.mockResolvedValue(schedule);
    mockBatch.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...makeBatch(), items: [] });
    mockBatch.create.mockResolvedValue(makeBatch({ status: "pending" }));
    mockBatch.update.mockResolvedValue(makeBatch({ status: "completed" }));

    const before = Date.now();
    await triggerSchedule("sched-custom-cron");
    const after = Date.now();

    const updateArg = mockSchedule.update.mock.calls[0][0];
    const nextRun = updateArg.data.nextRunAt as Date;
    // nextRunAt should be ~60s in the future (within test timing tolerance of ±5s)
    expect(nextRun.getTime()).toBeGreaterThanOrEqual(before + 55_000);
    expect(nextRun.getTime()).toBeLessThanOrEqual(after + 65_000);
  });
});
