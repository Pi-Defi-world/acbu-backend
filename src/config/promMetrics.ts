/**
 * #388: Prometheus-compatible metrics for Prisma connection pool.
 * #436: Heap usage ratio gauge and heap dump counter for memory leak detection.
 * W10-OBS-002: Business/financial metrics — mint/burn volume, transfer counts,
 *              KYC/auth failure rates, reserve ratio, and per-endpoint errors.
 *
 * Instruments Prisma middleware to track:
 *  - prisma_pool_wait_seconds   – time spent waiting to acquire a connection (histogram)
 *  - prisma_pool_acquire_seconds – total time from request to first query byte (histogram)
 *  - prisma_pool_exhausted_total – P2024 (pool timeout) error counter
 *
 * Memory metrics:
 *  - nodejs_heap_used_ratio     – heapUsed / heap_size_limit (0–1 gauge)
 *  - nodejs_heap_dump_total     – number of heap snapshots written to disk
 *
 * Business/financial metrics:
 *  - acbu_mint_operations_total         – number of mint operations (labels: status, currency)
 *  - acbu_mint_volume_units_total       – cumulative units minted (labels: currency)
 *  - acbu_burn_operations_total         – number of burn operations (labels: status, currency)
 *  - acbu_burn_volume_units_total       – cumulative units burned (labels: currency)
 *  - acbu_transfer_operations_total     – number of transfer operations (labels: status, type)
 *  - acbu_transfer_volume_units_total   – cumulative transfer volume (labels: type)
 *  - acbu_kyc_events_total              – KYC status transitions (labels: status, provider)
 *  - acbu_auth_events_total             – authentication events (labels: event, method)
 *  - acbu_reserve_ratio                 – current reserve ratio gauge (labels: currency)
 *  - acbu_http_errors_total             – HTTP 4xx/5xx responses (labels: method, route, status_code)
 *
 * Also collects default Node.js process metrics (event loop, memory, CPU).
 */
import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// ---------------------------------------------------------------------------
// Infrastructure — Prisma connection pool
// ---------------------------------------------------------------------------

