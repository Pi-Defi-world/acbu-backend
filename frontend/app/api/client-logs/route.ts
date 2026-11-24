import { NextResponse } from 'next/server';

type TelemetryLevel = 'warn' | 'error';

interface ClientTelemetry {
  level: TelemetryLevel;
  message: string;
  error?: {
    name: string;
    message: string;
  };
}

const MAX_BODY_BYTES = 4096;
const MAX_TEXT_LENGTH = 500;

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:access_token|refresh_token|token|api[_-]?key|secret|password|passcode|authorization)=)[^&#\s]*/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b(authorization|cookie|password|passcode|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    )
    .slice(0, MAX_TEXT_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTelemetry(payload: unknown): ClientTelemetry | null {
  if (!isRecord(payload)) return null;
  if (payload.level !== 'warn' && payload.level !== 'error') return null;
  if (typeof payload.message !== 'string' || !payload.message.trim()) return null;

  let error: ClientTelemetry['error'];
  if (payload.error !== undefined) {
    if (
      !isRecord(payload.error) ||
      typeof payload.error.name !== 'string' ||
      typeof payload.error.message !== 'string'
    ) {
      return null;
    }

    error = {
      name: sanitizeText(payload.error.name),
      message: sanitizeText(payload.error.message),
    };
  }

  return {
    level: payload.level,
    message: sanitizeText(payload.message.trim()),
    ...(error && { error }),
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Telemetry payload is too large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const telemetry = parseTelemetry(payload);
  if (!telemetry) {
    return NextResponse.json({ error: 'Invalid telemetry payload' }, { status: 400 });
  }

  const entry = {
    timestamp: new Date().toISOString(),
    ...telemetry,
  };
  if (entry.level === 'error') {
    console.error('[client-telemetry]', JSON.stringify(entry));
  } else {
    console.warn('[client-telemetry]', JSON.stringify(entry));
  }

  return new NextResponse(null, { status: 204 });
}
