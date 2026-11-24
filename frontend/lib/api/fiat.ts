import { get, post } from './client';
import type { RequestOptions } from './client';

export interface FiatAccount {
  id: string;
  currency: string;
  balance: string | number;
  usd_equivalent?: string | number | null;
  bank_name: string;
  account_number: string;
  account_name: string;
  /** Legacy field; always empty for on-chain custodial mode. */
  ledger_entries: unknown[];
}

export async function getFiatAccounts(
  opts?: RequestOptions,
): Promise<{ mode?: string; accounts: FiatAccount[] }> {
  return get('/fiat/accounts', opts);
}

export interface FaucetResponse {
  currency: string;
  amount: number;
  amount_i128: string;
  transaction_hash: string;
}

export async function postFaucet(
  currency: string,
  amount: string | number,
  recipient: string | undefined,
  opts?: RequestOptions,
): Promise<FaucetResponse> {
  return post(
    '/fiat/faucet',
    { currency, amount: Number(amount), ...(recipient ? { recipient } : {}) },
    opts,
  );
}

export interface OnRampResponse {
  transactionId?: string;
  transaction_id?: string;
  acbuAmount?: number;
  acbu_amount?: number;
  blockchain_tx_hash?: string;
  message?: string;
}

export async function postOnRamp(
  amount: string,
  currency: string,
  opts?: RequestOptions,
): Promise<OnRampResponse> {
  return post(
    '/fiat/onramp',
    { amount: Number(amount), currency },
    opts,
  );
}

export async function postOffRamp(
  amount_acbu: string,
  currency: string,
  blockchainTxHash?: string,
  opts?: RequestOptions,
): Promise<{ transactionId?: string; transaction_id?: string; message?: string }> {
  return post(
    '/fiat/offramp',
    {
      amount: Number(amount_acbu),
      currency,
      ...(blockchainTxHash ? { blockchain_tx_hash: blockchainTxHash } : {}),
    },
    opts,
  );
}
