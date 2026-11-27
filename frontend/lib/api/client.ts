/**
 * API client: base URL from env, authentication via httpOnly cookies.
 * All backend responses are JSON; errors throw with message/details.
 * * 401 Handling: When API returns 401 (Unauthorized), a registered callback is invoked
 * to handle stale auth state (e.g., expired httpOnly cookie).
 * * Timeout: Requests timeout after NEXT_PUBLIC_API_TIMEOUT ms (default 30000).
 * If caller provides AbortSignal, it aborts on either timeout or caller's signal.
 */
import type { ApiError } from '@/types/api';

export type { ApiError } from '@/types/api';

let authErrorHandler: ((error: ApiError) => void) | null = null;

/**
 * Register a callback to be invoked when API returns 401 (Unauthorized).
 * Used by AuthContext to clear stale session state and redirect to login.
 */
export function onAuthError(callback: (error: ApiError) => void): void {
  authErrorHandler = callback;
}

const BASE = typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL)
  ? (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL)!.replace(/\/$/, '')
  : '';

const DEFAULT_TIMEOUT = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_TIMEOUT
  ? parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT, 10) || 30000
  : 30000;

// Helper utility to introduce delays between retry attempts
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Backend often returns `{ error: { message, statusCode } }` (AppError); avoid `[object Object]`. */
function messageFromErrorBody(
  data: { message?: string; error?: string | { message?: string } },
  httpStatus: number,
): string {
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }
  const e = data.error;
  if (typeof e === 'string' && e.trim()) {
    return e;
  }
  if (e && typeof e === 'object' && typeof (e as { message?: string }).message === 'string') {
    const m = (e as { message: string }).message;
    if (m.trim()) return m;
  }
  return `Request failed (HTTP ${httpStatus})`;
}

/** Safe message for any thrown API/network value. */
export function getApiErrorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong';
}

/**
 * Maps HTTP status codes to user-friendly, actionable string messages.
 * Handles 429 (Rate Limit), 503 (Service Unavailable), and 402 (Payment Required)
 * with specific guidance. Falls back to the raw error message for all other codes.
 *
 * Note: for the richer UIError variant (with optional recovery actions) use
 * `mapApiError` from `@/hooks/use-api-error` instead.
 */
export function getApiErrorString(e: unknown): string {
  const status = (e as ApiError)?.status;
  switch (status) {
    case 429:
      return 'Too many requests — please wait a moment and try again.';
    case 503:
      return 'Service temporarily unavailable. Please try again in a few minutes.';
    case 402:
      return 'Payment required — your account may need funding or a plan upgrade before proceeding.';
    default:
      return getApiErrorMessage(e);
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Number of retry attempts on 5xx errors or network drops. Defaults to 3. */
  retries?: number;
  /** Base delay time in milliseconds for exponential backoff retry logic. */
  retryDelay?: number;
  /** Fetch Priority API hint. Pass 'high' for above-the-fold critical requests. */
  priority?: RequestPriority;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  const { retries = 3, retryDelay = 1000 } = opts;

  if (!path.startsWith('http') && !BASE.trim()) {
    throw new Error(
      "API base URL is not configured. Set NEXT_PUBLIC_API_BASE_URL (or NEXT_PUBLIC_API_URL) " +
        "to your backend root, including the API prefix — e.g. https://acbu-backend.onrender.com/api/v1 " +
        "(no trailing slash). Without this, requests hit the Next.js app and return 405 for POST /auth/*.",
    );
  }
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Create our own AbortController for timeout, independent of caller's signal
  const controller = new AbortController();
  const signal = controller.signal;
  let timedOut = false;

  // If caller provides signal, abort our controller when caller's aborts
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort();
    } else {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  // Set timeout
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_TIMEOUT);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    clearTimeout(timeoutId);
    throw new Error(
      'You appear to be offline. Please check your internet connection and try again.',
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'include', // Include httpOnly cookies in all requests
      ...(opts.priority !== undefined && { priority: opts.priority }),
    });
  } catch (error) {
    clearTimeout(timeoutId);

    // Differentiate aborts from connection breaks
    if (error instanceof Error && error.name === 'AbortError') {
      if (timedOut) {
        // If it was an automatic server timeout and we have remaining retries, execute retry
        if (retries > 0) {
          console.warn(`[API Client] Timeout on ${method} ${path}. Retrying in ${retryDelay}ms... (${retries} left)`);
          await sleep(retryDelay);
          return request<T>(method, path, body, { ...opts, retries: retries - 1, retryDelay: retryDelay * 2 });
        }
        throw new Error(`Request timed out after ${DEFAULT_TIMEOUT / 1000} seconds`, { cause: error });
      }
      // Aborted by caller explicitly via AbortSignal — do not retry, just rethrow
      throw error;
    }

    // Dynamic Network Interception: Connection dropped, peer reset, or DNS failure
    if (retries > 0) {
      console.warn(`[API Client] Network exception on ${method} ${path}. Retrying in ${retryDelay}ms... (${retries} left)`, error);
      await sleep(retryDelay);
      return request<T>(method, path, body, { ...opts, retries: retries - 1, retryDelay: retryDelay * 2 });
    }
    throw error;
  }
  
  clearTimeout(timeoutId);
  
  let data: { error?: string | { message?: string }; message?: string; details?: unknown };
  const ct = res.headers.get('content-type');
  if (ct?.includes('application/json')) {
    data = (await res.json()) as {
      error?: string | { message?: string };
      message?: string;
      details?: unknown;
    };
  } else {
    data = { error: res.statusText || 'Request failed' };
  }

  if (!res.ok) {
    const err: ApiError = new Error(
      messageFromErrorBody(data, res.status),
    ) as ApiError;
    err.status = res.status;
    err.details = data.details ?? data;

    // Trigger retry loop for Server System Failures (5xx) or Rate Limiting (429)
    if ((res.status >= 500 || res.status === 429) && retries > 0) {
      console.warn(`[API Client] HTTP Status ${res.status} on ${method} ${path}. Retrying in ${retryDelay}ms... (${retries} left)`);
      await sleep(retryDelay);
      return request<T>(method, path, body, { ...opts, retries: retries - 1, retryDelay: retryDelay * 2 });
    }
    
    // Invoke 401 handler if registered (e.g., clear auth state and redirect to login)
    if (res.status === 401 && authErrorHandler) {
      authErrorHandler(err);
    }
    
    throw err;
  }
  return data as T;
}

export function get<T>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, opts);
}

export function post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, opts);
}

export function patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>('PATCH', path, body, opts);
}

export function put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>('PUT', path, body, opts);
}

export function del<T>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>('DELETE', path, undefined, opts);
}

