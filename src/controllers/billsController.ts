import { Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler";
import type { AuthRequest } from "../middleware/auth";
import {
  getBillsCatalog as fetchBillsCatalog,
  payBill,
  refundBillPayment,
} from "../services/bills";

const billPaymentBodySchema = z.object({
  biller_id: z.string().min(1).max(100),
  product_id: z.string().min(1).max(100),
  customer_reference: z
    .string()
    .trim()
    .min(5)
    .max(64)
    .regex(/^[A-Za-z0-9]+$/, "customer_reference must be alphanumeric"),
  amount: z
    .number({
      required_error: "amount is required",
      invalid_type_error: "amount must be a number",
    })
    .positive(),
  metadata: z.record(z.unknown()).optional(),
});

const billRefundBodySchema = z.object({
  transaction_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(255).optional(),
});

export async function getBillsCatalog(
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const catalog = await fetchBillsCatalog();
    res.status(200).json(catalog);
  } catch (e) {
    next(e);
  }
}

export async function postBillsPay(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId ?? null;
    const actorOrganizationId = req.apiKey?.organizationId ?? null;
    if (!actorUserId && !actorOrganizationId) {
      throw new AppError(
        "Bills payment requires a user-scoped or organization-scoped API key",
        401,
      );
    }

    const body = billPaymentBodySchema.parse(req.body);
    const result = await payBill({
      userId: actorUserId,
      organizationId: actorOrganizationId,
      audience: req.audience || "retail",
      billerId: body.biller_id,
      productId: body.product_id,
      customerReference: body.customer_reference,
      amount: body.amount,
      metadata: body.metadata,
    });

    res.status(201).json({
      transaction_id: result.transactionId,
      status: result.status,
      provider: result.provider,
      provider_reference: result.providerReference,
      biller_id: result.billerId,
      product_id: result.productId,
      amount: result.localAmount,
      currency: result.currency,
      reconciled: result.reconciled,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      next(new AppError(e.errors.map((err) => err.message).join("; "), 400));
      return;
    }
    next(e);
  }
}

export async function postBillsRefund(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.apiKey?.userId ?? null;
    const actorOrganizationId = req.apiKey?.organizationId ?? null;
    if (!actorUserId && !actorOrganizationId) {
      throw new AppError(
        "Bills refund requires a user-scoped or organization-scoped API key",
        401,
      );
    }

    const body = billRefundBodySchema.parse(req.body);
    const result = await refundBillPayment({
      transactionId: body.transaction_id,
      reason: body.reason,
    });

    res.status(200).json({
      transaction_id: result.transactionId,
      status: result.status,
      provider: result.provider,
      provider_reference: result.providerReference,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      next(new AppError(e.errors.map((err) => err.message).join("; "), 400));
      return;
    }
    next(e);
  }
}
