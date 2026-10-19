import Redis from "ioredis";
import {
  createReconnectOnError,
  getRedisFailoverMetrics,
  isReadonlyError,
  RedisService,
  resetRedisFailoverMetrics,
} from "./redisService";

jest.mock("ioredis", () => jest.fn());

jest.mock("../../config/env", () => ({
  config: {
    redis: {
      url: "redis://localhost:6379",
      sentinels: [],
      sentinelName: "",
      password: "",
      maxRetriesPerRequest: 3,
      readonlyRetryAttempts: 3,
      readonlyRetryDelayMs: 1,
    },
  },
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const MockRedis = Redis as unknown as jest.Mock;

describe("redisService READONLY failover handling", () => {
  let mockGet: jest.Mock;
  let mockSet: jest.Mock;
  let mockDisconnect: jest.Mock;
  let mockConnect: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRedisFailoverMetrics();

    mockGet = jest.fn();
    mockSet = jest.fn();
    mockDisconnect = jest.fn();
    mockConnect = jest.fn().mockResolvedValue(undefined);

    MockRedis.mockImplementation(() => {
      const client = {
        status: "wait",
        get: mockGet,
        set: mockSet,
        disconnect: mockDisconnect,
        connect: mockConnect.mockImplementation(async () => {
          client.status = "ready";
        }),
        on: jest.fn(),
      };

      return client;
    });
  });

  it("detects READONLY errors from Redis replies", () => {
    expect(
      isReadonlyError(new Error("READONLY You can't write against a read only replica.")),
    ).toBe(true);
    expect(isReadonlyError(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("configures reconnectOnError to reconnect and resend on READONLY", () => {
    const reconnectOnError = createReconnectOnError();

    expect(
      reconnectOnError(new Error("READONLY You can't write against a read only replica.")),
    ).toBe(2);
    expect(reconnectOnError(new Error("WRONGTYPE Operation against a key"))).toBe(false);
    expect(getRedisFailoverMetrics().reconnects).toBe(1);
  });

  it("retries cache writes after READONLY and reconnects", async () => {
    mockSet
      .mockRejectedValueOnce(new Error("READONLY You can't write against a read only replica."))
      .mockResolvedValueOnce("OK");

    const service = new RedisService();
    await expect(service.set("rate:user:1", "1", 60)).resolves.toBe("OK");

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(getRedisFailoverMetrics().readonlyRetries).toBe(1);
  });

  it("retries until READONLY clears during Sentinel promotion", async () => {
    mockGet
      .mockRejectedValueOnce(new Error("READONLY You can't write against a read only replica."))
      .mockRejectedValueOnce(new Error("READONLY You can't write against a read only replica."))
      .mockResolvedValueOnce("cached-value");

    const service = new RedisService();
    await expect(service.get("session:abc")).resolves.toBe("cached-value");

    expect(mockDisconnect).toHaveBeenCalledTimes(2);
    expect(getRedisFailoverMetrics().readonlyRetries).toBe(2);
  });

  it("throws after exhausting READONLY retry attempts", async () => {
    mockSet.mockRejectedValue(new Error("READONLY You can't write against a read only replica."));

    const service = new RedisService();
    await expect(service.set("rate:user:2", "1")).rejects.toThrow(/READONLY/);
    expect(getRedisFailoverMetrics().readonlyRetries).toBe(2);
  });

  it("claims a key atomically with setNx (SET ... NX EX)", async () => {
    mockSet.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

    const service = new RedisService();
    await expect(service.setNx("jwt:jti:abc", "1", 60)).resolves.toBe(true);
    await expect(service.setNx("jwt:jti:abc", "1", 60)).resolves.toBe(false);

    expect(mockSet).toHaveBeenCalledWith("jwt:jti:abc", "1", "EX", 60, "NX");
  });
});
