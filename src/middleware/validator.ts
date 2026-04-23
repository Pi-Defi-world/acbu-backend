import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { AppError } from "./errorHandler";

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
        throw new AppError(
          "Validation error",
          400,
          "VALIDATION_ERROR",
          error.flatten(),
        );
      }
      next(error);

    }
  };
};
