import { Request, Response } from "express";
import { getHealthReport } from "../services/health/healthService";

export async function deepHealthCheck(
  _req: Request,
  res: Response,
): Promise<void> {
  const report = await getHealthReport();
  const statusCode = report.status === "up" ? 200 : 503;
  res.status(statusCode).json(report);
}
