import { get, post } from './client';
import type { RequestOptions } from './client';

export async function getBillsCatalog(opts?: RequestOptions): Promise<{ catalog?: unknown[] }> {
  return get<{ catalog?: unknown[] }>('/bills/catalog', opts);
}

export async function payBill(
  body: { biller_id?: string; amount?: string; [key: string]: unknown },
  opts?: RequestOptions
): Promise<unknown> {
  return post('/bills/pay', body, opts);
}
