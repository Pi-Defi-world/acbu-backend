/**
 * Standalone route schema definitions for OpenAPI drift testing.
 *
 * This file intentionally defines schemas inline (duplicating what's in each
 * controller) so the drift test can import them without loading the full
 * application stack (services, Prisma client, logger, etc.).
 *
 * When you update a Zod schema in a controller, update the corresponding
 * entry here too so the drift test stays accurate.
 */

import { z } from "zod";

// ─── Auth ────────────────────────────────────────────────────────────────────
export const signupSchema = z.object({
  username: z.string().min(1).max(64),
  passcode: z.string().min(8).max(64),
});

export const signinSchema = z.object({
  identifier: z.string().min(1),
  passcode: z.string().min(1),
  captcha_token: z.string().optional(),
  issue_refresh_token: z.boolean().optional(),
});

export const verify2faSchema = z.object({
  challenge_token: z.string().min(1),
  code: z.string().min(1),
  issue_refresh_token: z.boolean().optional(),
});

// ─── Transfers ───────────────────────────────────────────────────────────────
export const createTransferSchema = z.object({
  to: z.string().min(1),
  amount_acbu: z.string().min(1),
  blockchain_tx_hash: z.string().optional(),
});

export const getTransfersQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// ─── Transactions ─────────────────────────────────────────────────────────────
export const listTransactionsQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// ─── Users ────────────────────────────────────────────────────────────────────
export const patchMeSchema = z.object({
  username: z.string().min(1).max(64).optional(),
  email: z.string().optional().nullable(),
  phone_e164: z.string().optional().nullable(),
  privacy_hide_from_search: z.boolean().optional(),
  passcode: z.string().min(8).max(64).optional(),
});

export const addContactSchema = z.object({
  contact_user_id: z.string().uuid(),
});

export const addGuardianSchema = z.object({
  guardian_user_id: z.string().uuid().optional(),
  guardian_email: z.string().optional(),
  guardian_phone: z.string().optional(),
});

export const walletConfirmSchema = z.object({
  encryption_method: z.enum(["passcode"]),
  passcode: z.string().min(1),
  passphrase: z.string().min(1),
});

// ─── Fiat ─────────────────────────────────────────────────────────────────────
export const faucetSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  recipient: z.string().optional(),
  passcode: z.string().optional(),
});

export const onRampSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  passcode: z.string().optional(),
});

export const offRampSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  blockchain_tx_hash: z.string().optional(),
});

// ─── Mint ─────────────────────────────────────────────────────────────────────
export const usdcBodySchema = z.object({
  usdc_amount: z.string().min(1),
  wallet_address: z.string().min(1),
  currency_preference: z.string().optional(),
});

export const depositBodySchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.string().min(1),
  wallet_address: z.string().min(1),
  fintech_tx_id: z.string().optional(),
});

// ─── Burn ─────────────────────────────────────────────────────────────────────
export const burnBodySchema = z.object({
  acbu_amount: z.string().min(1),
  currency: z.string().min(3).max(3),
  recipient_account: z.object({
    type: z.string().optional(),
    account_number: z.string().min(1),
    bank_code: z.string().min(1),
    account_name: z.string().min(1),
  }),
  blockchain_tx_hash: z.string().optional(),
});

// ─── Recovery ────────────────────────────────────────────────────────────────
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

// ─── Salary ───────────────────────────────────────────────────────────────────
export const postSalaryDisburseSchema = z.object({
  organization_id: z.string().uuid().optional(),
  total_amount: z.string().optional(),
  currency: z.string().default("ACBU"),
  idempotency_key: z.string().optional(),
  items: z
    .array(
      z.object({
        recipient_id: z.string().uuid().optional(),
        recipient_address: z.string().min(56).max(56),
        amount: z.string(),
      }),
    )
    .min(1),
});

export const postSalaryScheduleSchema = z.object({
  organization_id: z.string().uuid().optional(),
  name: z.string().min(1),
  cron: z.string().min(1),
  currency: z.string().default("ACBU"),
  amount_config: z
    .array(
      z.object({
        recipient_id: z.string().uuid().optional(),
        recipient_address: z.string().min(56).max(56),
        amount: z.string(),
      }),
    )
    .min(1),
});

// ─── Investment ───────────────────────────────────────────────────────────────
export const investmentRequestSchema = z.object({
  amount_acbu: z.string().min(1),
  audience: z.enum(["retail", "business"]),
  forced_removal: z.boolean().optional(),
});

export const getWithdrawRequestsQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  status: z.string().optional(),
});

// ─── Onramp ───────────────────────────────────────────────────────────────────
export const onrampBodySchema = z.object({
  stellar_address: z.string().min(56).max(56),
  xlm_amount: z.string().min(1),
  usdc_amount: z.string().optional(),
});

// ─── Route → Schema registry ─────────────────────────────────────────────────
export const routeSchemas: Record<string, z.ZodSchema> = {
  // Auth endpoints
  "POST /v1/auth/signup": signupSchema,
  "POST /v1/auth/signin": signinSchema,
  "POST /v1/auth/signin/verify-2fa": verify2faSchema,
  "POST /v1/auth/signout": z.object({}),

  // Transfer endpoints
  "POST /v1/transfers": createTransferSchema,
  "GET /v1/transfers": getTransfersQuerySchema,

  // Transaction endpoints
  "GET /v1/transactions": listTransactionsQuerySchema,

  // User endpoints
  "PATCH /v1/users/me": patchMeSchema,
  "POST /v1/users/me/contacts": addContactSchema,
  "POST /v1/users/me/guardians": addGuardianSchema,
  "POST /v1/users/me/wallet/confirm": walletConfirmSchema,

  // Fiat endpoints
  "POST /v1/fiat/faucet": faucetSchema,
  "POST /v1/fiat/onramp": onRampSchema,
  "POST /v1/fiat/offramp": offRampSchema,

  // Mint endpoints
  "POST /v1/mint/usdc": usdcBodySchema,
  "POST /v1/mint/deposit": depositBodySchema,

  // Burn endpoints
  "POST /v1/burn/acbu": burnBodySchema,

  // Recovery endpoints
  "POST /v1/recovery/unlock": unlockAppSchema,
  "POST /v1/recovery/unlock/verify": verifyRecoveryOtpSchema,

  // Salary endpoints
  "POST /v1/salary/disburse": postSalaryDisburseSchema,
  "POST /v1/salary/schedule": postSalaryScheduleSchema,

  // Investment endpoints
  "POST /v1/investment/withdraw/request": investmentRequestSchema,
  "GET /v1/investment/withdraw/requests": getWithdrawRequestsQuerySchema,

  // Onramp endpoints
  "POST /v1/onramp/register": onrampBodySchema,
};
