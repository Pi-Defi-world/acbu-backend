import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('production logger telemetry', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DEBUG', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('ships warnings and errors while omitting info and debug events', async () => {
    const { logger } = await import('../logger');

    logger.info('transaction started');
    logger.debug('debug detail');
    logger.warn('Provider unavailable');
    logger.error('Transfer failed', new Error('HTTP 503'));

    expect(fetch).toHaveBeenCalledTimes(2);
    const payloads = vi.mocked(fetch).mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(payloads).toEqual([
      { level: 'warn', message: 'Provider unavailable', error: undefined },
      {
        level: 'error',
        message: 'Transfer failed',
        error: { name: 'Error', message: 'HTTP 503' },
      },
    ]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/client-logs');
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      keepalive: true,
    });
  });

  it('redacts credentials and does not send arbitrary log data', async () => {
    const { logger } = await import('../logger');
    const data = {
      password: 'do-not-send',
      transaction: 'private-details',
    };

    logger.error('Request failed token=super-secret', data);

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(payload).toEqual({
      level: 'error',
      message: 'Request failed token=[REDACTED]',
      error: undefined,
    });
    expect(JSON.stringify(payload)).not.toContain('do-not-send');
    expect(JSON.stringify(payload)).not.toContain('private-details');
  });

  it('continues shipping warnings and errors when production debug logging is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEBUG', 'true');
    vi.resetModules();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logger } = await import('../logger');

    logger.error('Production diagnostic');

    expect(consoleError).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({
      level: 'error',
      message: 'Production diagnostic',
    });
  });

  it('routes global error reports through production telemetry', async () => {
    const { errorReporter } = await import('../error-reporting');

    await errorReporter.reportError(new Error('API request failed'), {
      digest: 'error-digest',
      context: { email: 'not-sent@example.test' },
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      level: 'error',
      message: 'Frontend error report',
      error: { name: 'Error', message: 'API request failed' },
    });
  });
});
