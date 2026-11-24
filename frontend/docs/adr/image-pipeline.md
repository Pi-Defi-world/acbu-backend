# ADR: Image Optimisation Pipeline

**Status:** Accepted  
**Date:** 2026-08-27  
**Area:** frontend/perf

---

## Context

A performance audit (severity: low) flagged that the project lacked an explicit
image configuration in `next.config.mjs`, raising two concerns:

1. **`unoptimized: true` might be set** — disabling the built-in resize/format
   pipeline and increasing bandwidth for end users.
2. **No remote-pattern allowlist** — meaning any future remote image URL would
   either be blocked by Next.js or require disabling optimisation globally.
3. **No cache floor** — the default `minimumCacheTTL` (0 s) allows the image
   endpoint to be hammered on every request.

## Decision

Enable and explicitly document the image optimisation pipeline in
`next.config.mjs`.  Specifically:

| Setting | Value | Reason |
|---|---|---|
| `unoptimized` | not set (defaults `false`) | Optimisation is ON; Next.js resizes and converts images at request time via `/_next/image`. |
| `formats` | `['image/avif', 'image/webp']` | AVIF gives ~50 % better compression than WebP; WebP is the fallback for browsers that don't support AVIF. |
| `minimumCacheTTL` | `60` (seconds) | Prevents repeated reprocessing of the same image within a 60-second window. CDN/Vercel Edge may cache longer based on `Cache-Control` headers. |
| `remotePatterns` | API origin from `NEXT_PUBLIC_API_BASE_URL` | Pre-authorises user avatars and media served from the backend without opening a wildcard allowlist. Additional CDN origins must be added here explicitly. |

## Consequences

- **Positive:** Reduced bandwidth for end users (modern format delivery).
  Lower CPU load on the image endpoint (cache floor).
  Secure-by-default remote images (allowlist, not open wildcard).
- **Neutral:** Build-time resolution of `NEXT_PUBLIC_API_BASE_URL` for the
  remote pattern — requires the variable to be set in CI/CD environments.
  Local development without `.env.local` simply has an empty `remotePatterns`
  array, which is fine because all current images are local static assets.
- **Negative / trade-off:** AVIF encoding is slower than WebP; this is
  acceptable because the image endpoint caches the result after the first
  request.

## Adding New Remote Image Sources

Do **not** set `unoptimized: true` to work around a missing hostname.
Instead, add an entry to the `remotePatterns` array in `next.config.mjs`:

```js
{ protocol: 'https', hostname: 'your-cdn.example.com', pathname: '/**' }
```

Commit the change with a brief comment explaining which service hosts those
images and why.
