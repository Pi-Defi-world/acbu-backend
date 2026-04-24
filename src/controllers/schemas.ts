/**
 * Central registry of all Zod validation schemas for API endpoints
 * This file exports all schemas used for request validation across controllers
 * and provides a mapping for OpenAPI drift testing
 */

import { ZodSchema } from "zod";

// Auth Controller
import {
  signinSchema,
  signupSchema,
  verify2faSchema,
} from "./authController";

// Transfer Controller
import {
  createTransferSchema,
  getTransfersQuerySchema,
} from "./transferController";

// Transaction Controller
import {
  listTransactionsQuerySchema,
} from "./transactionController";

// User Controller
import {
  patchMeSchema,
  addContactSchema,
  addGuardianSchema,
  walletConfirmSchema,
} from "./userController";

// Fiat Controller
import {
  faucetSchema,
  onRampSchema,
  offRampSchema,
} from "./fiatController";

// Mint Controller
import {
  usdcBodySchema,
  depositBodySchema,
} from "./mintController";

// Burn Controller
import { bodySchema as burnBodySchema } from "./burnController";

// Recovery Controller
import {
  unlockAppSchema,
  verifyRecoveryOtpSchema,
} from "./recoveryController";

// Salary Controller
import {
  postSalaryDisburseSchema,
  postSalaryScheduleSchema,
} from "./salaryController";

// Investment Controller
import {
  requestSchema as investmentRequestSchema,
  getWithdrawRequestsQuerySchema,
} from "./investmentController";

// Onramp Controller
import { bodySchema as onrampBodySchema } from "./onrampController";

/**
 * Route-to-Schema Mapping for OpenAPI Validation
 * Format: "METHOD /path" => ZodSchema
 * Used by openapi-drift.test.ts to validate that:
 * 1. All fields documented in Swagger exist in schemas
 * 2. All required fields are properly typed
 * 3. Response schemas match what's actually returned
 */
export const routeSchemas: Record<string, ZodSchema> = {
  // Auth endpoints
  "POST /v1/auth/signup": signupSchema,
  "POST /v1/auth/signin": signinSchema,
  "POST /v1/auth/signin/verify-2fa": verify2faSchema,
  "POST /v1/auth/signout": signinSchema, // Requires auth but no body schema

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
  "POST /v1/burn": burnBodySchema,

  // Recovery endpoints
  "POST /v1/recovery/unlock": unlockAppSchema,
  "POST /v1/recovery/verify": verifyRecoveryOtpSchema,

  // Salary endpoints
  "POST /v1/salary/disburse": postSalaryDisburseSchema,
  "POST /v1/salary/schedule": postSalaryScheduleSchema,

  // Investment endpoints
  "POST /v1/investment/request": investmentRequestSchema,
  "GET /v1/investment/withdraw-requests": getWithdrawRequestsQuerySchema,

  // Onramp endpoints
  "POST /v1/onramp": onrampBodySchema,
};

/**
 * Get schema for a route
 * @param method HTTP method
 * @param path URL path
 * @returns ZodSchema or undefined if not found
 */
export function getRouteSchema(method: string, path: string): ZodSchema | undefined {
  const key = `${method.toUpperCase()} ${path}`;
  return routeSchemas[key];
}

/**
 * Get all registered route schemas
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
