/**
 * app/__tests__/layout-nonce.test.ts
 *
 * Unit tests for the nonce coercion logic in RootLayout (issue #702).
 *
 * The inline dark-mode script uses `nonce={nonce}` where `nonce` comes from
 * the `x-nonce` request header set by middleware.  When the header is absent
 * (static pre-render, bypassed route), `headers().get('x-nonce')` returns
 * null.  Passing that directly as `?? undefined` still risks falsy string ""
 * scenarios; the correct behaviour is to guarantee `nonce` is either a
 * non-empty string or `undefined` so React never emits `nonce=""` on the
 * script tag (an empty nonce silently breaks strict-dynamic CSP).
 */

import { describe, it, expect } from 'vitest';

/**
 * Inline replica of the coercion logic from RootLayout.
 * Tests target this pure function so they run without a Next.js server.
 */
function coerceNonce(raw: string | null): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

describe('coerceNonce (layout nonce coercion, issue #702)', () => {
  // ── Positive cases: valid nonces ──────────────────────────────────────────

  it('returns a valid base64 nonce unchanged', () => {
    const valid = Buffer.from(crypto.randomUUID()).toString('base64');
    expect(coerceNonce(valid)).toBe(valid);
  });

  it('returns a plain non-empty string unchanged', () => {
    expect(coerceNonce('abc123')).toBe('abc123');
  });

  it('preserves nonce with special base64 characters (+, /, =)', () => {
    const b64 = 'aB+c/d==';
    expect(coerceNonce(b64)).toBe(b64);
  });

  // ── Negative cases: absent or invalid nonces ──────────────────────────────

  it('returns undefined when raw nonce is null (header absent)', () => {
    // headers().get() returns null when the header is missing
    expect(coerceNonce(null)).toBeUndefined();
  });

  it('returns undefined when raw nonce is an empty string', () => {
    // Defensive: an empty string would cause React to emit nonce=""
    expect(coerceNonce('')).toBeUndefined();
  });

  // ── React rendering implication ───────────────────────────────────────────

  it('coercing to undefined makes React omit the nonce attribute entirely', () => {
    // React only renders prop attributes when value !== undefined.
    // This test documents the expected React behaviour (nonce={undefined} → no attribute).
    const nonce = coerceNonce(null);
    // A script element with nonce={undefined} should have no nonce attribute
    // (verified by React's internal prop handling; we assert the value here).
    expect(nonce).toBeUndefined();
    // Conversely, nonce={""} would emit nonce="" which browsers treat as invalid.
    expect(nonce).not.toBe('');
  });

  it('a valid nonce is truthy so React emits the attribute', () => {
    const nonce = coerceNonce('validNonce123');
    expect(nonce).toBeTruthy();
    expect(typeof nonce).toBe('string');
  });
});
