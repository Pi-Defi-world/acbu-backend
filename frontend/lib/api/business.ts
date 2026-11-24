import { get } from './client';
import type { RequestOptions } from './client';

export interface BusinessStatsResponse {
  monthly_volume?: string | number;
  employees?: number;
  [key: string]: unknown;
}

/**
 * Fetch business statistics (volume, employees, etc.)
 */
export async function getBusinessStats(opts?: RequestOptions): Promise<BusinessStatsResponse> {
  return get<BusinessStatsResponse>('/business/stats', opts);
}
