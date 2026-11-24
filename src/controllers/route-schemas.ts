/**
 * Standalone request/query schemas for OpenAPI generation and drift testing.
 *
 * Keep these definitions aligned with the Zod schemas used by the controllers.
 * The OpenAPI generator and tests import this file instead of the application
 * stack so they can run without database or environment setup.
 */

import { z, ZodSchema } from "zod";

const emptySchema = z.object({});

const cursorPaginationQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

const offsetPaginationQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const deviceFingerprintSchema = z
  .object({
    user_agent: z.string().optional(),
    ip: z.string().optional(),
    accept_language: z.string().optional(),
    accept_encoding: z.string().optional(),
    timezone: z.string().optional(),
    screen_resolution: z.string().optional(),
    platform: z.string().optional(),
  })
  .optional();

// ─── Auth ────────────────────────────────────────────────────────────────────
export const signupSchema = z.object({
  username: z.string().min(1).max(64),
  passcode: z.string().min(8).max(64),
});

export const signinSchema = z.object({
  identifier: z.string().min(1).max(320),
  passcode: z.string().min(1),
  captcha_token: z.string().optional(),
  issue_refresh_token: z.boolean().optional(),
});

export const verify2faSchema = z.object({
  challenge_token: z.string().min(1),
  code: z.string().min(1),
  issue_refresh_token: z.boolean().optional(),
});

export const issueAdminKeySchema = z.object({
  challenge_token: z.string().min(1),
  code: z.string().min(1),
  permissions: z.array(z.string()).min(1),
  reason: z.string().min(1).max(255),
});

export const issueBreakGlassKeySchema = z.object({
  challenge_token: z.string().min(1),
  code: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  reason: z.string().min(1).max(255),
  ttl_minutes: z.number().int().min(1).max(60).optional(),
});

export const revokePrivilegedKeySchema = z.object({
  reason: z.string().min(1).max(255),
});

export const refreshAccessTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export const revokeRefreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

// ─── Recipient ───────────────────────────────────────────────────────────────
export const recipientQuerySchema = z.object({
  q: z.string().min(1),
});

// ─── Transfers ───────────────────────────────────────────────────────────────
export const createTransferSchema = z.object({
  to: z.string().min(1),
  amount_acbu: z.string().min(1),
  blockchain_tx_hash: z.string().optional(),
});

export const getTransfersQuerySchema = cursorPaginationQuerySchema;

// ─── Transactions ────────────────────────────────────────────────────────────
export const listTransactionsQuerySchema = cursorPaginationQuerySchema;

// ─── Users ───────────────────────────────────────────────────────────────────
export const patchMeSchema = z.object({
  username: z.string().min(1).max(64).optional(),
  email: z.string().email().max(255).optional().nullable(),
  phone_e164: z.string().optional().nullable(),
  privacy_hide_from_search: z.boolean().optional(),
  current_passcode: z.string().min(1).max(64).optional(),
  passcode: z.string().min(8).max(64).optional(),
});

export const addContactSchema = z.object({
  contact_user_id: z.string().uuid(),
});

export const addGuardianSchema = z.object({
  guardian_user_id: z.string().uuid().optional(),
  guardian_email: z.string().email().max(255).optional(),
  guardian_phone: z.string().optional(),
});

export const walletEnrollSchema = z.object({
  stellar_address: z.string().length(56),
  wrapped_key: z.string().min(1).max(512).optional(),
  wrap_algorithm: z.string().min(1).max(64).optional(),
  wrap_kdf: z.string().min(1).max(64).optional(),
});

export const walletAddressSchema = z.object({
  stellar_address: z.string().length(56),
});

// ─── Recovery ────────────────────────────────────────────────────────────────
export const unlockAppSchema = z.object({
  identifier: z.string().min(1),
  passcode: z.string().min(1),
  device_fingerprint: deviceFingerprintSchema,
});

export const verifyRecoveryOtpSchema = z.object({
  challenge_token: z.string().min(1),
  code: z.string().min(1),
  device_fingerprint: deviceFingerprintSchema,
  trust_device: z.boolean().optional(),
});

