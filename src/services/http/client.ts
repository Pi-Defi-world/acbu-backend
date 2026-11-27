/**
 * Shared axios factory with a Retry-After-aware retry interceptor, plus
 * Horizon/Soroban RPC endpoint pool with failover and circuit breaking.
 *
 * Retryable conditions:
 *   - 429 Too Many Requests  → always honour Retry-After
 *   - 503 Service Unavailable → honour Retry-After when present, else backoff
 *   - Other 5xx              → exponential backoff, no Retry-After expected
 *   - Network errors (no response)
 *
 * Retry-After header is parsed as both a delay-in-seconds integer and as an
 * HTTP-date (RFC 7231 §7.1.3).  Capped at MAX_RETRY_AFTER_MS to avoid
 * sleeping forever on a misconfigured header.
 */
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosError,
} from "axios";
import { logger } from "../../config/logger";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000; // never wait more than 60 s

/** Parse Retry-After header → milliseconds to wait (0 if unparseable). */
function parseRetryAfterMs(header: string | undefined): number {
  if (!header) return 0;
  const secs = Number(header);
  if (!Number.isNaN(secs)) return Math.min(secs * 1_000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return 0;
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 503 || (status >= 500 && status < 600);
}

function backoffMs(attempt: number): number {
  // 1 s, 2 s, 4 s …
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_RETRY_AFTER_MS);
}

/** Attach retry-with-Retry-After interceptor to an existing AxiosInstance. */
export function attachRetryInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number };
    if (!config) return Promise.reject(error);

    const status = error.response?.status ?? 0;
    const hasResponse = !!error.response;

    // Don't retry non-retryable 4xx (except 429) or if we have no error.config
    if (hasResponse && !isRetryable(status)) return Promise.reject(error);

    config._retryCount = (config._retryCount ?? 0) + 1;
    if (config._retryCount > MAX_RETRIES) return Promise.reject(error);

    const retryAfterHeader = error.response?.headers?.["retry-after"] as string | undefined;
    const waitMs = retryAfterHeader
      ? parseRetryAfterMs(retryAfterHeader)
      : backoffMs(config._retryCount);

    logger.warn("HTTP retry scheduled", {
      url: config.url,
      status: status || "network_error",
      attempt: config._retryCount,
      waitMs,
    });

    await new Promise((r) => setTimeout(r, waitMs));
    return instance.request(config);
  });
}

/**
 * Create an axios instance pre-configured with the Retry-After-aware interceptor.
 * All fintech clients should use this instead of `axios.create()` directly.
 */
export function createHttpClient(options?: AxiosRequestConfig): AxiosInstance {
  const instance = axios.create({ timeout: 5_000, ...options });
  attachRetryInterceptor(instance);
  return instance;
}

// ---------------------------------------------------------------------------
// Stellar RPC endpoint pool with failover and circuit breaker
// ---------------------------------------------------------------------------

export const DEFAULT_HORIZON_TESTNET_ENDPOINTS: readonly string[] = [
  "https://horizon-testnet.stellar.org",
];

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;

interface EndpointState {
  url: string;
  consecutiveFailures: number;
  openUntil: number; // epoch ms; 0 = closed
}

export interface RpcPoolOptions {
  endpoints: readonly string[];
  requestOptions?: AxiosRequestConfig;
  failureThreshold?: number;
  openMs?: number;
}

/**
 * Round-robin pool of RPC endpoints. Each endpoint is guarded by a simple
 * circuit breaker: after `failureThreshold` consecutive failures it is skipped
 * for `openMs`. Requests fail over to the next available endpoint on network
 * errors, 429, or 5xx responses. Client 4xx errors are returned immediately.
 */
export class RpcEndpointPool {
  private readonly states: EndpointState[];
  private readonly clients: Map<string, AxiosInstance> = new Map();
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private cursor = 0;

  constructor(options: RpcPoolOptions) {
    if (options.endpoints.length === 0) {
      throw new Error("RpcEndpointPool requires at least one endpoint");
    }
    this.failureThreshold = options.failureThreshold ?? CIRCUIT_FAILURE_THRESHOLD;
    this.openMs = options.openMs ?? CIRCUIT_OPEN_MS;
    this.states = options.endpoints.map((url) => ({
      url,
      consecutiveFailures: 0,
      openUntil: 0,
    }));
    for (const url of options.endpoints) {
      this.clients.set(
        url,
        createHttpClient({ baseURL: url, ...options.requestOptions }),
      );
    }
  }

  /** Endpoints currently eligible for traffic (circuit closed or half-open). */
  private available(now: number): EndpointState[] {
    return this.states.filter((s) => s.openUntil <= now);
  }

  private recordSuccess(state: EndpointState): void {
    state.consecutiveFailures = 0;
    state.openUntil = 0;
  }

  private recordFailure(state: EndpointState, now: number): void {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.openUntil = now + this.openMs;
      logger.warn("RPC circuit opened", { url: state.url, openMs: this.openMs });
    }
  }

  /** Whether a failure should trigger failover to another endpoint. */
  private static isFailoverError(error: unknown): boolean {
    const e = error as AxiosError;
    if (!e.response) return true; // network / timeout
    const status = e.response.status;
    return status === 429 || status >= 500;
  }

  /**
   * Execute a request against the pool. `fn` receives an axios instance bound
   * to a specific endpoint and returns the promise for the request.
   */
  async execute<T>(fn: (client: AxiosInstance) => Promise<T>): Promise<T> {
    const now = Date.now();
    let candidates = this.available(now);
    if (candidates.length === 0) {
      // All circuits open: fall back to the one that re-opens soonest.
      candidates = [...this.states].sort((a, b) => a.openUntil - b.openUntil).slice(0, 1);
    }

    // Rotate starting point for load distribution.
    const start = this.cursor % candidates.length;
    this.cursor = (this.cursor + 1) % Math.max(this.states.length, 1);
    const ordered = [...candidates.slice(start), ...candidates.slice(0, start)];

    let lastError: unknown;
    for (const state of ordered) {
      const client = this.clients.get(state.url)!;
      try {
        const result = await fn(client);
        this.recordSuccess(state);
        return result;
      } catch (error) {
        lastError = error;
        if (!RpcEndpointPool.isFailoverError(error)) {
          // Client error: endpoint is healthy, do not fail over.
          this.recordSuccess(state);
          throw error;
        }
        this.recordFailure(state, Date.now());
        logger.warn("RPC endpoint failed, failing over", {
          url: state.url,
          status: (error as AxiosError).response?.status ?? "network_error",
        });
      }
    }
    throw lastError;
  }

  /** Snapshot of endpoint health, for diagnostics. */
  health(): Array<{ url: string; consecutiveFailures: number; open: boolean }> {
    const now = Date.now();
    return this.states.map((s) => ({
      url: s.url,
      consecutiveFailures: s.consecutiveFailures,
      open: s.openUntil > now,
    }));
  }
}

/** Build a Horizon/Soroban RPC pool from configured endpoints (or testnet defaults). */
export function createRpcPool(
  endpoints: readonly string[] = DEFAULT_HORIZON_TESTNET_ENDPOINTS,
  requestOptions?: AxiosRequestConfig,
): RpcEndpointPool {
  return new RpcEndpointPool({ endpoints, requestOptions });
}
