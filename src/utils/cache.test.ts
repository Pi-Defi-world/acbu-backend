import { cacheService } from "./cache";
import { getMongoDB } from "../config/mongodb";
import { logger } from "../config/logger";

jest.mock("../config/mongodb", () => ({
  getMongoDB: jest.fn(),
}));

jest.mock("../config/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("CacheService.deletePattern", () => {
  const deleteMany = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getMongoDB as jest.Mock).mockReturnValue({
      collection: jest.fn().mockReturnValue({
        deleteMany,
      }),
    });
    deleteMany.mockResolvedValue({ deletedCount: 0 });
  });

  it("rejects over-length patterns before touching the database", async () => {
    await cacheService.deletePattern("a".repeat(129));

    expect(logger.warn).toHaveBeenCalledWith(
      "Cache deletePattern: Rejected invalid or over-length pattern.",
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("escapes regex metacharacters and anchors as a literal prefix", async () => {
    const maliciousPattern = "(a+)+$|.*[boom]?";
    await cacheService.deletePattern(maliciousPattern);

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const callArg = deleteMany.mock.calls[0][0];
    const regex = callArg.key.$regex as RegExp;

    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.source.startsWith("^")).toBe(true);
    expect(regex.test("(a+)+$|.*[boom]?prefix")).toBe(true);
    expect(regex.test("aaaaaboom")).toBe(false);
  });

  it("handles regex-like fuzz inputs within event-loop budget", async () => {
    const payloads = Array.from(
      { length: 500 },
      (_, i) => `(a+)+${"a".repeat(i % 20)}$|[x]{${i % 4}}.*`,
    );

    const startedAt = Date.now();
    await Promise.all(payloads.map((p) => cacheService.deletePattern(p)));
    const elapsedMs = Date.now() - startedAt;

    // Wide budget to avoid CI flakiness while still catching pathological stalls.
    expect(elapsedMs).toBeLessThan(250);
  });
});
