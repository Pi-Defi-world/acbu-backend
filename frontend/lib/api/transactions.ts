import { get } from './client';
import type { RequestOptions } from './client';
import type { TransactionDetail, TransactionsListResponse } from '@/types/api';

export async function getTransaction(id: string, opts?: RequestOptions): Promise<TransactionDetail> {
  return get<TransactionDetail>(`/transactions/${encodeURIComponent(id)}`, opts);
}

export async function listTransactions(
  params?: { limit?: number; cursor?: string },
  opts?: RequestOptions
): Promise<TransactionsListResponse> {
  const qp = new URLSearchParams();
  if (params?.limit != null) qp.set('limit', String(params.limit));
  if (params?.cursor) qp.set('cursor', params.cursor);
  const suffix = qp.toString() ? `?${qp.toString()}` : '';
  return get<TransactionsListResponse>(`/transactions${suffix}`, opts);
}
