/**
 * Error reporting utilities for the application
 */
import { logger } from './logger';

/** Discriminated union of all known error context payloads. */
export type ErrorContext =
  | { type: 'unhandledrejection' }
  | { type: 'uncaughterror'; filename: string; lineno: number; colno: number }
  | { type: 'global-error'; digest: string | undefined; critical: boolean }
  | { type: 'page-error'; page: string; digest: string | undefined }
  | { type: 'route-error'; route: string; digest: string | undefined; userId: string | undefined }
  | { type: 'component-error'; componentStack: string | null; boundary: string };

export interface ErrorReport {
  message: string;
  stack?: string;
  digest?: string;
  timestamp: string;
  userAgent: string;
  url: string;
  level: 'app' | 'page' | 'component';
  context?: ErrorContext;
}

/**
 * Parameter name segments that must never leave the browser inside an error
 * report. Matching happens per segment so that `currency_code` and
 * `accessToken` are caught while `keyword` and `author` are not.
 */
const SENSITIVE_PARAM_SEGMENTS = new Set([
  'token',
  'secret',
  'password',
  'passcode',
  'passphrase',
  'key',
  'apikey',
  'credential',
  'credentials',
  'signature',
  'assertion',
  'jwt',
  'otp',
  'pin',
  'auth',
  'authorization',
  'bearer',
  'session',
  'code',
]);

function isSensitiveParam(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .some((segment) => SENSITIVE_PARAM_SEGMENTS.has(segment.toLowerCase()));
}

/**
 * Reduce a location to the parts that are useful for debugging while dropping
 * everything that can carry a credential.
 *
 * The origin and fragment are dropped: single-page apps and OAuth implicit/PKCE
 * callbacks put access tokens in the fragment, and the origin adds nothing that
 * the route does not already say. Sensitive query values become `[redacted]`
 * instead of disappearing so the shape of the request stays visible.
 */
export function sanitizeUrlForReporting(raw: string): string {
  if (!raw) return raw;

  try {
    const url = new URL(raw, 'http://localhost');
    const params = new URLSearchParams();
    for (const [name, value] of url.searchParams) {
      params.append(name, isSensitiveParam(name) ? '[redacted]' : value);
    }
    const query = params.toString();
    return `${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    // Unparseable input: keep everything up to the query/fragment markers.
    const [path] = raw.split(/[?#]/);
    return path ?? raw;
  }
}

export class ErrorReporter {
  private static instance: ErrorReporter;
  private isEnabled: boolean = true;

  private constructor() {}

  static getInstance(): ErrorReporter {
    if (!ErrorReporter.instance) {
      ErrorReporter.instance = new ErrorReporter();
    }
    return ErrorReporter.instance;
  }

  /**
   * Report an error to external services
   */
  async reportError(error: Error, context: Partial<ErrorReport> = {}): Promise<void> {
    if (!this.isEnabled) return;

    const report: ErrorReport = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown',
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      level: 'component',
      ...context,
    };

    // Callers may override `url`, and route context repeats the location: strip
    // credentials from both before anything is stored or transmitted.
    report.url = sanitizeUrlForReporting(report.url);
    if (report.context?.type === 'route-error') {
      report.context = {
        ...report.context,
        route: sanitizeUrlForReporting(report.context.route),
      };
    }

    // Log to console in development only
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error Report:', report);
    } else {
      logger.error('Frontend error report', {
        error,
        digest: report.digest,
      });
    }

    try {
      if (typeof window !== 'undefined') {
        const errors = this.getStoredErrors();
        errors.push(report);
        const recentErrors = errors.slice(-50);
        sessionStorage.setItem('app_errors', JSON.stringify(recentErrors));

        fetch('/api/errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    } catch (reportingError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to report error:', reportingError);
      }
    }
  }

  /**
   * Get stored errors for debugging
   */
  getStoredErrors(): ErrorReport[] {
    if (typeof window === 'undefined') return [];
    
    try {
      const stored = sessionStorage.getItem('app_errors');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Clear stored errors
   */
  clearStoredErrors(): void {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('app_errors');
    }
  }

  /**
   * Enable or disable error reporting
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }
}

// Global error handler for unhandled promise rejections and errors
export function setupGlobalErrorHandling(): void {
  if (typeof window === 'undefined') return;

  const reporter = ErrorReporter.getInstance();

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    reporter.reportError(error, {
      level: 'app',
      context: { type: 'unhandledrejection' } satisfies ErrorContext
    });
  });

  // Handle uncaught errors
  window.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message);
    reporter.reportError(error, {
      level: 'app',
      context: { 
        type: 'uncaughterror',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      } satisfies ErrorContext
    });
  });
}

// Export singleton instance
export const errorReporter = ErrorReporter.getInstance();