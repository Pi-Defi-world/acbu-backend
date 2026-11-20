/**
 * OpenTelemetry tracing initialisation.
 *
 * Must be called — and must resolve — before any other module import so that
 * auto-instrumentation patches land on uninstrumented modules.  Call this at
 * the very top of the application entry-point (src/index.ts) before all other
 * imports.
 *
 * Configuration (all optional — tracing is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT
 * is not set):
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT   OTLP/HTTP collector URL
 *                                  e.g. http://otel-collector:4318
 *                                  When absent, tracing is silently disabled.
 *   OTEL_SERVICE_NAME              Service name reported to the collector.
 *                                  Defaults to "acbu-backend".
 *   OTEL_EXPORTER_OTLP_HEADERS    Comma-separated key=value auth headers,
 *                                  e.g. "Authorization=Bearer <token>"
 *
 * The SDK is configured with:
 *   - NodeSDK + auto-instrumentation (HTTP, Express, pg, MongoDB, gRPC, …)
 *   - OTLP/HTTP trace exporter
 *   - Resource attributes: service.name, service.version, deployment.environment
 *
 * Graceful shutdown is wired to SIGTERM / SIGINT so in-flight spans are flushed
 * before the process exits.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    // Tracing is opt-in: skip silently when the collector endpoint is not configured.
    // This preserves the original no-op behaviour for environments that do not
    // run an OTLP collector (local dev, CI).
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME ?? "acbu-backend";
  const serviceVersion = process.env.npm_package_version ?? "0.0.0";
  const environment = process.env.NODE_ENV ?? "development";

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
  });

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    "deployment.environment": environment,
  });

  sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy fs instrumentation; keep HTTP, Express, pg, MongoDB, gRPC
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Flush and shut down the SDK cleanly on process exit so in-flight spans are
  // not dropped.  Register once; the handlers are idempotent.
  const shutdown = (): void => {
    sdk
      ?.shutdown()
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[tracing] SDK shutdown error", err);
      })
      .finally(() => process.exit(0));
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
