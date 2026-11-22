import { post } from './client';
import type { RequestOptions } from './client';
import type { MintFromUsdcBody, MintResponse, CurrencyPreference } from '@/types/api';

export async function mintFromUsdc(
  usdcAmount: string,
  walletAddress: string,
  currencyPreference?: CurrencyPreference,
  opts?: RequestOptions
): Promise<MintResponse> {
  const body: MintFromUsdcBody = { usdc_amount: usdcAmount, wallet_address: walletAddress };
  if (currencyPreference) body.currency_preference = currencyPreference;
  return post<MintResponse>('/mint/usdc', body, opts);
}
