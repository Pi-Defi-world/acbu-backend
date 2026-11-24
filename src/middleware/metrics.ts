import type { NextFunction, Request, Response } from "express";
import { metrics } from "@opentelemetry/api";

/** Explicit latency buckets (ms) for histogram percentile computation. */
export const LATENCY_BUCKET_BOUNDARIES_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
] as const;

const MAX_OBSERVATIONS_PER_ENDPOINT = 10_000;

export type LatencyPercentiles = {
  p50: number;
  p95: number;
  p99: number;
};

export type EndpointLatencySnapshot = LatencyPercentiles & {
  endpoint: string;
  count: number;
  sumMs: number;
  buckets: Record<string, number>;
};

class LatencyHistogram {
  private readonly observations: number[] = [];
  private readonly bucketCounts: number[];
  count = 0;
  sumMs = 0;

  constructor() {
    this.bucketCounts = new Array(LATENCY_BUCKET_BOUNDARIES_MS.length + 1).fill(0);
  }

  record(durationMs: number): void {
    this.count += 1;
    this.sumMs += durationMs;
    this.observations.push(durationMs);
    if (this.observations.length > MAX_OBSERVATIONS_PER_ENDPOINT) {
      this.observations.shift();
    }

    const bucketIndex = LATENCY_BUCKET_BOUNDARIES_MS.findIndex(
      (boundary) => durationMs <= boundary,
    );
    const idx = bucketIndex === -1 ? LATENCY_BUCKET_BOUNDARIES_MS.length : bucketIndex;
    this.bucketCounts[idx] += 1;
  }

  private percentile(p: number): number {
    if (this.observations.length === 0) {
      return 0;
    }

    const sorted = [...this.observations].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
  }

  snapshot(endpoint: string): EndpointLatencySnapshot {
    const buckets: Record<string, number> = {};
    let cumulative = 0;

    for (let i = 0; i < LATENCY_BUCKET_BOUNDARIES_MS.length; i++) {
      cumulative += this.bucketCounts[i];
      buckets[`le_${LATENCY_BUCKET_BOUNDARIES_MS[i]}`] = cumulative;
    }

    cumulative += this.bucketCounts[LATENCY_BUCKET_BOUNDARIES_MS.length];
    buckets.le_inf = cumulative;

    return {
      endpoint,
      count: this.count,
      sumMs: this.sumMs,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      buckets,
    };
  }

  reset(): void {
    this.observations.length = 0;
    this.bucketCounts.fill(0);
    this.count = 0;
    this.sumMs = 0;
  }
}

const histogramsByEndpoint = new Map<string, LatencyHistogram>();

const meter = metrics.getMeter("acbu-backend");
const otelResponseTimeHistogram = meter.createHistogram("http.server.request.duration", {
  description: "HTTP request duration by endpoint",
  unit: "ms",
});

function getOrCreateHistogram(endpoint: string): LatencyHistogram {
  let histogram = histogramsByEndpoint.get(endpoint);
  if (!histogram) {
    histogram = new LatencyHistogram();
    histogramsByEndpoint.set(endpoint, histogram);
  }
  return histogram;
}

/** Normalize to a stable route label to limit metric cardinality. */
export function normalizeEndpoint(req: Request): string {
  if (req.route?.path) {
    const base = req.baseUrl || "";
    return `${req.method} ${base}${req.route.path}`;
  }

  return `${req.method} ${req.baseUrl}${req.path}`;
}

export function recordResponseTime(
  endpoint: string,
  durationMs: number,
  attributes?: Record<string, string | number>,
): void {
  getOrCreateHistogram(endpoint).record(durationMs);
  otelResponseTimeHistogram.record(durationMs, {
    "http.route": endpoint,
    ...attributes,
  });
}

export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const endpoint = normalizeEndpoint(req);

    recordResponseTime(endpoint, durationMs, {
      "http.method": req.method,
      "http.status_code": res.statusCode,
    });
  });

  next();
}

export function getResponseTimeMetrics(): EndpointLatencySnapshot[] {
  return Array.from(histogramsByEndpoint.entries())
    .map(([endpoint, histogram]) => histogram.snapshot(endpoint))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

/** Reset in-memory histograms (for tests). */
export function resetResponseTimeMetrics(): void {
  histogramsByEndpoint.clear();
}
