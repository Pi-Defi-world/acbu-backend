// Minimal tracing stub used during tests to avoid requiring full OpenTelemetry
// setup. Exports `initTracing` that is safe to call multiple times.
export function initTracing(serviceName = "acbu") {
  // Reference parameter to avoid unused var compile error in tests
  void serviceName;
  // No-op for tests/local runs. Production code can replace this with a
  // real OpenTelemetry init that sets global tracer providers.
  return;
}

export default initTracing;