// ─── Mint ────────────────────────────────────────────────────────────────────
export const usdcBodySchema = z.object({
  usdc_amount: z.string().min(1),
  wallet_address: z.string().length(56),
  currency_preference: z.enum(["auto"]).optional(),
});

export const depositBodySchema = z.object({
  currency: z.string().length(3),
  amount: z.string().min(1),
  wallet_address: z.string().length(56),
  fintech_tx_id: z.string().min(1).max(255).optional(),
});

export const mintConfirmBodySchema = z.object({
  transaction_id: z.string().min(1),
  partner_reference: z.string().min(1).max(255),
  amount: z.string().min(1),
  currency: z.string().length(3),
  confirmed_at: z.coerce.number().int().positive(),
});

// ─── Burn ────────────────────────────────────────────────────────────────────
export const burnBodySchema = z.object({
  acbu_amount: z.string().min(1),
  currency: z.enum(["NGN", "KES", "RWF"]),
});

// ─── Rates ───────────────────────────────────────────────────────────────────
export const ratesQuoteQuerySchema = z.object({
  amount: z.string().optional(),
});

// ─── Salary ──────────────────────────────────────────────────────────────────
const salaryItemSchema = z.object({
  recipient_id: z.string().uuid().optional(),
  recipient_address: z.string().min(56).max(56),
  amount: z.string(),
});

export const postSalaryDisburseSchema = z.object({
  organization_id: z.string().uuid().optional(),
  total_amount: z.string().optional(),
  currency: z.string().default("ACBU"),
  idempotency_key: z.string().optional(),
  items: z.array(salaryItemSchema).min(1),
});

export const postSalaryScheduleSchema = z.object({
  organization_id: z.string().uuid().optional(),
  name: z.string().min(1),
  cron: z.string().min(1),
  currency: z.string().default("ACBU"),
  amount_config: z.array(salaryItemSchema).min(1),
});

// ─── Savings ─────────────────────────────────────────────────────────────────
const savingsTermSchema = z.coerce.number().int().positive();

export const savingsDepositSchema = z.object({
  amount: z.string().min(1),
  term_seconds: savingsTermSchema,
});

export const savingsWithdrawSchema = savingsDepositSchema;

export const savingsPositionsQuerySchema = z.object({
  term_seconds: savingsTermSchema.optional(),
});

// ─── Lending ─────────────────────────────────────────────────────────────────
export const lendingBodySchema = z.object({
  lender: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
});

export const lendingBalanceQuerySchema = z.object({
  lender: z.string().min(1),
});

export const lendingBorrowSchema = z.object({
  borrower: z.string().min(1),
  lender: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  collateralAmount: z.union([z.string(), z.number()]),
  loanId: z.union([z.string(), z.number()]),
});

export const lendingRepaySchema = z.object({
  borrower: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  loanId: z.union([z.string(), z.number()]),
});

export const lendingLiquidateSchema = z.object({
  liquidator: z.string().min(1),
  borrower: z.string().min(1),
  loanId: z.union([z.string(), z.number()]),
});

// ─── Gateway ─────────────────────────────────────────────────────────────────
export const gatewayChargeSchema = z.object({
  payer: z.string().min(1),
  payee: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  escrow_id: z.union([z.string(), z.number()]),
});

export const gatewayConfirmSchema = z.object({
  escrow_id: z.union([z.string(), z.number()]),
  action: z.enum(["release", "refund"]),
  payer: z.string().min(1).optional(),
});

// ─── Bills ───────────────────────────────────────────────────────────────────
export const billPaymentBodySchema = z.object({
  biller_id: z.string().min(1).max(100),
  product_id: z.string().min(1).max(100),
  customer_reference: z.string().min(5).max(64),
  amount: z.number().positive(),
  metadata: z.record(z.unknown()).optional(),
});

export const billRefundBodySchema = z.object({
  transaction_id: z.string().uuid(),
  reason: z.string().min(3).max(255).optional(),
});

// ─── Onramp ──────────────────────────────────────────────────────────────────
export const onrampBodySchema = z.object({
  stellar_address: z.string().length(56),
  xlm_amount: z.string().min(1),
  usdc_amount: z.string().min(1).optional(),
});

