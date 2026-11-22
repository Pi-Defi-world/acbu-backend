import { post } from './client';
import type { RequestOptions } from './client';
import type { RecoveryUnlockBody } from '@/types/api';

/** No API key; use opts without token for unlock. */
export async function unlock(body: RecoveryUnlockBody, opts?: RequestOptions): Promise<unknown> {
  return post('/recovery/unlock', body, opts);
}
