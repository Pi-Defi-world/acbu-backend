import { z } from "zod";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";

const webhookEndpointSchema = z.object({
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), {
      message: "Webhook URL must use HTTP or HTTPS",
    }),
  secret: z.string().min(1).max(255).optional(),
});

function organizationIdOrThrow(req: AuthRequest): string {
  const organizationId = req.apiKey?.organizationId;
  if (!organizationId) {
    throw new AppError("Organization-scoped API key required", 403);
  }
  return organizationId;
}

export async function createWebhookEndpoint(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const organizationId = organizationIdOrThrow(req);
    const input = webhookEndpointSchema.parse(req.body);
    const endpoint = await prisma.webhookEndpoint.create({
      data: { ...input, organizationId },
      select: { id: true, url: true, active: true, createdAt: true, updatedAt: true },
    });
    res.status(201).json(endpoint);
  } catch (error) {
    next(error);
  }
}

export async function listWebhookEndpoints(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const organizationId = organizationIdOrThrow(req);
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, url: true, active: true, createdAt: true, updatedAt: true },
    });
    res.json(endpoints);
  } catch (error) {
    next(error);
  }
}

export async function deleteWebhookEndpoint(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const organizationId = organizationIdOrThrow(req);
    const result = await prisma.webhookEndpoint.deleteMany({
      where: { id: req.params.id, organizationId },
    });
    if (result.count === 0) {
      throw new AppError("Webhook endpoint not found", 404);
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
