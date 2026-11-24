import type { Request, Response } from "express";

/**
 * A `verify` callback compatible with express `body-parser` options
 * (e.g. `express.json({ verify: verifyContentLength })`).
 *
 * The body-parser library invokes this function after reading the full raw
 * request body into `buf`, so we have the actual byte count and can compare
 * it against the declared `Content-Length` header before any JSON parsing
 * begins.
 *
 * Why here rather than a standalone middleware?
 * -------------------------------------------------
 * Express body-parser (used internally by `express.json`) consumes the
 * request stream.  A standalone middleware registered *before* the parser
 * would have to re-read the stream itself, causing the stream to be consumed
 * twice.  A standalone middleware registered *after* the parser only sees the
 * already-parsed body, not the raw bytes.  The `verify` hook is the only
 * safe place to inspect raw bytes AND short-circuit before parsing commits.
 *
 * Behaviour:
 * - If `Content-Length` is absent or cannot be parsed as a non-negative
 *   integer the request passes through unchanged (trusting the underlying
 *   body-parser size limit configured via `limit`).
 * - If the actual byte count does NOT match the declared value, throws an
 *   error with `status: 400` so express-body-parser converts it into a
 *   400 response before the route handler is reached.
 *
 * Fixes #449.
 */
export function verifyContentLength(
  req: Request,
  _res: Response,
  buf: Buffer,
  _encoding: string,
): void {
  const declared = req.headers["content-length"];

  // No header — nothing to validate.
  if (declared === undefined) {
    return;
  }

  const declaredBytes = parseInt(declared, 10);

  // Malformed or negative value — reject early.
  if (isNaN(declaredBytes) || declaredBytes < 0) {
    const err = Object.assign(new Error("Invalid Content-Length header"), {
      status: 400,
      type: "content_length.invalid",
    });
    throw err;
  }

  const actualBytes = buf.length;

  if (actualBytes !== declaredBytes) {
    const err = Object.assign(
      new Error(
        `Content-Length mismatch: declared ${declaredBytes} bytes but received ${actualBytes} bytes`,
      ),
      {
        status: 400,
        type: "content_length.mismatch",
      },
    );
    throw err;
  }
}
