import { Request, Response, NextFunction } from "express";
import { normalizeTimestamps } from "../utils/isoTimestamps";

/**
 * Wraps `res.json` so every JSON response body emits timestamps as ISO 8601
 * UTC strings, regardless of whether the controller returned a `Date`, an ISO
 * string, or epoch milliseconds (W11-AUD-022).
 */
export function isoTimestampSerializer(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => originalJson(normalizeTimestamps(body))) as Response["json"];
  next();
}
