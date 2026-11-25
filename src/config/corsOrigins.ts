/** Default browser origin for local development when CORS_ORIGIN is unset. */
export const DEFAULT_DEV_CORS_ORIGIN = "http://localhost:3000";

/** Default staging origin for staging/test environments when CORS_ORIGIN is unset. */
export const DEFAULT_STAGING_CORS_ORIGIN = "https://staging.acbu.io";

/**
 * Parse and validate CORS_ORIGIN for credentialed cross-origin requests.
 * Wildcard (*) is rejected: browsers forbid ACAO:* with Allow-Credentials.
 */
export function parseCorsOrigins(raw: string | undefined, nodeEnv: string): string[] {
  const normalizedEnv = nodeEnv.trim().toLowerCase();
  const trimmed = raw?.trim();

  if (!trimmed) {
    if (normalizedEnv === "production") {
      throw new Error(
        "CORS_ORIGIN is required in production. Set a comma-separated list of exact origins " +
          "(e.g. https://app.example.com). Wildcard * is not allowed with credentials.",
      );
    }
    // W11-AUD-011: Staging and test environments get an explicit allowlist rather than a
    // catch-all. Any site visited by a developer against the staging API can read
    // authenticated session data if the origin is reflected without an allowlist.
    if (normalizedEnv === "staging" || normalizedEnv === "test") {
      return [DEFAULT_DEV_CORS_ORIGIN, DEFAULT_STAGING_CORS_ORIGIN];
    }
    return [DEFAULT_DEV_CORS_ORIGIN];
  }

  const origins = trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      "CORS_ORIGIN must list at least one origin when set (wildcard * is not allowed).",
    );
  }

  if (origins.some((origin) => origin === "*")) {
    throw new Error(
      "CORS_ORIGIN must not contain wildcard (*). List explicit origins; " +
        "credentialed responses require Access-Control-Allow-Origin to match the request origin.",
    );
  }

  const normalized: string[] = [];
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(
        `Invalid CORS origin "${origin}". Use full origins such as https://app.example.com`,
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `Invalid CORS origin "${origin}". Only http:// and https:// origins are supported.`,
      );
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        `Invalid CORS origin "${origin}". Provide scheme, host, and port only (no credentials in URL).`,
      );
    }
    if (url.pathname !== "/" || origin.endsWith("/")) {
      throw new Error(
        `Invalid CORS origin "${origin}". Provide scheme, host, and port only (no path or trailing slash).`,
      );
    }
    normalized.push(url.origin);
  }

  return [...new Set(normalized)];
}