// ─── Government ──────────────────────────────────────────────────────────────
export const governmentStatementsQuerySchema = z.object({
  limit: z.string().optional(),
});

// ─── Investment ──────────────────────────────────────────────────────────────
export const investmentRequestSchema = z.object({
  amount_acbu: z.string().min(1),
  audience: z.enum(["retail", "business"]),
  forced_removal: z.boolean().optional(),
});

export const getWithdrawRequestsQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  status: z.enum(["requested", "available", "completed", "cancelled"]).optional(),
});

// ─── Fiat ────────────────────────────────────────────────────────────────────
export const faucetSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  recipient: z.string().optional(),
});

export const onRampSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
});

export const offRampSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  blockchain_tx_hash: z.string().optional(),
});

// ─── KYC ─────────────────────────────────────────────────────────────────────
export const requestUploadUrlSchema = z.object({
  document_kind: z.enum([
    "passport",
    "national_id",
    "drivers_license",
    "proof_of_address",
    "selfie",
  ]),
  mime_type: z.string().min(1).max(100),
  document_id: z.string().uuid().optional(),
});

export const confirmUploadSchema = z.object({
  checksum: z.string().length(64),
  file_size_bytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});

export const scanWebhookSchema = z.object({
  object_key: z.string().min(1),
  scan_result: z.enum(["clean", "infected"]),
  threat_name: z.string().optional(),
});

export const createRewardSchema = z.object({
  validator_id: z.string().uuid(),
  application_id: z.string().uuid(),
  acbu_amount: z.string().regex(/^[1-9]\d*$/),
  tx_hash: z.string().optional(),
});

// ─── Reports / compliance / privacy ──────────────────────────────────────────
export const reportQuerySchema = z.object({
  limit: z.string().optional(),
  format: z.enum(["json", "csv"]).optional(),
});

export const consentPreferenceSchema = z.object({
  address: z.string().min(1),
  analytics_optout: z.boolean().optional(),
  analyticsOptout: z.boolean().optional(),
  marketing_optout: z.boolean().optional(),
  marketingOptout: z.boolean().optional(),
  sale_optout: z.boolean().optional(),
  saleOptout: z.boolean().optional(),
  biometric_consent: z.boolean().optional(),
  biometricConsent: z.boolean().optional(),
});

// ─── Admin / weight drift audits ─────────────────────────────────────────────
export const weightDriftListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

export const approveWeightDriftAuditSchema = z.object({
  approvalNotes: z.string().optional(),
});

export const rejectWeightDriftAuditSchema = z.object({
  reason: z.string().min(1),
});

export const webhookPayloadSchema = z.record(z.unknown());

