import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { AppError } from "./errorHandler";

/**
 * In-memory store for idempotency keys to prevent duplicate burn submissions.
 * In production, this should be replaced with a persistent store.
 */
const idempotencyStore = new Set<string>();

/**
 * Extracts the idempotency key from the request.
 * Checks the Idempotency-Key header first, then the body.
 */
export const extractIdempotencyKey = (req: Request): string | undefined => {
  const headerKey = req.header("Idempotency-Key");
  if (headerKey) return headerKey;
  const bodyKey = (req.body as any)?.idempotencyKey;
  return bodyKey;
};

/**
 * Middleware to validate idempotency key uniqueness.
 * Rejects duplicate requests with 409 Conflict.
 */
export const validateIdempotencyKey = (req: Request, _res: Response, next: NextFunction): void => {
  const key = extractIdempotencyKey(req);
  if (!key) {
    throw new AppError("Idempotency key is required", 400);
  }
  if (idempotencyStore.has(key)) {
    throw new AppError("Duplicate idempotency key", 409);
  }
  idempotencyStore.add(key);
  next();
};

/**
 * Request validation middleware using Zod
 */
export const validate = (schema: ZodSchema) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
        }));

        throw new AppError("Validation error", 400, { errors });
      }
      next(error);
    }
  };
};