export const poolWaitHistogram = new Histogram({
  name: "prisma_pool_wait_seconds",
  help: "Time in seconds a query spent waiting for a connection from the pool",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const poolAcquireHistogram = new Histogram({
  name: "prisma_pool_acquire_seconds",
  help: "Total time in seconds from query start to first result (includes pool wait + query)",
  labelNames: ["model", "action"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const poolExhaustedCounter = new Counter({
  name: "prisma_pool_exhausted_total",
  help: "Total number of P2024 connection pool timeout errors",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Infrastructure — Node.js heap
// ---------------------------------------------------------------------------

// #436: heap usage ratio — heapUsed divided by the effective V8 heap size limit.
// Values approaching 1.0 indicate a potential memory leak.
export const heapUsedRatioGauge = new Gauge({
  name: "nodejs_heap_used_ratio",
  help: "Ratio of V8 heapUsed to heap_size_limit (0–1). Values near 1 indicate potential memory leak.",
  registers: [registry],
});

export const heapDumpCounter = new Counter({
  name: "nodejs_heap_dump_total",
  help: "Total number of heap snapshots written to disk by the leak detector.",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business — Mint / Burn
// ---------------------------------------------------------------------------

/**
 * Total number of mint operations attempted.
 * Labels:
 *   status   – "success" | "failure"
 *   currency – ISO code of the ACBU currency being minted (e.g. "ACBU", "NGN")
 */
export const mintOperationsCounter = new Counter({
  name: "acbu_mint_operations_total",
  help: "Total number of mint operations, partitioned by outcome and currency.",
  labelNames: ["status", "currency"] as const,
  registers: [registry],
});

/**
 * Cumulative units minted (expressed in the smallest denomination of the
 * currency to avoid floating-point precision issues).
 * Labels:
 *   currency – ISO code of the currency being minted
 */
export const mintVolumeCounter = new Counter({
  name: "acbu_mint_volume_units_total",
  help: "Cumulative units minted (smallest denomination), partitioned by currency.",
  labelNames: ["currency"] as const,
  registers: [registry],
});

/**
 * Total number of burn operations attempted.
 * Labels:
 *   status   – "success" | "failure"
 *   currency – ISO code of the currency being burned
 */
export const burnOperationsCounter = new Counter({
  name: "acbu_burn_operations_total",
  help: "Total number of burn operations, partitioned by outcome and currency.",
  labelNames: ["status", "currency"] as const,
  registers: [registry],
});

/**
 * Cumulative units burned (expressed in the smallest denomination).
 * Labels:
 *   currency – ISO code of the currency being burned
 */
export const burnVolumeCounter = new Counter({
  name: "acbu_burn_volume_units_total",
  help: "Cumulative units burned (smallest denomination), partitioned by currency.",
  labelNames: ["currency"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business — Transfers
// ---------------------------------------------------------------------------

/**
 * Total number of transfer operations attempted.
 * Labels:
 *   status – "success" | "failure"
 *   type   – transfer type, e.g. "p2p" | "sme" | "international" | "salary" | …
 */
export const transferOperationsCounter = new Counter({
  name: "acbu_transfer_operations_total",
  help: "Total number of transfer operations, partitioned by outcome and type.",
  labelNames: ["status", "type"] as const,
  registers: [registry],
});

/**
 * Cumulative transfer volume (expressed in the smallest denomination of the
 * settlement currency).
 * Labels:
 *   type – transfer type (same values as transferOperationsCounter)
 */
export const transferVolumeCounter = new Counter({
  name: "acbu_transfer_volume_units_total",
  help: "Cumulative transfer volume (smallest denomination), partitioned by type.",
  labelNames: ["type"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business — KYC
// ---------------------------------------------------------------------------

/**
 * Total number of KYC status transitions.
 * Labels:
 *   status   – "approved" | "rejected" | "pending" | "expired"
 *   provider – KYC provider identifier, e.g. "smile_id" | "sumsub" | "internal"
 */
export const kycEventsCounter = new Counter({
  name: "acbu_kyc_events_total",
  help: "Total number of KYC status transitions, partitioned by status and provider.",
  labelNames: ["status", "provider"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business — Authentication
// ---------------------------------------------------------------------------

/**
 * Total number of authentication events.
 * Labels:
 *   event  – "login_success" | "login_failure" | "token_refresh" | "logout" | "mfa_failure"
 *   method – auth method, e.g. "password" | "oauth" | "api_key"
 */
export const authEventsCounter = new Counter({
  name: "acbu_auth_events_total",
  help: "Total number of authentication events, partitioned by event type and method.",
  labelNames: ["event", "method"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business — Reserve ratio
// ---------------------------------------------------------------------------

/**
 * Current reserve ratio for each ACBU currency.
 * A ratio of 1.0 means fully backed; values below 1.0 indicate under-collateralisation.
 * Labels:
 *   currency – ISO code of the ACBU currency (e.g. "ACBU", "NGN")
 */
export const reserveRatioGauge = new Gauge({
  name: "acbu_reserve_ratio",
  help: "Current reserve ratio (collateral / outstanding supply). 1.0 = fully backed.",
  labelNames: ["currency"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Operational — HTTP errors
// ---------------------------------------------------------------------------

/**
 * Total number of HTTP 4xx/5xx responses.
 * Populated by the global error-handler middleware so every route benefits
 * without per-route instrumentation.
 * Labels:
 *   method      – HTTP method (GET, POST, …)
 *   route       – matched Express route pattern (e.g. "/api/v1/mint")
 *   status_code – HTTP status code as a string (e.g. "400", "500")
 */
export const httpErrorsCounter = new Counter({
  name: "acbu_http_errors_total",
  help: "Total number of HTTP 4xx/5xx responses, partitioned by method, route, and status code.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});
