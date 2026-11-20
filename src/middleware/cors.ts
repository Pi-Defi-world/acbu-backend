import cors, { type CorsOptions } from "cors";
import { config } from "../config/env";

/**
 * Resolve the Access-Control-Allow-Origin value for a request.
 * Returns the exact origin string when allowed, false when denied,
 * or null when the request has no Origin (non-browser / same-origin tools).
 */
export function resolveCorsOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[],
): string | false | null {
  if (!requestOrigin) {
    return null;
  }
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return false;
}

/**
 * Error raised when a request Origin is not in the CORS allowlist.
 * Carries a 403 status so the error handler surfaces a client error
 * (not a 500 INTERNAL_ERROR) for this client-side misconfiguration.
 */
export class CorsForbiddenError extends Error {
  readonly status = 403;
  readonly code = "CORS_FORBIDDEN";

  constructor(message = "Origin not allowed by CORS") {
    super(message);
    this.name = "CorsForbiddenError";
  }
}

const corsOptionsBase: Omit<CorsOptions, "origin"> = {
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
};

/**
 * Build CORS middleware for a fixed allowlist.
 * Reflects the request origin when allowed; never emits `*` (incompatible with credentials).
 */
export function createCorsMiddleware(allowedOrigins: readonly string[]) {
  return cors({
    ...corsOptionsBase,
    origin: (origin, callback) => {
      const resolved = resolveCorsOrigin(origin, allowedOrigins);
      if (resolved === null) {
        // No Origin header → non-browser / same-origin request (curl, server-to-server).
        // CORS is a browser mechanism; passing through here does not expose the API to
        // cross-origin browser requests because browsers always send an Origin header.
        callback(null, true);
        return;
      }
      if (resolved === false) {
        callback(new CorsForbiddenError());
        return;
      }
      callback(null, resolved);
    },
  });
}

/** Production CORS middleware using origins from validated env config. */
export const corsMiddleware = createCorsMiddleware(config.corsOrigin);
