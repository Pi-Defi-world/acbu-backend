import { get, post } from './client';
import type { RequestOptions } from './client';
import type {
  TransfersListResponse,
  CreateTransferBody,
  CreateTransferResponse,
  TransferItem,
} from '@/types/api';

export async function getSmeTransfers(opts?: RequestOptions): Promise<TransfersListResponse> {
  return get<TransfersListResponse>('/sme/transfers', opts);
}

export async function getSmeTransfer(id: string, opts?: RequestOptions): Promise<TransferItem & { [key: string]: unknown }> {
  return get<TransferItem & { [key: string]: unknown }>(`/sme/transfers/${encodeURIComponent(id)}`, opts);
}

export async function createSmeTransfer(body: CreateTransferBody, opts?: RequestOptions): Promise<CreateTransferResponse> {
  return post<CreateTransferResponse>('/sme/transfers', body, opts);
}

export async function getSmeStatements(opts?: RequestOptions): Promise<TransfersListResponse> {
  return get<TransfersListResponse>('/sme/statements', opts);
}
