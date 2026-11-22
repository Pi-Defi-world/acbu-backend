import { describe, it, expect } from 'vitest';
import { mapApiError } from '@/hooks/use-api-error';
import { getApiErrorMessage } from '../api/client';
import type { ApiError } from '@/types/api';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeApiError(status: number, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  return err;
}

// ---------------------------------------------------------------------------
// getApiErrorMessage
// ---------------------------------------------------------------------------

describe('getApiErrorMessage', () => {
  it('returns the message from an Error instance', () => {
    expect(getApiErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string as-is', () => {
    expect(getApiErrorMessage('plain string error')).toBe('plain string error');
  });

  it('returns fallback for null', () => {
    expect(getApiErrorMessage(null)).toBe('Something went wrong');
  });

  it('returns fallback for undefined', () => {
    expect(getApiErrorMessage(undefined)).toBe('Something went wrong');
  });

  it('returns fallback for an object without message', () => {
    expect(getApiErrorMessage({ code: 42 })).toBe('Something went wrong');
  });
});

// ---------------------------------------------------------------------------
// mapApiError — the three special codes
// ---------------------------------------------------------------------------

describe('mapApiError — HTTP 429 (Rate Limit)', () => {
  it('maps status 429 to the rate-limit message', () => {
    const msg = mapApiError(makeApiError(429, 'rate limited'));
    expect(msg?.message).toBe('Too many requests. Please wait a moment before trying again.');
  });

  it('ignores the original error message for 429', () => {
    const msg = mapApiError(makeApiError(429, 'some backend text'));
    expect(typeof msg?.message).toBe('string');
    expect(msg?.message).not.toContain('some backend text');
  });
});

describe('mapApiError — HTTP 503 (Service Unavailable)', () => {
  it('maps status 503 to the service-unavailable message', () => {
    const msg = mapApiError(makeApiError(503, 'down for maintenance'));
    expect(msg?.message).toBe('Our payment processor is temporarily down. Your funds are safe.');
  });
});

describe('mapApiError — HTTP 402 (Payment Required)', () => {
  it('maps status 402 to the payment-required message', () => {
    const msg = mapApiError(makeApiError(402, 'upgrade required'));
    expect(msg?.message).toBe('Insufficient balance or payment required.');
  });
});

// ---------------------------------------------------------------------------
// mapApiError — fallback behaviour for other codes
// ---------------------------------------------------------------------------

describe('mapApiError — fallback for other status codes', () => {
  it('passes through the error message for 400', () => {
    expect(mapApiError(makeApiError(400, 'bad request'))?.message).toBe('bad request');
  });

  it('passes through the error message for 401', () => {
    expect(mapApiError(makeApiError(401, 'unauthorized'))?.message).toBe('unauthorized');
  });

  it('passes through the error message for 404', () => {
    expect(mapApiError(makeApiError(404, 'not found'))?.message).toBe('not found');
  });

  it('passes through the error message for 500', () => {
    expect(mapApiError(makeApiError(500, 'internal server error'))?.message).toBe(
      'internal server error',
    );
  });

  it('handles a plain Error with no status', () => {
    expect(mapApiError(new Error('network failure'))?.message).toBe('network failure');
  });

  it('handles a plain string', () => {
    expect(mapApiError('something bad')?.message).toBe('Something went wrong. Please try again.');
  });

  it('returns fallback for null', () => {
    expect(mapApiError(null)).toBeNull();
  });

  it('returns fallback for undefined', () => {
    expect(mapApiError(undefined)).toBeNull();
  });
});
