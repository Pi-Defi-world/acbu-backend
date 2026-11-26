# Resolution Report: W11-AUD-005 / Issue #1408

## Overview

- **ID:** W11-AUD-005
- **GitHub Issue:** [#1408](https://github.com/Pi-Defi-world/acbu-backend/issues/1408)
- **Area:** frontend-security
- **Target File:** `frontend/next.config.mjs`
- **Status:** RESOLVED

---

## Vulnerability Description & Impact

### Evidence
The Next.js frontend configuration (`frontend/next.config.mjs`) required explicit and hardened HTTP security headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`, `Referrer-Policy`, and cross-origin resource protection).

### Impact
Without robust HTTP security headers:
1. **Clickjacking:** Framing attacks could trick users into performing unintended actions within an embedded iframe.
2. **Cross-Origin Script Injection (XSS):** Malicious third-party scripts could execute within the app's context.
3. **MIME-Sniffing Attacks:** Browsers could interpret non-executable resources (e.g., images) as executable scripts.
4. **Transport Vulnerabilities:** Unencrypted HTTP downgrades or lack of HSTS preloading could permit man-in-the-middle attacks.

---

## Remediation Details

Configured strict HTTP security headers in `frontend/next.config.mjs` within the `headers()` lifecycle hook matching all paths (`/:path*`):

1. **Content-Security-Policy (CSP):**
   - `default-src 'self'`: Restricts resource loads to the same origin by default.
   - `frame-ancestors 'none'`: Prohibits any embedding of the application inside `<iframe>`, `<frame>`, or `<object>`, mitigating clickjacking.
   - `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`: Allows required inline Next.js bootstrapping and Aztec/Noir WebAssembly instantiation in Web Workers (`'unsafe-eval'` conditionally enabled only in development).
   - `connect-src`: Restricts network connections (XHR/fetch/WebSocket) to:
     - `'self'`
     - Backend API base origin (`NEXT_PUBLIC_API_BASE_URL`)
     - Sentry (`https://*.sentry.io`)
     - Aztec CRS (`https://crs.aztec.network`)
     - Stellar Horizon & RPC nodes (`https://*.stellar.org`, `https://*.soroban-rpc.com`)
     - Vercel Analytics (`https://*.vercel-analytics.com`)
     - Dev WebSocket (`ws://localhost:*` only in dev)
   - `object-src 'none'`: Disallows plugins (`<object>`, `<embed>`, `<applet>`).
   - `base-uri 'self'`: Prevents `<base>` tag injection attacks.
   - `form-action 'self'`: Prevents form submissions to untrusted third-party endpoints.
   - `worker-src 'self' blob:`: Permits internal and blob workers for ZK proof generation.
   - `report-uri /api/csp-report`: Reports CSP violations to the internal violation logging endpoint.

2. **Strict-Transport-Security (HSTS):**
   - `max-age=63072000; includeSubDomains; preload` (2 years) enforcing HTTPS.

3. **X-Frame-Options:**
   - `DENY` providing legacy browser frame protection.

4. **X-Content-Type-Options:**
   - `nosniff` preventing MIME confusion attacks.

5. **Referrer-Policy:**
   - `strict-origin-when-cross-origin` protecting path privacy on outbound requests.

6. **Permissions-Policy:**
   - `camera=(), microphone=(), geolocation=(), payment=()` disabling unused browser capabilities.

7. **X-DNS-Prefetch-Control:**
   - `on` optimizing DNS resolution safely.

8. **Cross-Origin Protections:**
   - `Cross-Origin-Opener-Policy: same-origin-allow-popups`
   - `Cross-Origin-Resource-Policy: same-origin`

---

## Verification

- Verified syntax and alignment with `frontend/middleware.ts` and Next.js 16 configuration conventions.
- Zero merge conflicts against `upstream/dev`.
