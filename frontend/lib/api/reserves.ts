import { get } from './client';
import type { RequestOptions } from './client';
import type { ReservesResponse } from '@/types/api';

export async function getReserves(opts?: RequestOptions): Promise<ReservesResponse> {
  return get<ReservesResponse>('/reserves', opts);
}
