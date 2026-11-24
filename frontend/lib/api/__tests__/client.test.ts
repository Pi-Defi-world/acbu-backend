import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiOpts,
  del,
  get,
  getApiErrorMessage,
  onAuthError,
  patch,
  post,
  put,
} from '../client';
import { createTransfer } from '../transfers';

const API_BASE = 'https://api.example.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(): ReturnType<typeof vi.fn> {
  return vi.mocked(fetch);
}

describe('API client', () => {
  beforeEach(() => {
    onAuthError(() => {});
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shapes requests for each supported HTTP method', async () => {
    await get('/items');
    await post('/items', { amount: '1.25' });
    await patch('/items/1', { active: false });
    await put('/items/1', { name: 'Updated' });
    await del('/items/1');

    const requests = mockFetch().mock.calls.map(([url, init]) => ({
      url: String(url),
      method: init?.method,
      body: init?.body,
      credentials: init?.credentials,
    }));

    expect(requests).toEqual([
      { url: `${API_BASE}/items`, method: 'GET', body: undefined, credentials: 'include' },
      { url: `${API_BASE}/items`, method: 'POST', body: '{"amount":"1.25"}', credentials: 'include' },
      { url: `${API_BASE}/items/1`, method: 'PATCH', body: '{"active":false}', credentials: 'include' },
      { url: `${API_BASE}/items/1`, method: 'PUT', body: '{"name":"Updated"}', credentials: 'include' },
      { url: `${API_BASE}/items/1`, method: 'DELETE', body: undefined, credentials: 'include' },
    ]);
    expect(new Headers(mockFetch().mock.calls[0][1]?.headers).get('Content-Type'))
      .toBe('application/json');
  });

  it('adds an explicit request token only to the Authorization header', async () => {
    await get('/private');
    await get('/private', { token: 'request-token' });

    const headers = mockFetch().mock.calls.map(([, init]) => new Headers(init?.headers));
    expect(headers[0].get('Authorization')).toBeNull();
    expect(headers[1].get('Authorization')).toBe('Bearer request-token');
    expect(headers[1].get('x-api-key')).toBeNull();
    expect(apiOpts(null)).toEqual({ token: undefined });
    expect(apiOpts('explicit-token')).toEqual({ token: 'explicit-token' });
  });

  it('accepts absolute URLs and normalizes paths against the configured base', async () => {
    await get('https://other.example.test/resource');
    await get('items');

    expect(mockFetch().mock.calls.map(([url]) => String(url))).toEqual([
      'https://other.example.test/resource',
      `${API_BASE}/items`,
    ]);
  });

  it('returns successful JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ value: 42 })));

    await expect(get<{ value: number }>('/value')).resolves.toEqual({ value: 42 });
  });

  it('preserves structured error messages, status, and details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({
        error: { message: 'Insufficient funds' },
        details: { available: '2.00' },
      }, 409)),
    );

    const result = get('/transfers').catch((error: unknown) => error);
    const error = await result;

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: 'Insufficient funds',
      status: 409,
      details: { available: '2.00' },
    });
  });

  it('falls back through string and HTTP status messages for error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Transfer rejected' }, 422))
      .mockResolvedValueOnce(new Response('not json', { status: 503, statusText: 'Unavailable' })));

    await expect(post('/transfers', {})).rejects.toMatchObject({
      message: 'Transfer rejected',
      status: 422,
    });
    await expect(get('/status')).rejects.toMatchObject({
      message: 'Unavailable',
      status: 503,
    });
  });

  it('invokes the auth error handler for 401 responses', async () => {
    const handler = vi.fn();
    onAuthError(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Expired' }, 401)));

    await expect(get('/private')).rejects.toMatchObject({ message: 'Expired', status: 401 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('rethrows network errors and extracts readable messages from unknown values', async () => {
    const networkError = new TypeError('Network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    await expect(get('/unavailable')).rejects.toBe(networkError);
    expect(getApiErrorMessage(networkError)).toBe('Network unavailable');
    expect(getApiErrorMessage('Rejected')).toBe('Rejected');
    expect(getApiErrorMessage({ message: 'not an Error' })).toBe('Something went wrong');
  });

  it('does not retry a failed transfer or discard its transaction hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Temporarily unavailable' }, 503)));

    const body = {
      to: 'GRECIPIENT',
      amount_acbu: '2.50',
      blockchain_tx_hash: 'stellar-transaction-hash',
    };
    await expect(createTransfer(body)).rejects.toMatchObject({
      status: 503,
    });

    expect(mockFetch()).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mockFetch().mock.calls[0][1]?.body))).toEqual(body);
  });
});
