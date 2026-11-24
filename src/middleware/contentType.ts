import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errorHandler";

export function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    return next(new AppError("Content-Type must be application/json", 415, "INVALID_CONTENT_TYPE"));
  }

  next();
}
