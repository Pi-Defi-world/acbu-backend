export interface BillsCatalogField {
  id: string;
  label: string;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface BillsCatalogProduct {
  id: string;
  name: string;
  description?: string;
  currency: string;
  minAmount: number;
  maxAmount: number;
  fixedAmount?: number;
}

export interface BillsCatalogBiller {
  id: string;
  name: string;
  provider: string;
  category: "airtime" | "electricity" | "internet" | "tv";
  countryCode: string;
  requiredFields: BillsCatalogField[];
  products: BillsCatalogProduct[];
}

export interface BillPaymentRequest {
  userId?: string | null;
  organizationId?: string | null;
  audience?: "retail" | "business" | "government";
  billerId: string;
  productId: string;
  customerReference: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

export interface BillPaymentResult {
  transactionId: string;
  status: "processing" | "completed";
  provider: string;
  providerReference: string;
  billerId: string;
  productId: string;
  localAmount: number;
  currency: string;
  reconciled: boolean;
}

export type BillsWebhookStatus = "completed" | "failed" | "refunded";

export interface BillsWebhookEvent {
  provider: string;
  transactionId: string;
  providerReference: string;
  status: BillsWebhookStatus;
  amount: number;
  currency: string;
  reason?: string;
  rawPayload?: Record<string, unknown>;
}

export interface BillsRefundRequest {
  transactionId: string;
  reason?: string;
}

export interface BillsRefundResult {
  transactionId: string;
  provider: string;
  providerReference: string;
  status: "refunded";
}

export interface PartnerBillPaymentRequest {
  transactionId: string;
  biller: BillsCatalogBiller;
  product: BillsCatalogProduct;
  customerReference: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

export interface PartnerBillPaymentResponse {
  provider: string;
  providerReference: string;
  dispatchStatus: "processing" | "completed";
  reconciliationEvent?: BillsWebhookEvent;
  rawResponse?: Record<string, unknown>;
}

export interface PartnerBillRefundRequest {
  transactionId: string;
  providerReference: string;
  amount: number;
  currency: string;
  reason?: string;
}

export interface PartnerBillRefundResponse {
  provider: string;
  providerReference: string;
  reconciliationEvent: BillsWebhookEvent;
  rawResponse?: Record<string, unknown>;
}

export interface BillsPartnerAdapter {
  readonly providerId: string;
  getCatalog(): Promise<BillsCatalogBiller[]>;
  payBill(
    request: PartnerBillPaymentRequest,
  ): Promise<PartnerBillPaymentResponse>;
  refundBill(
    request: PartnerBillRefundRequest,
  ): Promise<PartnerBillRefundResponse>;
}
