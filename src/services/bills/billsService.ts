import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../config/database";
import { AppError } from "../../middleware/errorHandler";
import { logger } from "../../config/logger";
import { logAudit } from "../audit";
import {
  checkWithdrawalLimits,
  isCurrencyWithdrawalPaused,
} from "../limits/limitsService";
import { enqueueWebhook } from "../webhook";
import { simulatedBillsPartner } from "./simulatedBillsPartner";
import type {
  BillPaymentRequest,
  BillPaymentResult,
  BillsCatalogBiller,
  BillsPartnerAdapter,
  BillsRefundRequest,
  BillsRefundResult,
  BillsWebhookEvent,
  BillsWebhookStatus,
} from "./types";

type JsonRecord = Record<string, unknown>;

const DEFAULT_PROVIDER_ID = "simulated";
const PROVIDERS: Record<string, BillsPartnerAdapter> = {
  [simulatedBillsPartner.providerId]: simulatedBillsPartner,
};

function getConfiguredBillsProviderId(): string {
  return (process.env.BILLS_PROVIDER || DEFAULT_PROVIDER_ID)
    .trim()
    .toLowerCase();
}

function getBillsProvider(
  providerId = getConfiguredBillsProviderId(),
): BillsPartnerAdapter {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new AppError(`Bills provider '${providerId}' is not configured`, 503);
  }
  return provider;
}

function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? ({ ...(value as JsonRecord) } as JsonRecord)
    : {};
}

function getWebhookEventType(
  provider: string,
  status: BillsWebhookStatus,
): string {
  return `bills:${provider}:${status}`;
}

function getTransactionStatusFromWebhook(status: BillsWebhookStatus): string {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "refunded";
}

async function resolveCatalogSelection(
  billerId: string,
  productId: string,
): Promise<{
  provider: BillsPartnerAdapter;
  biller: BillsCatalogBiller;
  product: BillsCatalogBiller["products"][number];
}> {
  const provider = getBillsProvider();
  const catalog = await provider.getCatalog();
  const biller = catalog.find((item) => item.id === billerId);
  if (!biller) {
    throw new AppError("Biller not found", 404);
  }

  const product = biller.products.find((item) => item.id === productId);
  if (!product) {
    throw new AppError("Biller product not found", 404);
  }

  return { provider, biller, product };
}

async function createBillsWebhookRecord(
  event: BillsWebhookEvent,
): Promise<void> {
  await prisma.webhook.create({
    data: {
      transactionId: event.transactionId,
      eventType: getWebhookEventType(event.provider, event.status),
      payload: {
        provider: event.provider,
        provider_reference: event.providerReference,
        status: event.status,
        amount: event.amount,
        currency: event.currency,
        reason: event.reason ?? null,
        raw_payload: event.rawPayload ?? null,
      },
      status: "processed",
    },
  });
}

export async function getBillsCatalog() {
  const provider = getBillsProvider();
  const billers = await provider.getCatalog();
  return {
    provider: provider.providerId,
    billers,
  };
}

export async function payBill(
  request: BillPaymentRequest,
): Promise<BillPaymentResult> {
  const { provider, biller, product } = await resolveCatalogSelection(
    request.billerId,
    request.productId,
  );

  if (
    request.amount < product.minAmount ||
    request.amount > product.maxAmount
  ) {
    throw new AppError(
      `Amount must be between ${product.minAmount} and ${product.maxAmount} ${product.currency}`,
      400,
    );
  }
  if (
    product.fixedAmount !== undefined &&
    Math.round(request.amount * 100) !== Math.round(product.fixedAmount * 100)
  ) {
    throw new AppError(
      `Amount must equal ${product.fixedAmount} ${product.currency} for ${product.name}`,
      400,
    );
  }
  const audience = request.audience || "retail";
  const paused = await isCurrencyWithdrawalPaused(product.currency);
  if (paused) {
    throw new AppError(
      `Bill payments in ${product.currency} are temporarily paused due to reserve protection.`,
      503,
    );
  }

  // We do not yet maintain a dedicated ACBU quote here, so treat the local
  // amount as the withdrawal-equivalent input just like other placeholder limit
  // paths in this repo. The new bill_payment type is included in limit queries.
  await checkWithdrawalLimits(
    audience,
    request.amount,
    product.currency,
    request.userId ?? null,
    request.organizationId ?? null,
  );

  const transaction = await prisma.transaction.create({
    data: {
      userId: request.userId ?? undefined,
      type: "bill_payment",
      status: "pending",
      acbuAmountBurned: new Decimal(request.amount),
      localCurrency: product.currency,
      localAmount: new Decimal(request.amount),
      recipientAccount: {
        biller_id: biller.id,
        biller_name: biller.name,
        product_id: product.id,
        product_name: product.name,
        customer_reference: request.customerReference,
        metadata: request.metadata ?? null,
      },
      rateSnapshot: {
        provider: provider.providerId,
        organizationId: request.organizationId ?? null,
        category: biller.category,
        country_code: biller.countryCode,
        catalog_product_currency: product.currency,
        created_at: new Date().toISOString(),
      },
    },
  });

  await logAudit({
    eventType: "transaction",
    entityType: "transaction",
    entityId: transaction.id,
    action: "bill_payment_created",
    newValue: {
      type: "bill_payment",
      biller_id: biller.id,
      product_id: product.id,
      amount: request.amount,
      currency: product.currency,
      customer_reference: request.customerReference ? "***" : undefined,
    },
    performedBy: request.userId ?? undefined,
  });

  try {
    const providerResult = await provider.payBill({
      transactionId: transaction.id,
      biller,
      product,
      customerReference: request.customerReference,
      amount: request.amount,
      metadata: request.metadata,
    });

    const currentRateSnapshot = asJsonRecord(transaction.rateSnapshot);
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: providerResult.dispatchStatus,
        recipientAddress: providerResult.providerReference,
        rateSnapshot: {
          ...currentRateSnapshot,
          provider_reference: providerResult.providerReference,
          dispatch_status: providerResult.dispatchStatus,
          dispatched_at: new Date().toISOString(),
          provider_response: providerResult.rawResponse ?? null,
        },
      },
    });

    let status: BillPaymentResult["status"] = providerResult.dispatchStatus;
    if (providerResult.reconciliationEvent) {
      const reconciled = await reconcileBillsWebhook(
        providerResult.reconciliationEvent,
      );
      status =
        reconciled.status === "completed"
          ? "completed"
          : providerResult.dispatchStatus;
    }

    return {
      transactionId: transaction.id,
      status,
      provider: provider.providerId,
      providerReference: providerResult.providerReference,
      billerId: biller.id,
      productId: product.id,
      localAmount: request.amount,
      currency: product.currency,
      reconciled: status === "completed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: "failed",
        rateSnapshot: {
          ...asJsonRecord(transaction.rateSnapshot),
          failure_reason: message,
          failed_at: new Date().toISOString(),
        },
      },
    });

    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: transaction.id,
      action: "bill_payment_failed",
      newValue: {
        provider: provider.providerId,
        error: message,
      },
      performedBy: request.userId ?? undefined,
    });

    await enqueueWebhook(
      "transaction.failed",
      {
        transaction_id: transaction.id,
        type: "bill_payment",
        provider: provider.providerId,
        amount: request.amount,
        currency: product.currency,
        error: message,
      },
      transaction.id,
    );

    throw error;
  }
}

