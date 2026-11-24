const API_BASE =
  import.meta.env.VITE_ACBU_API_URL ||
  "https://acbu-backend.onrender.com/api/v1";

/**
 * Auth options are intentionally separate:
 * - `token` → Authorization: Bearer (JWT session)
 * - `apiKey` → x-api-key (ACBU API key, e.g. acbu_<lookup>_<secret>)
 *
 * Never reuse the same credential across both headers (AZ-022).
 */
interface RequestOptions {
  token?: string;
  apiKey?: string;
}

class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: RequestOptions
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts?.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }
  if (opts?.apiKey) {
    headers["x-api-key"] = opts.apiKey;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.error?.message || json.message || text;
    } catch {
      /* keep text */
    }
    throw new ApiError(message, res.status);
  }

  return res.json();
}

export function get<T>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, opts);
}

export function post<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions
): Promise<T> {
  return request<T>("POST", path, body, opts);
}

export { ApiError };
