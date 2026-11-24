/**
 * API request/response types (snake_case to match backend).
 */

/** Error thrown by the API client for an unsuccessful HTTP response. */
export interface ApiError extends Error {
  status?: number;
  details?: unknown;
}

/** Error payload returned by the backend before it is converted to an ApiError. */
export type ApiErrorResponse = Partial<Pick<ApiError, 'message' | 'status' | 'details'>>;

/** A recovery action presented to the user alongside a mapped API error. */
export interface UIErrorAction {
  label: string;
  href?: string;
  onClick?: () => void;
  disableSubmitFor?: number;
}

/** A user-facing representation of an API error. */
export interface UIError {
  message: string;
  action?: UIErrorAction;
}

// Auth
export interface SigninResponse {
  api_key?: string; // Deprecated: now returned via httpOnly cookie only
  user_id: string;
  stellar_address?: string | null;
  wallet_created?: boolean;
  encryption_method_required?: boolean;
}

export interface SigninRequires2FA {
  requires_2fa: true;
  challenge_token: string;
}

// User
export interface UserMe {
  user_id: string;
  username?: string;
  email?: string;
  phone_e164?: string;
  email_verified_at?: string;
  phone_verified_at?: string;
  privacy_hide_from_search?: boolean;
  kyc_status?: string;
  country_code?: string;
  created_at: string;
}

export interface PatchMeBody {
  username?: string;
  email?: string | null;
  phone_e164?: string | null;
  privacy_hide_from_search?: boolean;
  passcode?: string;
}

export interface ReceiveResponse {
  pay_uri?: string;
  alias?: string;
  [key: string]: unknown;
}

// Balance
export interface BalanceResponse {
  balance: string | number;
  currency?: string;
  stellar_address?: string | null;
  /** On-chain ACBU (Horizon). */
  balance_stellar?: string;
  /** Completed mints minus burns in app DB (MVP when Soroban mint fails). */
  balance_app_ledger?: string;
  /** "stellar" | "app_ledger" | "none" — which source drives `balance` when chain is zero. */
  balance_source?: string;
}

