import { post } from './client';
import type { RequestOptions } from './client';

export async function createCharge(
  body: { amount_acbu?: string; currency?: string; [key: string]: unknown },
  opts?: RequestOptions
): Promise<{ charge_id?: string; [key: string]: unknown }> {
  return post('/gateway/charges', body, opts);
}

export async function confirmCharge(
  body: { charge_id?: string; action?: 'release' | 'refund'; [key: string]: unknown },
  opts?: RequestOptions
): Promise<unknown> {
  return post('/gateway/confirm', body, opts);
}