// ─── Route → Schema registry ─────────────────────────────────────────────────
export const routeSchemas: Record<string, ZodSchema> = {
  // Health and operational routes
  "GET /v1/health": emptySchema,
  "GET /v1/changelog": emptySchema,
  "GET /v1/health/ready": emptySchema,
  "GET /v1/health/deep": emptySchema,
  "GET /v1/health/metrics": emptySchema,
  "GET /v1/metrics": emptySchema,

  // Auth endpoints
  "POST /v1/auth/signup": signupSchema,
  "POST /v1/auth/signin": signinSchema,
  "POST /v1/auth/signin/verify-2fa": verify2faSchema,
  "POST /v1/auth/signout": emptySchema,
  "POST /v1/auth/admin/challenge": emptySchema,
  "POST /v1/auth/keys/admin": issueAdminKeySchema,
  "POST /v1/auth/keys/break-glass": issueBreakGlassKeySchema,
  "GET /v1/auth/keys/privileged": emptySchema,
  "POST /v1/auth/keys/:id/revoke": revokePrivilegedKeySchema,
  "POST /v1/auth/refresh-token": refreshAccessTokenSchema,
  "POST /v1/auth/refresh-token/revoke": revokeRefreshTokenSchema,

  // Reserves and recipient lookup
  "GET /v1/reserves": emptySchema,
  "POST /v1/reserves/track": emptySchema,
  "GET /v1/recipient": recipientQuerySchema,

  // Transfer endpoints
  "POST /v1/transfers": createTransferSchema,
  "GET /v1/transfers": getTransfersQuerySchema,
  "GET /v1/transfers/:id": emptySchema,

  // Transaction endpoints
  "GET /v1/transactions": listTransactionsQuerySchema,
  "GET /v1/transactions/:id": emptySchema,

  // User endpoints
  "GET /v1/users/me": emptySchema,
  "PATCH /v1/users/me": patchMeSchema,
  "DELETE /v1/users/me": emptySchema,
  "GET /v1/users/me/receive": emptySchema,
  "GET /v1/users/me/receive/qrcode": emptySchema,
  "GET /v1/users/me/balance": emptySchema,
  "GET /v1/users/me/wallet": emptySchema,
  "POST /v1/users/me/wallet/enroll": walletEnrollSchema,
  "POST /v1/users/me/wallet/activate": emptySchema,
  "PUT /v1/users/me/wallet": walletAddressSchema,
  "DELETE /v1/users/me/wallet": emptySchema,
  "POST /v1/users/me/contacts": addContactSchema,
  "GET /v1/users/me/contacts": emptySchema,
  "DELETE /v1/users/me/contacts/:id": emptySchema,
  "POST /v1/users/me/guardians": addGuardianSchema,
  "GET /v1/users/me/guardians": emptySchema,
  "DELETE /v1/users/me/guardians/:id": emptySchema,

  // Recovery endpoints
  "POST /v1/recovery/unlock": unlockAppSchema,
  "POST /v1/recovery/unlock/verify": verifyRecoveryOtpSchema,

  // Mint endpoints
  "POST /v1/mint/usdc": usdcBodySchema,
  "POST /v1/mint/deposit": depositBodySchema,
  "POST /v1/mint/confirm": mintConfirmBodySchema,

  // Burn endpoint
  "POST /v1/burn/acbu": burnBodySchema,

  // Rates endpoints
  "GET /v1/rates": emptySchema,
  "GET /v1/rates/quote": ratesQuoteQuerySchema,
  "GET /v1/rates/basket": emptySchema,

  // Segment transfer endpoints
  "POST /v1/p2p/send": createTransferSchema,
  "GET /v1/p2p/history": getTransfersQuerySchema,
  "GET /v1/p2p/:id": emptySchema,
  "POST /v1/sme/transfers": createTransferSchema,
  "GET /v1/sme/transfers": getTransfersQuerySchema,
  "GET /v1/sme/transfers/:id": emptySchema,
  "GET /v1/sme/statements": getTransfersQuerySchema,

  // International endpoints
  "GET /v1/international/quote": emptySchema,
  "POST /v1/international/mint/usdc": usdcBodySchema,
  "POST /v1/international/mint/deposit": depositBodySchema,
  "POST /v1/international/mint/confirm": mintConfirmBodySchema,
  "POST /v1/international/burn/acbu": burnBodySchema,

  // Salary endpoints
  "POST /v1/salary/disburse": postSalaryDisburseSchema,
  "POST /v1/salary/schedule": postSalaryScheduleSchema,
  "GET /v1/salary/batches": offsetPaginationQuerySchema,
  "GET /v1/salary/schedules": offsetPaginationQuerySchema,

  // Enterprise endpoints
  "POST /v1/enterprise/bulk-transfer": emptySchema,
  "GET /v1/enterprise/treasury": emptySchema,

  // Savings endpoints
  "POST /v1/savings/deposit": savingsDepositSchema,
  "POST /v1/savings/withdraw": savingsWithdrawSchema,
  "GET /v1/savings/positions": savingsPositionsQuerySchema,
  "GET /v1/savings/next-withdrawal-date": emptySchema,

  // Lending endpoints
  "POST /v1/lending/deposit": lendingBodySchema,
  "POST /v1/lending/withdraw": lendingBodySchema,
  "POST /v1/lending/borrow": lendingBorrowSchema,
  "POST /v1/lending/repay": lendingRepaySchema,
  "POST /v1/lending/liquidate": lendingLiquidateSchema,
  "GET /v1/lending/balance": lendingBalanceQuerySchema,

  // Gateway endpoints
  "POST /v1/gateway/charges": gatewayChargeSchema,
  "POST /v1/gateway/confirm": gatewayConfirmSchema,

  // Bills endpoints
  "GET /v1/bills/catalog": emptySchema,
  "POST /v1/bills/pay": billPaymentBodySchema,
  "POST /v1/bills/refund": billRefundBodySchema,

  // Onramp endpoint
  "POST /v1/onramp/register": onrampBodySchema,

  // Audience-specific fund endpoints
  "POST /v1/retail/mint/usdc": usdcBodySchema,
  "POST /v1/retail/mint/deposit": depositBodySchema,
  "POST /v1/retail/burn/acbu": burnBodySchema,
  "POST /v1/business/mint/usdc": usdcBodySchema,
  "POST /v1/business/mint/deposit": depositBodySchema,
  "POST /v1/business/burn/acbu": burnBodySchema,
  "POST /v1/government/mint/usdc": usdcBodySchema,
  "POST /v1/government/mint/deposit": depositBodySchema,
  "POST /v1/government/burn/acbu": burnBodySchema,
  "GET /v1/government/treasury": emptySchema,
  "GET /v1/government/statements": governmentStatementsQuerySchema,

  // Investment endpoints
  "POST /v1/investment/withdraw/request": investmentRequestSchema,
  "GET /v1/investment/withdraw/requests": getWithdrawRequestsQuerySchema,

  // Fiat endpoints
  "POST /v1/fiat/faucet": faucetSchema,
  "POST /v1/fiat/onramp": onRampSchema,
  "POST /v1/fiat/offramp": offRampSchema,
  "GET /v1/fiat/accounts": emptySchema,

  // Config endpoint
  "GET /v1/config/assets": emptySchema,

  // KYC endpoints
  "POST /v1/kyc/scan-webhook": scanWebhookSchema,
  "POST /v1/kyc/documents/upload-url": requestUploadUrlSchema,
  "POST /v1/kyc/documents/:id/confirm": confirmUploadSchema,
  "GET /v1/kyc/documents/:id/download-url": emptySchema,
  "POST /v1/kyc/rewards": createRewardSchema,
  "GET /v1/kyc/validators/:validatorId/rewards": emptySchema,

  // Reports / compliance / privacy
  "GET /v1/reports/transactions": reportQuerySchema,
  "GET /v1/compliance/export": emptySchema,
  "DELETE /v1/compliance/account": emptySchema,
  "PUT /v1/privacy/consent": consentPreferenceSchema,
  "GET /v1/privacy/consent/:address": emptySchema,

  // Admin / weight drift audits
  "GET /v1/admin/weight-drift-audits": weightDriftListQuerySchema,
  "GET /v1/admin/weight-drift-audits/:id": emptySchema,
  "POST /v1/admin/weight-drift-audits": emptySchema,
  "POST /v1/admin/weight-drift-audits/:id/approve": approveWeightDriftAuditSchema,
  "POST /v1/admin/weight-drift-audits/:id/reject": rejectWeightDriftAuditSchema,

  // Provider callbacks
  "POST /v1/webhooks/flutterwave": webhookPayloadSchema,
  "POST /v1/webhooks/paystack": webhookPayloadSchema,
  "POST /v1/webhooks/bills/:provider": webhookPayloadSchema,
};

/**
 * Get schema for a route.
 * @param method HTTP method
 * @param path URL path in Express syntax (`:id`)
 * @returns ZodSchema or undefined if not found
 */
export function getRouteSchema(method: string, path: string): ZodSchema | undefined {
  const key = `${method.toUpperCase()} ${path}`;
  return routeSchemas[key];
}

/**
 * Get all registered route schemas.
 * @returns Array of route schema entries
 */
export function getAllRouteSchemas() {
  return Object.entries(routeSchemas);
}

export default {
  routeSchemas,
  getRouteSchema,
  getAllRouteSchemas,
};
