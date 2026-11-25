import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";
import { redactLogValue } from "../config/logRedaction";
import { AuthRequest } from "./auth";

/**
 * Derive a dot-namespaced action type from method + path for audit logs.
 * e.g. POST /v1/transfers → "transfers.create"
 * For resource routes with IDs (e.g. /v1/transfers/{uuid}), strips the ID segment.
 */
function deriveActionType(method: string, path: string): string {
  const segments = path.split("/").filter(Boolean);
  let segment = segments.pop() ?? "unknown";

  // Skip ID segments (UUID, numeric, or alphanumeric slug) to get the resource name
  if (!/^(v\d+|[a-z-]+)$/i.test(segment)) {
    segment = segments.pop() ?? "resource";
  }

  const verbMap: Record<string, string> = {
    GET: "read",
    POST: "create",
    PUT: "update",
    PATCH: "update",
    DELETE: "delete",
  };
  return `${segment}.${verbMap[method] ?? method.toLowerCase()}`;
}

/**
 * Extract a resource ID from the last path segment if it looks like an ID
 * (UUID, numeric, or alphanumeric slug).
 */
function deriveResourceId(path: string): string | undefined {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  // Treat versioning segments (v1, v2, …) and plain word routes as non-IDs
  return /^(v\d+|[a-z-]+)$/i.test(last) ? undefined : last;
}

/**
 * SHA-256 hash of the serialised request body. Returns undefined when there is
 * no body (GET / DELETE) or when the body is empty.
 */
function hashBody(body: unknown): string | undefined {
  if (body == null || (typeof body === "object" && Object.keys(body as object).length === 0)) {
    return undefined;
  }
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

const REQUEST_BODY_MASK = "[REDACTED]";

/**
 * Keys that must never reach a log sink, regardless of nesting depth
 * (W11-AUD-025). Compared case-insensitively with `_` / `-` stripped, so
 * `secret_key`, `secretKey` and `SECRET-KEY` are all masked.
 */
export const SENSITIVE_BODY_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passcode",
  "pin",
  "bvn",
  "nin",
  "ssn",
  "nationalid",
  "secret",
  "secretkey",
  "privatekey",
  "seed",
  "mnemonic",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "otp",
  "accountnumber",
  "bankaccount",
  "bankaccountnumber",
  "iban",
  "cardnumber",
  "cvv",
]);

const normalizeKey = (key: string): string => key.replace(/[_-]/g, "").toLowerCase();

/**
 * Return a deep copy of a request body with every sensitive value masked.
 * Applies the explicit SENSITIVE_BODY_KEYS mask first, then the shared
 * key-pattern / card-number redaction used by the logger format, so a body is
 * never logged without both layers. The input object is not mutated.
 */
export function sanitizeRequestBody(body: unknown): unknown {
  const mask = (value: unknown, seen: WeakSet<object>): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => mask(item, seen));
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_BODY_KEYS.has(normalizeKey(key)) ? REQUEST_BODY_MASK : mask(child, seen);
    }
    return out;
  };
  return redactLogValue(mask(body, new WeakSet()));
}

/**
 * Returns an ISO-8601 timestamp with microsecond precision.
 * Node.js Date only has millisecond resolution; we fill the sub-ms digits
 * from process.hrtime.bigint() to produce a stable, monotonic microsecond offset.
 */
function microTimestamp(): string {
  const now = new Date();
  const hrNs = process.hrtime.bigint();
  // Microseconds within the current millisecond (0–999)
  const microWithinMs = Number((hrNs / 1000n) % 1000n);
  // ISO string: "2026-06-24T12:28:32.235Z" → insert microseconds before "Z"
  return now
    .toISOString()
    .replace(/\.(\d{3})Z$/, (_, ms) => `.${ms}${String(microWithinMs).padStart(3, "0")}Z`);
}

/**
 * Structured request logger middleware for financial audit compliance.
 *
 * Each completed request emits a structured log entry containing:
 *   - timestamp with microsecond precision
 *   - userId (from API key, if authenticated)
 *   - IP address
 *   - action type (derived from method + path)
 *   - resource ID (last path segment when it looks like an identifier)
 *   - request body hash (SHA-256, never the raw body)
 *   - correlationId (x-request-id header or auto-generated UUID)
 *   - standard HTTP fields (method, path, statusCode, durationMs, userAgent)
 *
 * The raw body is never logged. Outside production, a `debug`-level
 * `request_body` entry carries the body only after `sanitizeRequestBody` has
 * masked passwords, BVN/NIN, secret keys, tokens and bank details.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startHr = process.hrtime.bigint();
  const timestamp = microTimestamp();
  const correlationId = (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();

  // Propagate correlationId so downstream code can reference it
  res.setHeader("x-request-id", correlationId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;
    const authReq = req as AuthRequest;

    logger.info("audit_request", {
      timestamp,
      correlationId,
      userId: authReq.apiKey?.userId ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
      method: req.method,
      path: req.path,
      actionType: deriveActionType(req.method, req.path),
      resourceId: deriveResourceId(req.path) ?? null,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
      userAgent: req.get("user-agent") ?? null,
      bodyHash: hashBody(req.body) ?? null,
    });

    if (process.env.NODE_ENV !== "production" && logger.isDebugEnabled() && hashBody(req.body)) {
      logger.debug("request_body", {
        correlationId,
        method: req.method,
        path: req.path,
        body: sanitizeRequestBody(req.body),
      });
    }
  });

  next();
};