export async function reconcileBillsWebhook(event: BillsWebhookEvent): Promise<{
  transactionId: string;
  status: string;
}> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: event.transactionId },
    select: {
      id: true,
      userId: true,
      type: true,
      localAmount: true,
      localCurrency: true,
      rateSnapshot: true,
      recipientAddress: true,
    },
  });

  if (!transaction || transaction.type !== "bill_payment") {
    throw new AppError("Bill payment transaction not found", 404);
  }

  await createBillsWebhookRecord(event);

  const nextStatus = getTransactionStatusFromWebhook(event.status);
  const rateSnapshot = {
    ...asJsonRecord(transaction.rateSnapshot),
    provider_reference: event.providerReference,
    webhook_status: event.status,
    webhook_reason: event.reason ?? null,
    webhook_received_at: new Date().toISOString(),
    webhook_payload: event.rawPayload ?? null,
  };

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: nextStatus,
      recipientAddress: event.providerReference,
      rateSnapshot,
      ...(event.status === "completed" || event.status === "refunded"
        ? { completedAt: new Date() }
        : {}),
    },
  });

  await logAudit({
    eventType: "transaction",
    entityType: "transaction",
    entityId: transaction.id,
    action: `bill_payment_${event.status}`,
    newValue: {
      provider: event.provider,
      provider_reference: event.providerReference,
      status: nextStatus,
      amount: event.amount,
      currency: event.currency,
      reason: event.reason ?? null,
    },
    performedBy: transaction.userId ?? undefined,
  });

  if (event.status === "completed") {
    await enqueueWebhook(
      "transaction.completed",
      {
        transaction_id: transaction.id,
        type: "bill_payment",
        provider: event.provider,
        amount: event.amount,
        currency: event.currency,
      },
      transaction.id,
    );
  } else if (event.status === "failed") {
    await enqueueWebhook(
      "transaction.failed",
      {
        transaction_id: transaction.id,
        type: "bill_payment",
        provider: event.provider,
        amount: event.amount,
        currency: event.currency,
        reason: event.reason ?? null,
      },
      transaction.id,
    );
  }

  logger.info("Bills webhook reconciled", {
    transactionId: transaction.id,
    provider: event.provider,
    status: event.status,
  });

  return {
    transactionId: transaction.id,
    status: nextStatus,
  };
}

export async function refundBillPayment(
  request: BillsRefundRequest,
): Promise<BillsRefundResult> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: request.transactionId },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      localAmount: true,
      localCurrency: true,
      recipientAddress: true,
      rateSnapshot: true,
    },
  });

  if (!transaction || transaction.type !== "bill_payment") {
    throw new AppError("Bill payment transaction not found", 404);
  }
  if (!transaction.recipientAddress) {
    throw new AppError("Bill payment has no provider reference", 400);
  }
  if (transaction.status !== "completed") {
    throw new AppError("Only completed bill payments can be refunded", 409);
  }

  const providerId = String(
    asJsonRecord(transaction.rateSnapshot).provider || DEFAULT_PROVIDER_ID,
  );
  const provider = getBillsProvider(providerId);
  const localAmount = transaction.localAmount?.toNumber() ?? 0;
  const currency = transaction.localCurrency ?? "NGN";

  const refundResponse = await provider.refundBill({
    transactionId: transaction.id,
    providerReference: transaction.recipientAddress,
    amount: localAmount,
    currency,
    reason: request.reason,
  });

  await reconcileBillsWebhook(refundResponse.reconciliationEvent);

  return {
    transactionId: transaction.id,
    provider: refundResponse.provider,
    providerReference: refundResponse.providerReference,
    status: "refunded",
  };
}
