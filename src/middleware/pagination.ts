import crypto from "crypto";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { constantTimeEqual } from "../utils/secureCompare";
import { AppError } from "./errorHandler";

/**
 * Cursor-based pagination helpers (#405).
 *
 * Previously controllers encoded the raw database id directly into the
 * `next_cursor` string. Because the cursor was returned verbatim and accepted
 * verbatim, a caller could decode/guess it and supply an arbitrary id to page
 * into rows outside their authorization scope (IDOR via pagination cursor).
 *
 * These helpers wrap the underlying id in an opaque, tamper-evident token:
 *   - The id is bound to a caller "scope" (e.g. the authenticated user/org id)
 *     so a cursor minted for one caller cannot be replayed by another.
 *   - The payload is signed with HMAC-SHA256 using a server-side secret, so the
 *     id cannot be altered without invalidating the signature.
 *
 * The token is NOT confidential (the id is recoverable by the server only), but
 * it is integrity-protected and scope-bound, which is what defeats the IDOR.
 */

// Reuse an existing server secret; CHALLENGE_TOKEN_SECRET falls back to JWT_SECRET.
const CURSOR_SECRET = config.challengeTokenSecret;
const SIGNATURE_BYTES = 16; // 128-bit truncated HMAC is sufficient for integrity here.

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", CURSOR_SECRET)
    .update(payload)
    .digest("base64url")
    .slice(0, SIGNATURE_BYTES * 2);
}

/**
 * Encode an opaque, scope-bound pagination cursor for the given row id.
 *
 * @param id    The underlying database id to page from.
 * @param scope A stable identifier for the caller's authorization scope
 *              (e.g. userId or organizationId). The same scope must be passed
 *              to {@link decodeCursor} for the cursor to be accepted.
 */
export function encodeCursor(id: string, scope: string): string {
  const payload = `${scope}:${id}`;
  const body = Buffer.from(payload).toString("base64url");
  const signature = sign(payload);
  return `${body}.${signature}`;
}

/**
 * Decode and verify an opaque pagination cursor.
 *
 * Returns the underlying id when the cursor is well-formed, its signature is
 * valid, and it was minted for the same `scope`. Returns `null` for an
 * undefined/empty cursor (i.e. first page). Throws {@link AppError} (400) for a
 * malformed, tampered, or cross-scope cursor so the caller cannot use a forged
 * cursor to reach unauthorized rows.
 */
export function decodeCursor(cursor: string | undefined, scope: string): string | null {
  if (!cursor) return null;

  const dot = cursor.lastIndexOf(".");
  if (dot <= 0) {
    throw invalidCursor();
  }

  const body = cursor.slice(0, dot);
  const providedSignature = cursor.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    throw invalidCursor();
  }

  const expectedSignature = sign(payload);
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    throw invalidCursor();
  }

  // payload === `${scope}:${id}`; split on the first colon so ids containing
  // colons are preserved.
  const sep = payload.indexOf(":");
  if (sep < 0) {
    throw invalidCursor();
  }
  const cursorScope = payload.slice(0, sep);
  const id = payload.slice(sep + 1);

  if (!constantTimeEqual(cursorScope, scope) || !id) {
    // Valid signature but wrong scope means the cursor was minted for another
    // caller — surface as an invalid cursor rather than leaking cross-scope data.
    logger.warn("Rejected pagination cursor with mismatched scope");
    throw invalidCursor();
  }

  return id;
}

function invalidCursor(): AppError {
  return new AppError("Invalid pagination cursor", 400, "INVALID_CURSOR");
}
