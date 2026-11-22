import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorReporter, sanitizeUrlForReporting } from '../error-reporting';

describe('sanitizeUrlForReporting', () => {
  it('drops the fragment, which is where implicit and PKCE callbacks put tokens', () => {
    expect(
      sanitizeUrlForReporting('/auth/callback#access_token=eyJhbGciOi&expires_in=3600'),
    ).toBe('/auth/callback');
  });

  it('drops the origin', () => {
    expect(sanitizeUrlForReporting('https://app.acbu.io/feed?page=2')).toBe(
      '/feed?page=2',
    );
  });

  it('redacts sensitive values but keeps the parameter list', () => {
    const sanitized = sanitizeUrlForReporting(
      '/reset-password?token=abc123&step=2',
    );

    expect(sanitized).not.toContain('abc123');
    expect(sanitized).toContain('step=2');
    expect(sanitized.startsWith('/reset-password?')).toBe(true);
  });

  it.each([
    ['api_key'],
    ['accessToken'],
    ['passcode'],
    ['otp'],
    ['signature'],
    ['currency_code'],
  ])('treats %s as sensitive', (name) => {
    expect(sanitizeUrlForReporting(`/x?${name}=leaked`)).not.toContain('leaked');
  });

  it('keeps non-sensitive values intact', () => {
    expect(sanitizeUrlForReporting('/feed?page=3&sort=newest')).toBe(
      '/feed?page=3&sort=newest',
    );
  });

  it('returns an empty string unchanged', () => {
    expect(sanitizeUrlForReporting('')).toBe('');
  });

  it('falls back to the path when the url cannot be parsed', () => {
    expect(sanitizeUrlForReporting('http://[malformed?token=leaked')).toBe(
      'http://[malformed',
    );
  });
});

describe('ErrorReporter.reportError', () => {
  const reporter = ErrorReporter.getInstance();

  beforeEach(() => {
    sessionStorage.clear();
    reporter.setEnabled(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('stores the location without credentials', async () => {
    window.history.replaceState({}, '', '/feed?token=leaked&page=3');

    await reporter.reportError(new Error('boom'));

    const [stored] = reporter.getStoredErrors();
    expect(stored?.url).not.toContain('leaked');
    expect(stored?.url).toContain('page=3');
  });

  it('sanitizes the route carried by route-error context', async () => {
    window.history.replaceState({}, '', '/feed');

    await reporter.reportError(new Error('boom'), {
      level: 'page',
      context: {
        type: 'route-error',
        route: '/posts/42?access_token=leaked',
        digest: undefined,
        userId: undefined,
      },
    });

    const [stored] = reporter.getStoredErrors();
    expect(JSON.stringify(stored)).not.toContain('leaked');
  });
});
