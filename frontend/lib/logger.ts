const isDebug = process.env.NEXT_PUBLIC_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type LogData = unknown;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const consoleWriters: Record<LogLevel, (entry: string) => void> = {
  error: (entry) => console.error(entry),
  warn: (entry) => console.warn(entry),
  info: (entry) => console.info(entry),
  debug: (entry) => console.log(entry),
};

function serializeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  return data;
}

function redactTelemetryText(value: string): string {
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
    .slice(0, 500);
}

function getErrorDetails(data: unknown): { name: string; message: string } | undefined {
  const error = data instanceof Error
    ? data
    : data && typeof data === 'object' && 'error' in data && data.error instanceof Error
      ? data.error
      : undefined;

  if (!error) return undefined;

  return {
    name: redactTelemetryText(error.name),
    message: redactTelemetryText(error.message),
  };
}

function sendProductionTelemetry(
  level: 'warn' | 'error',
  message: string,
  data?: LogData,
): void {
  const entry = {
    level,
    message: redactTelemetryText(message),
    error: getErrorDetails(data),
  };

  if (typeof window === 'undefined') {
    consoleWriters[level](JSON.stringify(entry));
    return;
  }

  void fetch('/api/client-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    keepalive: true,
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Telemetry endpoint returned HTTP ${response.status}`);
    }
  }).catch((error: unknown) => {
    console.warn('Failed to send client telemetry', error);
  });
}
function logMessage(level: LogLevel, message: string, data?: unknown) {
  if (!isDebug) return;

function logMessage(level: LogLevel, message: string, data?: LogData) {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined && { data: serializeData(data) }),
  };

  if (isDebug) {
    consoleWriters[level](JSON.stringify(logEntry));
  }

  if (process.env.NODE_ENV === 'production' && (level === 'warn' || level === 'error')) {
    sendProductionTelemetry(level, message, data);
  }
}

export const logger = {
  info: (message: string, data?: unknown) => logMessage('info', message, data),
  warn: (message: string, data?: unknown) => logMessage('warn', message, data),
  error: (message: string, data?: unknown) => logMessage('error', message, data),
  debug: (message: string, data?: unknown) => logMessage('debug', message, data),
};
