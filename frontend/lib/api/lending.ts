import { get, post } from './client';
import type { RequestOptions } from './client';
import type {
  LendingBalanceResponse,
  LendingDepositBody,
  LendingWithdrawBody,
  ApplyLoanBody
} from '@/types/api';

export async function getLendingBalance(
  lender: string,
  opts?: RequestOptions
): Promise<LendingBalanceResponse> {
  return get<LendingBalanceResponse>(`/lending/balance?lender=${encodeURIComponent(lender)}`, opts);
}

export async function lendingDeposit(
  body: LendingDepositBody,
  opts?: RequestOptions
): Promise<{ transaction_hash: string; new_balance: string | number }> {
  return post('/lending/deposit', body, opts);
}

export async function lendingWithdraw(
  body: LendingWithdrawBody,
  opts?: RequestOptions
): Promise<{ transaction_hash: string }> {
  return post('/lending/withdraw', body, opts);
}

export async function applyForLoan(
  body: ApplyLoanBody,
  opts?: RequestOptions
): Promise<{ success: boolean; loanId?: string }> {
  return post('/lending/apply', body, opts);
}
