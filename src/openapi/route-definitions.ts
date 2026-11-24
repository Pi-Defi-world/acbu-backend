import type { HttpMethod } from "./types";

export type RouteAuth = "apiKey" | "adminKey" | "optional" | "none";

export interface HeaderParameterDefinition {
  name: string;
  description: string;
  required?: boolean;
  schema?: Record<string, unknown>;
}

export interface RequestBodyDefinition {
  required?: boolean;
  content: Record<string, unknown>;
}

export interface OpenApiRouteDefinition {
  method: HttpMethod;
  /** Express-style path, e.g. /v1/users/:id */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth?: RouteAuth;
  successStatus?: string;
  successDescription?: string;
  headers?: HeaderParameterDefinition[];
  requestBody?: RequestBodyDefinition;
  pathParameterDescriptions?: Record<string, string>;
}

const idempotencyKey = (required = true): HeaderParameterDefinition => ({
  name: "Idempotency-Key",
  description: required
    ? "Client-generated key used to make this money-moving request idempotent."
    : "Optional client-generated key used to make retries idempotent.",
  required,
  schema: { type: "string", minLength: 1 },
});

const ifMatch = (): HeaderParameterDefinition => ({
  name: "If-Match",
  description: "Current wallet ETag. Required for optimistic concurrency control.",
  required: true,
  schema: { type: "string" },
});

const mintConfirmationHeaders = (): HeaderParameterDefinition[] => [
  {
    name: "x-mint-signature",
    description: "Hex-encoded HMAC-SHA256 signature of the raw request body.",
    required: true,
    schema: { type: "string" },
  },
  {
    name: "x-mint-timestamp",
    description: "Unix timestamp (seconds) used for replay protection.",
    required: true,
    schema: { type: "integer" },
  },
];

const route = (
  method: HttpMethod,
  path: string,
  tag: string,
  summary: string,
  options: Omit<OpenApiRouteDefinition, "method" | "path" | "tag" | "summary"> = {},
): OpenApiRouteDefinition => ({ method, path, tag, summary, ...options });

const bulkTransferRequest: RequestBodyDefinition = {
  required: true,
  content: {
    "text/csv": {
      schema: { type: "string", format: "binary" },
    },
    "multipart/form-data": {
      schema: {
        type: "object",
        required: ["file"],
        properties: {
          file: { type: "string", format: "binary" },
        },
      },
    },
  },
};

const webhookRequest: RequestBodyDefinition = {
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: true },
    },
  },
};

/**
 * Authoritative list of HTTP operations exposed by src/routes.
 *
 * Request and query parameters are derived from routeSchemas. Path parameters
 * are derived from the Express `:param` tokens so the OpenAPI template cannot
 * silently diverge from the mounted route.
 */
