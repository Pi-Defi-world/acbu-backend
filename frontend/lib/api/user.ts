import { get, post, patch, put, del } from './client';
import type { RequestOptions } from './client';
import type { UserMe, PatchMeBody, ReceiveResponse, BalanceResponse, ContactItem, GuardianItem } from '@/types/api';

export async function getMe(opts?: RequestOptions): Promise<UserMe> {
  return get<UserMe>('/users/me', opts);
}

export async function patchMe(data: PatchMeBody, opts?: RequestOptions): Promise<UserMe> {
  return patch<UserMe>('/users/me', data, opts);
}

export async function deleteMe(opts?: RequestOptions): Promise<void> {
  return del<void>('/users/me', opts);
}

export async function getBalance(opts?: RequestOptions): Promise<BalanceResponse> {
  return get<BalanceResponse>('/users/me/balance', opts);
}

export async function getReceive(opts?: RequestOptions): Promise<ReceiveResponse> {
  return get<ReceiveResponse>('/users/me/receive', opts);
}

export async function getReceiveQrcode(opts?: RequestOptions): Promise<Blob | { url?: string }> {
  const base = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL
    ? process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '')
    : '';
  
  const res = await fetch(`${base}/users/me/receive/qrcode`, {
    credentials: 'include', // Use httpOnly cookie authentication
    signal: opts?.signal,
  });
  
  if (!res.ok) {
    const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : {};
    throw new Error((data as { message?: string }).message || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type');
  if (ct?.includes('application/json')) return res.json();
  return res.blob();
}

export async function postWalletConfirm(body: { wallet_address?: string; [key: string]: unknown }, opts?: RequestOptions): Promise<unknown> {
  return post('/users/me/wallet/confirm', body, opts);
}

export interface PutWalletAddressResponse {
  ok: boolean;
  stellar_address?: string;
  changed?: boolean;
  previous_stellar_address?: string | null;
}

export async function putWalletAddress(
  stellar_address: string,
  opts?: RequestOptions,
): Promise<PutWalletAddressResponse> {
  return put<PutWalletAddressResponse>(
    "/users/me/wallet",
    { stellar_address },
    opts,
  );
}

export interface DeleteWalletResponse {
  ok: boolean;
  previous_stellar_address?: string | null;
}

export async function deleteWallet(
  opts?: RequestOptions,
): Promise<DeleteWalletResponse> {
  return del<DeleteWalletResponse>("/users/me/wallet", opts);
}

export async function getContacts(opts?: RequestOptions): Promise<{ contacts?: ContactItem[] }> {
  return get<{ contacts?: ContactItem[] }>('/users/me/contacts', opts);
}

export async function postContact(body: { alias?: string; pay_uri?: string; [key: string]: unknown }, opts?: RequestOptions): Promise<ContactItem> {
  return post<ContactItem>('/users/me/contacts', body, opts);
}

export async function deleteContact(id: string, opts?: RequestOptions): Promise<unknown> {
  return del(`/users/me/contacts/${encodeURIComponent(id)}`, opts);
}

export async function getGuardians(opts?: RequestOptions): Promise<{ guardians?: GuardianItem[] }> {
  return get<{ guardians?: GuardianItem[] }>('/users/me/guardians', opts);
}

export async function postGuardian(body: Record<string, unknown>, opts?: RequestOptions): Promise<GuardianItem> {
  return post<GuardianItem>('/users/me/guardians', body, opts);
}

export async function deleteGuardian(id: string, opts?: RequestOptions): Promise<unknown> {
  return del(`/users/me/guardians/${encodeURIComponent(id)}`, opts);
}
