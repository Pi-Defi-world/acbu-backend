import { get, post } from './client';
import type { RequestOptions } from './client';
import type {
  TransfersListResponse,
  CreateTransferBody,
  CreateTransferResponse,
  TransferItem,
} from '@/types/api';

export async function getTransfers(opts?: RequestOptions): Promise<TransfersListResponse> {
  return get<TransfersListResponse>('/transfers', opts);
}

export async function getTransfer(id: string, opts?: RequestOptions): Promise<TransferItem & { [key: string]: unknown }> {
  return get<TransferItem & { [key: string]: unknown }>(`/transfers/${encodeURIComponent(id)}`, opts);
}

export async function createTransfer(body: CreateTransferBody, opts?: RequestOptions): Promise<CreateTransferResponse> {
  return post<CreateTransferResponse>('/transfers', body, opts);
}