export const openApiRoutes: OpenApiRouteDefinition[] = [
  // Health and operational endpoints
  route("get", "/v1/health", "Health", "Shallow health check", {
    auth: "none",
    successDescription: "Service is running",
  }),
  route("get", "/v1/changelog", "Meta", "List API version history", { auth: "none" }),
  route("get", "/v1/health/ready", "Health", "Readiness probe", {
    auth: "none",
    successDescription: "All critical dependencies are ready",
  }),
  route("get", "/v1/health/deep", "Health", "Deep dependency health check", {
    auth: "adminKey",
  }),
  route("get", "/v1/health/metrics", "Health", "Extended health and reserve metrics", {
    auth: "adminKey",
  }),
  route("get", "/v1/metrics", "Health", "Prometheus metrics", {
    auth: "none",
    description:
      "Prometheus-compatible metrics. When METRICS_SCRAPE_TOKEN is configured, callers must send Authorization: Bearer <token>.",
  }),

  // Authentication
  route("post", "/v1/auth/signup", "Authentication", "Create a new user account", {
    auth: "none",
    successStatus: "201",
  }),
  route("post", "/v1/auth/signin", "Authentication", "Sign in", { auth: "none" }),
  route("post", "/v1/auth/signin/verify-2fa", "Authentication", "Verify a 2FA challenge", {
    auth: "none",
  }),
  route("post", "/v1/auth/signout", "Authentication", "Revoke the current API key", {
    successStatus: "204",
    successDescription: "API key revoked",
  }),
  route("post", "/v1/auth/admin/challenge", "Authentication", "Create an admin MFA challenge"),
  route("post", "/v1/auth/keys/admin", "Authentication", "Issue an admin API key", {
    successStatus: "201",
  }),
  route("post", "/v1/auth/keys/break-glass", "Authentication", "Issue a break-glass API key", {
    successStatus: "201",
  }),
  route("get", "/v1/auth/keys/privileged", "Authentication", "List privileged API keys"),
  route("post", "/v1/auth/keys/:id/revoke", "Authentication", "Revoke a privileged API key", {
    pathParameterDescriptions: { id: "Privileged API key ID" },
  }),
  route("post", "/v1/auth/refresh-token", "Authentication", "Refresh an access token", {
    auth: "none",
  }),
  route("post", "/v1/auth/refresh-token/revoke", "Authentication", "Revoke a refresh token", {
    auth: "none",
  }),

  // Reserves and recipient lookup
  route("get", "/v1/reserves", "Reserves", "Get current reserve status"),
  route("post", "/v1/reserves/track", "Reserves", "Trigger reserve tracking"),
  route("get", "/v1/recipient", "Recipient", "Resolve a recipient alias", {
    description: "Resolve @username, phone number, email address, or Stellar address.",
  }),

  // Transfers
  route("post", "/v1/transfers", "Transfers", "Create a transfer", {
    successStatus: "201",
    headers: [idempotencyKey()],
  }),
  route("get", "/v1/transfers", "Transfers", "List transfers"),
  route("get", "/v1/transfers/:id", "Transfers", "Get a transfer by ID", {
    pathParameterDescriptions: { id: "Transfer transaction ID" },
  }),

  // Transactions
  route("get", "/v1/transactions", "Transactions", "List transactions"),
  route("get", "/v1/transactions/:id", "Transactions", "Get a transaction by ID", {
    pathParameterDescriptions: { id: "Transaction ID" },
  }),

  // Users
  route("get", "/v1/users/me", "Users", "Get the current user's profile"),
  route("patch", "/v1/users/me", "Users", "Update the current user's profile"),
  route("delete", "/v1/users/me", "Users", "Delete the current user's account", {
    successStatus: "204",
    successDescription: "Account deleted",
  }),
  route("get", "/v1/users/me/receive", "Users", "Get receive alias and payment URI"),
  route("get", "/v1/users/me/receive/qrcode", "Users", "Get a receive QR code"),
  route("get", "/v1/users/me/balance", "Users", "Get wallet balances"),
  route("get", "/v1/users/me/wallet", "Users", "Get wallet state and ETag"),
  route("post", "/v1/users/me/wallet/enroll", "Users", "Enroll a client-generated wallet", {
    headers: [ifMatch()],
  }),
  route("post", "/v1/users/me/wallet/activate", "Users", "Activate the wallet on-chain", {
    headers: [ifMatch()],
  }),
  route("put", "/v1/users/me/wallet", "Users", "Replace the wallet address", {
    headers: [ifMatch()],
  }),
  route("delete", "/v1/users/me/wallet", "Users", "Detach the wallet", {
    headers: [ifMatch()],
  }),
  route("post", "/v1/users/me/contacts", "Users", "Add a contact", { successStatus: "201" }),
  route("get", "/v1/users/me/contacts", "Users", "List contacts"),
  route("delete", "/v1/users/me/contacts/:id", "Users", "Remove a contact", {
    successStatus: "204",
    successDescription: "Contact removed",
    pathParameterDescriptions: { id: "Contact ID" },
  }),
  route("post", "/v1/users/me/guardians", "Users", "Add a recovery guardian", {
    successStatus: "201",
  }),
  route("get", "/v1/users/me/guardians", "Users", "List recovery guardians"),
  route("delete", "/v1/users/me/guardians/:id", "Users", "Remove a recovery guardian", {
    successStatus: "204",
    successDescription: "Guardian removed",
    pathParameterDescriptions: { id: "Guardian ID" },
  }),

  // Recovery
  route("post", "/v1/recovery/unlock", "Recovery", "Start account recovery"),
  route("post", "/v1/recovery/unlock/verify", "Recovery", "Verify a recovery OTP"),

  // Mint and burn
  route("post", "/v1/mint/usdc", "Mint", "Mint ACBU from USDC", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route("post", "/v1/mint/deposit", "Mint", "Deposit basket currency to mint ACBU", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route("post", "/v1/mint/confirm", "Mint", "Confirm a partner mint", {
    auth: "none",
    headers: mintConfirmationHeaders(),
  }),
  route("post", "/v1/burn/acbu", "Burn", "Burn ACBU for local currency", {
    headers: [idempotencyKey()],
  }),

  // Rates
  route("get", "/v1/rates", "Rates", "Get current ACBU rates"),
  route("get", "/v1/rates/quote", "Rates", "Quote an ACBU amount"),
  route("get", "/v1/rates/basket", "Rates", "Get basket-equivalent local amounts"),

  // Segment transfer endpoints
  route("post", "/v1/p2p/send", "P2P", "Send a P2P transfer", {
    successStatus: "201",
    headers: [idempotencyKey()],
  }),
  route("get", "/v1/p2p/history", "P2P", "List P2P transfer history"),
  route("get", "/v1/p2p/:id", "P2P", "Get a P2P transfer by ID", {
    pathParameterDescriptions: { id: "Transfer transaction ID" },
  }),
  route("post", "/v1/sme/transfers", "SME", "Create an SME transfer", {
    successStatus: "201",
    headers: [idempotencyKey()],
  }),
  route("get", "/v1/sme/transfers", "SME", "List SME transfers"),
  route("get", "/v1/sme/transfers/:id", "SME", "Get an SME transfer by ID", {
    pathParameterDescriptions: { id: "Transfer transaction ID" },
  }),
  route("get", "/v1/sme/statements", "SME", "List SME statements"),

  // International
  route("get", "/v1/international/quote", "International", "Get an international quote"),
  route("post", "/v1/international/mint/usdc", "International", "Mint from USDC", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route("post", "/v1/international/mint/deposit", "International", "Mint from basket currency", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route("post", "/v1/international/mint/confirm", "International", "Confirm a partner mint", {
    auth: "none",
    headers: mintConfirmationHeaders(),
  }),
  route("post", "/v1/international/burn/acbu", "International", "Burn ACBU for local currency", {
    headers: [idempotencyKey()],
  }),

  // Salary
  route("post", "/v1/salary/disburse", "Salary", "Create a salary disbursement batch", {
    successStatus: "201",
  }),
  route("post", "/v1/salary/schedule", "Salary", "Create a recurring salary schedule", {
    successStatus: "201",
  }),
  route("get", "/v1/salary/batches", "Salary", "List salary batches"),
  route("get", "/v1/salary/schedules", "Salary", "List salary schedules"),

  // Enterprise
  route("post", "/v1/enterprise/bulk-transfer", "Enterprise", "Upload a bulk transfer CSV", {
    requestBody: bulkTransferRequest,
  }),
  route("get", "/v1/enterprise/treasury", "Enterprise", "Get enterprise treasury data"),

  // Savings
  route("post", "/v1/savings/deposit", "Savings", "Deposit into savings"),
  route("post", "/v1/savings/withdraw", "Savings", "Withdraw from savings"),
  route("get", "/v1/savings/positions", "Savings", "List savings positions"),
  route("get", "/v1/savings/next-withdrawal-date", "Savings", "Get the next withdrawal date"),

  // Lending
  route("post", "/v1/lending/deposit", "Lending", "Deposit into the lending pool"),
  route("post", "/v1/lending/withdraw", "Lending", "Withdraw from the lending pool"),
  route("get", "/v1/lending/balance", "Lending", "Get a lending pool balance"),
  route("post", "/v1/lending/borrow", "Lending", "Borrow from the lending pool"),
  route("post", "/v1/lending/repay", "Lending", "Repay a lending loan"),
  route("post", "/v1/lending/liquidate", "Lending", "Liquidate an unhealthy lending loan"),

  // Gateway
  route("post", "/v1/gateway/charges", "Gateway", "Create an escrow charge"),
  route("post", "/v1/gateway/confirm", "Gateway", "Release or refund an escrow charge"),

  // Bills
  route("get", "/v1/bills/catalog", "Bills", "List the bills catalog"),
  route("post", "/v1/bills/pay", "Bills", "Pay a bill", { successStatus: "201" }),
  route("post", "/v1/bills/refund", "Bills", "Refund a bill payment"),

  // On-ramp
  route("post", "/v1/onramp/register", "Onramp", "Register a USDC to XLM swap", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),

  // Audience-specific fund endpoints
  route("post", "/v1/retail/mint/usdc", "Retail", "Mint ACBU from USDC for retail", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route("post", "/v1/retail/mint/deposit", "Retail", "Mint ACBU from basket currency for retail", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route("post", "/v1/retail/burn/acbu", "Retail", "Burn ACBU for retail", {
    headers: [idempotencyKey()],
  }),
  route("post", "/v1/business/mint/usdc", "Business", "Mint ACBU from USDC for business", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route(
    "post",
    "/v1/business/mint/deposit",
    "Business",
    "Mint ACBU from basket currency for business",
    { successStatus: "202", headers: [idempotencyKey(false)] },
  ),
  route("post", "/v1/business/burn/acbu", "Business", "Burn ACBU for business", {
    headers: [idempotencyKey()],
  }),
  route("post", "/v1/government/mint/usdc", "Government", "Mint ACBU from USDC for government", {
    successStatus: "202",
    headers: [idempotencyKey(false)],
  }),
  route(
    "post",
    "/v1/government/mint/deposit",
    "Government",
    "Mint ACBU from basket currency for government",
    { successStatus: "202", headers: [idempotencyKey(false)] },
  ),
  route("post", "/v1/government/burn/acbu", "Government", "Burn ACBU for government", {
    headers: [idempotencyKey()],
  }),
  route("get", "/v1/government/treasury", "Government", "Get government treasury data"),
  route("get", "/v1/government/statements", "Government", "List government statements"),

  // Investment
  route(
    "post",
    "/v1/investment/withdraw/request",
    "Investment",
    "Request an investment withdrawal",
    { successStatus: "202" },
  ),
  route(
    "get",
    "/v1/investment/withdraw/requests",
    "Investment",
    "List investment withdrawal requests",
  ),

  // Fiat
  route("post", "/v1/fiat/faucet", "Fiat", "Request test currency from the faucet"),
  route("post", "/v1/fiat/onramp", "Fiat", "Simulate a fiat on-ramp"),
  route("post", "/v1/fiat/offramp", "Fiat", "Simulate a fiat off-ramp"),
  route("get", "/v1/fiat/accounts", "Fiat", "List fiat accounts"),

  // Config
  route("get", "/v1/config/assets", "Config", "Get public asset configuration", {
    auth: "optional",
    description: "Authenticated callers receive additional infrastructure configuration.",
  }),

  // KYC
  route("post", "/v1/kyc/scan-webhook", "KYC", "Process a document scan callback", {
    auth: "none",
    headers: [
      {
        name: "x-scan-signature",
        description: "HMAC-SHA256 signature of the raw scan callback payload.",
        required: true,
        schema: { type: "string" },
      },
    ],
  }),
  route("post", "/v1/kyc/documents/upload-url", "KYC", "Request a presigned document upload URL"),
  route("post", "/v1/kyc/documents/:id/confirm", "KYC", "Confirm a document upload", {
    pathParameterDescriptions: { id: "KYC document ID" },
  }),
  route(
    "get",
    "/v1/kyc/documents/:id/download-url",
    "KYC",
    "Request a presigned document download URL",
    { pathParameterDescriptions: { id: "KYC document ID" } },
  ),
  route("post", "/v1/kyc/rewards", "KYC", "Create a validator reward", {
    successStatus: "201",
  }),
  route("get", "/v1/kyc/validators/:validatorId/rewards", "KYC", "List validator rewards", {
    pathParameterDescriptions: { validatorId: "Validator ID" },
  }),

  // Reports, compliance, privacy
  route("get", "/v1/reports/transactions", "Reports", "Export transaction statements"),
  route("get", "/v1/compliance/export", "Compliance", "Export the current user's data"),
  route("delete", "/v1/compliance/account", "Compliance", "Delete the current user's account", {
    successStatus: "204",
    successDescription: "Account deleted",
  }),
  route("put", "/v1/privacy/consent", "Privacy", "Update consent preferences"),
  route("get", "/v1/privacy/consent/:address", "Privacy", "Get consent preferences", {
    pathParameterDescriptions: { address: "Stellar address or address hash" },
  }),

  // Admin weight drift audits
  route("get", "/v1/admin/weight-drift-audits", "Admin", "List weight drift audits", {
    auth: "adminKey",
  }),
  route("get", "/v1/admin/weight-drift-audits/:id", "Admin", "Get a weight drift audit", {
    auth: "adminKey",
    pathParameterDescriptions: { id: "Weight drift audit ID" },
  }),
  route("post", "/v1/admin/weight-drift-audits", "Admin", "Trigger a weight drift audit", {
    auth: "adminKey",
    successStatus: "201",
  }),
  route(
    "post",
    "/v1/admin/weight-drift-audits/:id/approve",
    "Admin",
    "Approve a weight drift audit",
    {
      auth: "adminKey",
      pathParameterDescriptions: { id: "Weight drift audit ID" },
    },
  ),
  route(
    "post",
    "/v1/admin/weight-drift-audits/:id/reject",
    "Admin",
    "Reject a weight drift audit",
    {
      auth: "adminKey",
      pathParameterDescriptions: { id: "Weight drift audit ID" },
    },
  ),

  // Provider callbacks
  route("post", "/v1/webhooks/flutterwave", "Webhooks", "Handle a Flutterwave webhook", {
    auth: "none",
    requestBody: webhookRequest,
  }),
  route("post", "/v1/webhooks/paystack", "Webhooks", "Handle a Paystack webhook", {
    auth: "none",
    requestBody: webhookRequest,
  }),
  route("post", "/v1/webhooks/bills/:provider", "Webhooks", "Handle a bills provider webhook", {
    auth: "none",
    requestBody: webhookRequest,
    pathParameterDescriptions: { provider: "Bills provider name" },
  }),
];

export function getOpenApiRouteKey(routeDefinition: OpenApiRouteDefinition): string {
  return `${routeDefinition.method.toUpperCase()} ${routeDefinition.path}`;
}
