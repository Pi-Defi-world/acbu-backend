/**
 * Offset-based pagination for list endpoints (W10-BE-017).
 *
 * List endpoints used to pass `parseInt(req.query.limit)` straight to the
 * database, so a caller could request an unbounded page: the query would scan
 * and serialise arbitrarily many rows in a single response (cost / DoS).
 *
 * Route handlers that accept `limit`/`offset` should go through
 * {@link parseOffsetPagination}, which applies a default page size, a hard
 * ceiling, and rejects values the database driver cannot accept.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

// Prisma's `skip` maps to a signed 32-bit integer; larger values fail at the
// driver instead of the boundary, so clamp here rather than returning a 500.
const MAX_PAGE_OFFSET = 2_147_483_647;

export interface OffsetPagination {
  limit: number;
  offset: number;
}

/**
 * Parses a query value into a finite number, or `null` when it is absent or
 * unusable. Express can surface repeated query params as arrays; those are not
 * valid pagination values and fall back to defaults.
 */
function parseQueryNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalises `limit` and `offset` from an Express query object.
 *
 * - `limit` defaults to `defaultLimit` (20) when missing or invalid, and is
 *   clamped to `[1, maxLimit]` (100 by default).
 * - `offset` defaults to 0 when missing or invalid, and is clamped to the
 *   non-negative range the database can represent.
 */
export function parseOffsetPagination(
  query: { limit?: unknown; offset?: unknown },
  options: { defaultLimit?: number; maxLimit?: number } = {},
): OffsetPagination {
  const maxLimit = Math.max(1, Math.floor(options.maxLimit ?? MAX_PAGE_LIMIT));
  const defaultLimit = Math.min(
    maxLimit,
    Math.max(1, Math.floor(options.defaultLimit ?? DEFAULT_PAGE_LIMIT)),
  );

  const requestedLimit = parseQueryNumber(query.limit);
  const limit =
    requestedLimit !== null && requestedLimit >= 1
      ? Math.min(maxLimit, Math.floor(requestedLimit))
      : defaultLimit;

  const requestedOffset = parseQueryNumber(query.offset);
  const offset =
    requestedOffset !== null && requestedOffset > 0
      ? Math.min(MAX_PAGE_OFFSET, Math.floor(requestedOffset))
      : 0;

  return { limit, offset };
}