// Contacts & guardians
export interface ContactItem {
  id: string;
  alias?: string;
  pay_uri?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface GuardianItem {
  id: string;
  [key: string]: unknown;
}

// Transfers
export interface TransferItem {
  transaction_id: string;
  type?: string;
  status: string;
  amount_acbu: string | null;
  local_currency?: string | null;
  local_amount?: string | null;
  recipient_address: string | null;
  blockchain_tx_hash?: string;
  note?: string;
  created_at: string;
  completed_at?: string;
}

export interface TransfersListResponse {
  transfers: TransferItem[];
}

export interface CreateTransferBody {
  to: string;
  amount_acbu: string;
  note?: string;
  blockchain_tx_hash?: string;
}

export interface CreateTransferResponse {
  transaction_id: string;
  status: string;
}

// Transactions
export interface TransactionDetail {
  transaction_id: string;
  type: string;
  status: string;
  amount_acbu?: string | null;
  usdc_amount?: string | null;
  local_amount?: string | null;
  currency?: string;
  note?: string;
  created_at: string;
  completed_at?: string;
  blockchain_tx_hash?: string;
  [key: string]: unknown;
}

export interface TransactionListItem {
  transaction_id: string;
  type: string;
  status: string;
  usdc_amount?: string | null;
  amount_acbu?: string | null;
  acbu_amount_burned?: string | null;
  local_currency?: string | null;
  local_amount?: string | null;
  recipient_address?: string | null;
  fee?: string | null;
  blockchain_tx_hash?: string;
  confirmations?: number | null;
  created_at: string;
  completed_at?: string;
}

export interface TransactionsListResponse {
  transactions: TransactionListItem[];
  next_cursor?: string | null;
}

export type CurrencyPreference = "auto" | "usdc" | "usdc-polygon";

export interface MintFromUsdcBody {
  usdc_amount: string;
  wallet_address: string;
  currency_preference?: CurrencyPreference;
}

export interface MintResponse {
  transaction_id: string;
  acbu_amount: string | null;
  usdc_amount: string;
  fee: string;
  rate: { acbu_usd: number | null; timestamp: string };
  status: string;
  estimated_completion?: string | null;
  blockchain_tx_hash?: string;
}

// Onramp
export interface OnRampRegisterBody {
  [key: string]: unknown;
}

export interface OnRampRegisterResponse {
  [key: string]: unknown;
}

// Burn
export interface BurnRecipientAccount {
  type?: "bank" | "mobile_money";
  account_number: string;
  bank_code: string;
  account_name: string;
}

export interface BurnAcbuBody {
  acbu_amount: string;
  currency: string;
  recipient_account: BurnRecipientAccount;
  blockchain_tx_hash?: string;
}

export interface BurnResponse {
  transaction_id: string;
  acbu_amount: string;
  local_amount: string | null;
  currency: string;
  fee: string;
  rate: { acbu_ngn: number | null; timestamp: string };
  status: string;
  estimated_completion?: string | null;
  blockchain_tx_hash?: string;
}

// Rates
export interface RatesResponse {
  acbu_usd?: string | null;
  acbu_eur?: string | null;
  acbu_gbp?: string | null;
  acbu_ngn?: string | null;
  acbu_kes?: string | null;
  acbu_zar?: string | null;
  acbu_rwf?: string | null;
  acbu_ghs?: string | null;
  acbu_egp?: string | null;
  acbu_mad?: string | null;
  acbu_tzs?: string | null;
  acbu_ugx?: string | null;
  acbu_xof?: string | null;
  change_24h_usd?: string | null;
  timestamp?: string;
  [key: string]: unknown;
}

export interface QuoteResponse {
  amount?: number;
  currency?: string;
  acbu_amount?: string;
  fee?: string | number;
  fee_amount?: string | number;
  total_fee?: string | number;
  network_fee?: string | number;
  processing_fee?: string | number;
  local_amount?: string | number;
  receive_amount?: string | number;
  payout_amount?: string | number;
  [key: string]: unknown;
}

// Reserves
export interface ReservesResponse {
  source?: string;
  total_acbu_supply?: string;
  total_reserve_value_usd?: string;
  acbu_usd_rate?: string;
  min_ratio?: number;
  target_ratio?: number;
  effective_ratio?: number | null;
  health?: string;
  weight_law_mode?: "warn_only" | string;
  weight_compliance?: {
    ok: boolean;
    drift_threshold_bps: number;
    warnings: Array<{
      currency: string;
      drift_bps: number;
      target_weight_bps: number;
      actual_weight_bps: number;
    }>;
  };
  currencies?: Array<{
    currency: string;
    amount: string;
    value_usd: string;
    rate_usd: string;
    target_weight_bps: number;
    actual_weight_bps: number;
    drift_bps: number;
    in_range?: boolean;
    drift_warning?: boolean;
  }>;
  [key: string]: unknown;
}

// Savings
export interface SavingsPositionsResponse {
  user: string;
  term_seconds: number | null;
  balance: string | number;
}

export interface SavingsDepositBody {
  user: string;
  amount: string | number;
  term_seconds: number;
}

export interface SavingsWithdrawBody {
  user: string;
  term_seconds: number;
  amount: string | number;
}

// Savings Goals
export interface SavingsGoal {
  id: string;
  name: string;
  /** Target amount in ACBU */
  target_amount: number;
  /** Current accumulated amount in ACBU */
  current_amount: number;
  /** ISO 8601 date string or human-readable deadline (e.g. "2025-06") */
  deadline: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSavingsGoalBody {
  name: string;
  target_amount: number;
  deadline: string;
}

export interface UpdateSavingsGoalBody {
  name?: string;
  target_amount?: number;
  current_amount?: number;
  deadline?: string;
}

export interface SavingsGoalsListResponse {
  goals: SavingsGoal[];
}

// Lending
export interface LendingBalanceResponse {
  lender: string;
  balance: string | number;
}

export interface LendingDepositBody {
  lender: string;
  amount: string | number;
}

export interface LendingWithdrawBody {
  lender: string;
  amount: string | number;
}
export interface ApplyLoanBody {
  productId: string;
  amount: number;
  term: number;
}

// Recipient
export interface RecipientResponse {
  resolved?: boolean;
  pay_uri?: string;
  alias?: string;
  [key: string]: unknown;
}

// Recovery (no API key)
export interface RecoveryUnlockBody {
  recovery_code?: string;
  guardian_approvals?: unknown[];
  [key: string]: unknown;
}

// KYC
export interface KycApplication {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface KycApplicationsResponse {
  applications?: KycApplication[];
}

// Gateway, Bills – generic for stubs
export interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: unknown;
}
