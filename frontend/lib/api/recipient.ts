import { get } from './client';
import type { RequestOptions } from './client';
import type { RecipientResponse } from '@/types/api';

export async function resolveRecipient(
  query: string,
  opts?: RequestOptions
): Promise<RecipientResponse> {
  return get<RecipientResponse>(`/recipient?q=${encodeURIComponent(query)}`, opts);
}
