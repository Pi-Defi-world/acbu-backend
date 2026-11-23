import axios, { AxiosError } from "axios";
import {
  fetchExchangeRateUsd,
  getCachedExchangeRate,
  invalidateExchangeRateCache,
  isRetryableRateApiError,
  refreshExchangeRate,
  resolveExchangeRateCacheTtlMs,
  setCachedExchangeRate,
  triggerBackgroundExchangeRateRefresh,
  MAX_EXCHANGE_RATE_CACHE_TTL_MS,
  DEFAULT_POSITIVE_TTL_MS,
} from "./exchangeRateService";

jest.mock("axios");
jest.mock("../../config/env", () => ({
  config: {
    oracle: {
      forex: {
        baseUrl: "https://v6.exchangerate-api.com/v6",
        apiKey: "test-key",
      },
    },
  },
}));
jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function axiosError(status?: number, code?: string): AxiosError {
  const error = new AxiosError("request failed");
  if (status !== undefined) {
    error.response = { status } as AxiosError["response"];
  }
  if (code) error.code = code;
  return error;
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidateExchangeRateCache();
  jest.useRealTimers();
  jest
    .spyOn(axios, "isAxiosError")
    .mockImplementation((error: unknown): error is AxiosError => error instanceof AxiosError);
});

describe("resolveExchangeRateCacheTtlMs", () => {
  it("uses a shorter TTL for negative cache entries", () => {
    expect(resolveExchangeRateCacheTtlMs(true)).toBeGreaterThan(
      resolveExchangeRateCacheTtlMs(false),
    );
  });

  it("defaults positive cache TTL to 180 seconds (180,000 ms)", () => {
    delete process.env.EXCHANGE_RATE_CACHE_TTL_MS;
    expect(resolveExchangeRateCacheTtlMs(true)).toBe(DEFAULT_POSITIVE_TTL_MS);
    expect(resolveExchangeRateCacheTtlMs(true)).toBe(180_000);
  });

  it("clamps positive cache TTL to MAX_EXCHANGE_RATE_CACHE_TTL_MS (180s) even if configured higher", () => {
    process.env.EXCHANGE_RATE_CACHE_TTL_MS = "900000"; // 15 minutes
    expect(resolveExchangeRateCacheTtlMs(true)).toBe(MAX_EXCHANGE_RATE_CACHE_TTL_MS);
    delete process.env.EXCHANGE_RATE_CACHE_TTL_MS;
  });
});

describe("isRetryableRateApiError", () => {
  it("treats 5xx responses as retryable", () => {
    expect(isRetryableRateApiError(axiosError(503))).toBe(true);
  });

  it("treats 4xx client errors as non-retryable", () => {
    expect(isRetryableRateApiError(axiosError(400))).toBe(false);
  });
});

describe("fetchExchangeRateUsd", () => {
  it("returns cached rate without calling the API again", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0007 },
    });

    await fetchExchangeRateUsd("NGN");
    await fetchExchangeRateUsd("NGN");

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(getCachedExchangeRate("NGN")).toBe(0.0007);
  });

  it("negative-caches retryable API failures", async () => {
    mockedAxios.get.mockRejectedValue(axiosError(503));

    await fetchExchangeRateUsd("KES");
    await fetchExchangeRateUsd("KES");

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(getCachedExchangeRate("KES")).toBeNull();
  });

  it("coalesces concurrent requests for the same currency", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0012 },
    });

    const [a, b] = await Promise.all([fetchExchangeRateUsd("GHS"), fetchExchangeRateUsd("GHS")]);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(a).toBe(0.0012);
    expect(b).toBe(0.0012);
  });

  it("re-fetches after the negative cache expires", async () => {
    jest.useFakeTimers();

    mockedAxios.get.mockRejectedValueOnce(axiosError(503)).mockResolvedValueOnce({
      data: { result: "success", conversion_rate: 0.0025 },
    });

    await fetchExchangeRateUsd("ZAR");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(resolveExchangeRateCacheTtlMs(false) + 1);

    const rate = await fetchExchangeRateUsd("ZAR");

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(rate).toBe(0.0025);
  });

  it("negative-caches malformed success payloads", async () => {
    mockedAxios.get.mockResolvedValue({ data: { result: "error" } });

    await fetchExchangeRateUsd("UGX");
    await fetchExchangeRateUsd("UGX");

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(getCachedExchangeRate("UGX")).toBeNull();
  });

  it("rejects out-of-range upstream rates as unsafe", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 1_000_000_000 },
    });

    await expect(fetchExchangeRateUsd("NGN")).resolves.toBeNull();
    expect(getCachedExchangeRate("NGN")).toBeNull();
  });

  it("bypasses cache when forceRefresh is requested (#1407)", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0007 },
    });

    await fetchExchangeRateUsd("NGN");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0008 },
    });

    const refreshed = await fetchExchangeRateUsd("NGN", { forceRefresh: true });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(refreshed).toBe(0.0008);
  });
});

describe("refreshExchangeRate", () => {
  it("refreshes exchange rate immediately", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0007 },
    });
    await fetchExchangeRateUsd("NGN");

    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0009 },
    });
    const result = await refreshExchangeRate("NGN");
    expect(result).toBe(0.0009);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});

describe("triggerBackgroundExchangeRateRefresh", () => {
  it("triggers a background fetch without throwing", () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: "success", conversion_rate: 0.0007 },
    });
    expect(() => triggerBackgroundExchangeRateRefresh("NGN")).not.toThrow();
  });
});

describe("setCachedExchangeRate", () => {
  it("can be invalidated per currency", () => {
    setCachedExchangeRate("TZS", 0.0004, true);
    invalidateExchangeRateCache("TZS");
    expect(getCachedExchangeRate("TZS")).toBeUndefined();
  });
});
