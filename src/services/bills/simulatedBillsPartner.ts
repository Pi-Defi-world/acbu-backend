import crypto from "crypto";
import type {
  BillsCatalogBiller,
  BillsPartnerAdapter,
  PartnerBillPaymentRequest,
  PartnerBillPaymentResponse,
  PartnerBillRefundRequest,
  PartnerBillRefundResponse,
} from "./types";

const SIMULATED_BILLERS: BillsCatalogBiller[] = [
  {
    id: "ikeja-electric",
    name: "Ikeja Electric",
    provider: "simulated",
    category: "electricity",
    countryCode: "NGA",
    requiredFields: [
      {
        id: "meter_number",
        label: "Meter Number",
        hint: "Enter your 11-digit prepaid meter number",
        minLength: 11,
        maxLength: 11,
        pattern: "^[0-9]{11}$",
      },
    ],
    products: [
      {
        id: "prepaid",
        name: "Prepaid Token",
        description: "Instant prepaid electricity token",
        currency: "NGN",
        minAmount: 500,
        maxAmount: 50000,
      },
    ],
  },
  {
    id: "mtn-airtime",
    name: "MTN Airtime",
    provider: "simulated",
    category: "airtime",
    countryCode: "NGA",
    requiredFields: [
      {
        id: "phone_number",
        label: "Phone Number",
        hint: "Enter a Nigerian mobile number",
        minLength: 11,
        maxLength: 11,
        pattern: "^[0-9]{11}$",
      },
    ],
    products: [
      {
        id: "topup",
        name: "Airtime Top-up",
        description: "Flexible airtime purchase",
        currency: "NGN",
        minAmount: 100,
        maxAmount: 10000,
      },
    ],
  },
  {
    id: "dstv",
    name: "DSTV",
    provider: "simulated",
    category: "tv",
    countryCode: "NGA",
    requiredFields: [
      {
        id: "smartcard_number",
        label: "Smartcard Number",
        hint: "Enter your 10-digit smartcard number",
        minLength: 10,
        maxLength: 10,
        pattern: "^[0-9]{10}$",
      },
    ],
    products: [
      {
        id: "compact",
        name: "Compact Bouquet",
        description: "Monthly compact subscription",
        currency: "NGN",
        minAmount: 15700,
        maxAmount: 15700,
        fixedAmount: 15700,
      },
    ],
  },
];

export class SimulatedBillsPartner implements BillsPartnerAdapter {
  readonly providerId = "simulated";

  async getCatalog(): Promise<BillsCatalogBiller[]> {
    return SIMULATED_BILLERS.map((biller) => ({
      ...biller,
      requiredFields: biller.requiredFields.map((field) => ({ ...field })),
      products: biller.products.map((product) => ({ ...product })),
    }));
  }

  async payBill(
    request: PartnerBillPaymentRequest,
  ): Promise<PartnerBillPaymentResponse> {
    const providerReference = `bill_${crypto.randomUUID()}`;
    return {
      provider: this.providerId,
      providerReference,
      dispatchStatus: "processing",
      reconciliationEvent: {
        provider: this.providerId,
        transactionId: request.transactionId,
        providerReference,
        status: "completed",
        amount: request.amount,
        currency: request.product.currency,
        rawPayload: {
          provider_reference: providerReference,
          biller_id: request.biller.id,
          product_id: request.product.id,
          customer_reference: request.customerReference,
          metadata: request.metadata ?? null,
          simulated: true,
        },
      },
      rawResponse: {
        accepted: true,
        provider_reference: providerReference,
        biller_id: request.biller.id,
        product_id: request.product.id,
      },
    };
  }

  async refundBill(
    request: PartnerBillRefundRequest,
  ): Promise<PartnerBillRefundResponse> {
    return {
      provider: this.providerId,
      providerReference: request.providerReference,
      reconciliationEvent: {
        provider: this.providerId,
        transactionId: request.transactionId,
        providerReference: request.providerReference,
        status: "refunded",
        amount: request.amount,
        currency: request.currency,
        reason: request.reason,
        rawPayload: {
          provider_reference: request.providerReference,
          simulated: true,
          refund_reason: request.reason ?? null,
        },
      },
      rawResponse: {
        refunded: true,
        provider_reference: request.providerReference,
      },
    };
  }
}

export const simulatedBillsPartner = new SimulatedBillsPartner();
