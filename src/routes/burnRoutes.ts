import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { burnacbu } from "../controllers/burnController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const processedIdempotencyKeys = new Set<string>();

function extractIdempotencyKey(req: Request): string | undefined {
  const key = req.headers["idempotency-key"] || req.headers["Idempotency-Key"];
  return typeof key === "string" ? key : undefined;
}

function idempotencyCheck(req: Request, res: Response, next: NextFunction): void {
  const idempotencyKey = extractIdempotencyKey(req);
  if (!idempotencyKey) {
    res.status(400).json({ error: "Idempotency-Key header is required" });
    return;
  }
  if (processedIdempotencyKeys.has(idempotencyKey)) {
    res.status(409).json({ error: "Duplicate idempotency key" });
    return;
  }
  processedIdempotencyKeys.add(idempotencyKey);
  (req as any).idempotencyKey = idempotencyKey;
  next();
}

export function createBurnRoutes(): ReturnType<typeof Router> {
  const router: IRouter = Router();
  router.use(validateApiKey);
  router.use(apiKeyRateLimiter);

  router.post("/acbu", idempotencyCheck, burnAcbu);
  return router;
}

const router = createBurnRoutes();
export default router;
