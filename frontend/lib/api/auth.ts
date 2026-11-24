import { normalizeUsername } from '@/lib/utils';
import { post } from './client';
import type { RequestOptions } from './client';
import type { SigninResponse, SigninRequires2FA, SessionResponse } from '@/types/api';
import { setAuth } from '@/contexts/auth-context';

export interface SignupResponse {
  user_id: string;
  message: string;
}

function normalizeSigninResponse(payload: unknown): SigninResponse | SigninRequires2FA {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid sign-in response');
  }

  const response = payload as Record<string, unknown>;
  if (response.requires_2fa === true) {
    if (typeof response.challenge_token !== 'string') {
      throw new Error('Invalid two-factor sign-in response');
    }
    return { requires_2fa: true, challenge_token: response.challenge_token };
  }

  if (typeof response.user_id !== 'string') {
    throw new Error('Invalid sign-in response');
  }

  return {
    user_id: response.user_id,
    ...(typeof response.api_key === 'string' ? { api_key: response.api_key } : {}),
    ...(typeof response.stellar_address === 'string' || response.stellar_address === null
      ? { stellar_address: response.stellar_address }
      : {}),
    ...(typeof response.wallet_created === 'boolean'
      ? { wallet_created: response.wallet_created }
      : {}),
    ...(typeof response.encryption_method_required === 'boolean'
      ? { encryption_method_required: response.encryption_method_required }
      : {}),
  };
}

export async function signup(
  username: string,
  passcode: string,
  opts?: RequestOptions,
): Promise<SignupResponse> {
  const normalizedUsername = normalizeUsername(username);

  return post<SignupResponse>(
    '/auth/signup',
    { username: normalizedUsername, passcode },
    opts
  );
}

export async function signin(
  identifier: string,
  passcode: string,
  opts?: RequestOptions
): Promise<SigninResponse | SigninRequires2FA> {
  const response = await post<unknown>('/auth/signin', { identifier, passcode }, opts);
  const normalized = normalizeSigninResponse(response);
  if ('api_key' in normalized && normalized.api_key) {
    setAuth(normalized.api_key, normalized.user_id, normalized.username);
  }
  return normalized;
}

export async function verify2fa(
  challengeToken: string,
  code: string,
  opts?: RequestOptions
): Promise<SigninResponse> {
  const response = await post<unknown>(
    '/auth/signin/verify-2fa',
    { challenge_token: challengeToken, code },
    opts,
  );
  const normalized = normalizeSigninResponse(response);
  if ('requires_2fa' in normalized) {
    throw new Error('Invalid two-factor verification response');
  }
  if (normalized.api_key) {
    setAuth(normalized.api_key, normalized.user_id, normalized.username);
  }
  return normalized;
}

export async function exchangeOAuthCode(
  code: string,
  state: string,
  opts?: RequestOptions
): Promise<SigninResponse> {
  const response = await post<SigninResponse>(
    '/auth/oauth/callback',
    { code, state },
    opts
  );
  setAuth(response.api_key, response.user_id, response.username);
  return response;
}

export async function signout(opts?: RequestOptions): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>('/auth/signout', undefined, opts);
}

export async function getSession(opts?: RequestOptions): Promise<SessionResponse> {
  return post<SessionResponse>('/auth/session', undefined, opts);
}