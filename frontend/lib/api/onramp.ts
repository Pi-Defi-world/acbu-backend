import { post } from './client';
import type { RequestOptions } from './client';
import type { OnRampRegisterBody, OnRampRegisterResponse } from '@/types/api';

export async function registerOnRampSwap(
  body: OnRampRegisterBody,
  opts?: RequestOptions
): Promise<OnRampRegisterResponse> {
  return post<OnRampRegisterResponse>('/onramp/register', body, opts);
}
