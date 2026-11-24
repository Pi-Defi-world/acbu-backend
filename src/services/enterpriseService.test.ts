jest.mock("../config/database", () => ({
  prisma: {
    $transaction: jest.fn(),
    bulkTransferJob: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { processBulkTransfer } from "./enterpriseService";

const makeCsv = (rowCount: number): Buffer => {
  const lines = ["to,amount_acbu"];
  for (let i = 0; i < rowCount; i += 1) {
    // Invalid amount keeps rows out of processRow so the test only exercises the guard.
    lines.push(`recipient-${i},not-a-number`);
  }
  return Buffer.from(lines.join("\n"));
};

const params = (rowCount: number) => ({
  organizationId: "org-1",
  senderUserId: "user-1",
  fileContent: makeCsv(rowCount),
});

describe("processBulkTransfer maxRows guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.bulkTransferJob.create as jest.Mock).mockResolvedValue({
      id: "job-1",
      createdAt: new Date(),
    });
    (prisma.bulkTransferJob.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (callback: () => Promise<unknown>) => callback(),
    );
  });

  it("processes a CSV under the row limit", async () => {
    const result = await processBulkTransfer(params(1), { maxRows: 2 });

    expect(result.totalRows).toBe(1);
    expect(prisma.bulkTransferJob.create).toHaveBeenCalledTimes(1);
  });

  it("processes a CSV with exactly the maximum number of rows", async () => {
    const result = await processBulkTransfer(params(2), { maxRows: 2 });

    expect(result.totalRows).toBe(2);
    expect(prisma.bulkTransferJob.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a CSV over the row limit before creating a job or transaction", async () => {
    const promise = processBulkTransfer(params(3), { maxRows: 2 });

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toThrow(/exceeds maximum of 2 rows \(received 3\)/);
    expect(prisma.bulkTransferJob.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
