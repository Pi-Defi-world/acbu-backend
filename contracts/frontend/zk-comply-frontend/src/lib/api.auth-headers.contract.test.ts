/**
 * AZ-022 contract: Bearer tokens and API keys must not share a header value.
 * These assertions mirror request() header construction in api.ts.
 */
type RequestOptions = { token?: string; apiKey?: string };

function buildAuthHeaders(opts?: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts?.apiKey) headers["x-api-key"] = opts.apiKey;
  return headers;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const jwt = "eyJhbGciOiJub25lIn0.e30.sig";
const key = "acbu_abcdefghijkl_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const bearerOnly = buildAuthHeaders({ token: jwt });
assert(bearerOnly["Authorization"] === `Bearer ${jwt}`, "token sets Bearer");
assert(!("x-api-key" in bearerOnly), "token must not set x-api-key");

const keyOnly = buildAuthHeaders({ apiKey: key });
assert(keyOnly["x-api-key"] === key, "apiKey sets x-api-key");
assert(!("Authorization" in keyOnly), "apiKey must not set Bearer");

const both = buildAuthHeaders({ token: jwt, apiKey: key });
assert(both["Authorization"] === `Bearer ${jwt}`, "both: Bearer from token");
assert(both["x-api-key"] === key, "both: x-api-key from apiKey");
assert(both["Authorization"] !== `Bearer ${key}`, "must not put apiKey in Bearer");
assert(both["x-api-key"] !== jwt, "must not put JWT in x-api-key");

console.log("AZ-022 auth header separation checks passed");
