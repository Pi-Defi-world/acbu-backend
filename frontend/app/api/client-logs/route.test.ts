import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

function jsonRequest(body: string): Request {
  return new Request('http://localhost/api/client-logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/client-logs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a sanitized structured telemetry entry and returns 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(jsonRequest(JSON.stringify({
      level: 'warn',
      message: 'Request to /api?token=secret failed',
      error: {
        name: 'NetworkError',
        message: 'Bearer hidden-token',
        stack: 'must not be logged',
      },
      extra: { account_number: 'private' },
    })));

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[client-telemetry]',
      expect.stringMatching(/"message":"Request to \/api\?token=\[REDACTED\] failed"/),
    );

    const entry = JSON.parse(String(warn.mock.calls[0][1]));
    expect(entry).toMatchObject({
      level: 'warn',
      error: { name: 'NetworkError', message: 'Bearer [REDACTED]' },
    });
    expect(entry).not.toHaveProperty('extra');
    expect(entry).not.toHaveProperty('error.stack');
  });

  it('rejects unsupported content types, malformed JSON, and invalid events', async () => {
    const unsupported = await POST(new Request('http://localhost/api/client-logs', {
      method: 'POST',
      body: '{}',
    }));
    const malformed = await POST(jsonRequest('{'));
    const invalid = await POST(jsonRequest(JSON.stringify({ level: 'info', message: 'ignored' })));

    expect(unsupported.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it('rejects telemetry payloads larger than the request limit', async () => {
    const response = await POST(jsonRequest(JSON.stringify({
      level: 'error',
      message: 'x'.repeat(5000),
    })));

    expect(response.status).toBe(413);
  });
});
