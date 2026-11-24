import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_PATHS } from "@/components/layout/auth-guard";
import { randomUUID } from "crypto";

// Keep in sync with i18n/locales.ts
const SUPPORTED_LOCALES = ["en", "en-NG", "en-KE", "ar", "ru", "pl"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: Locale = "en";

// Cookie name used by next-intl and set by setLocale() in lib/i18n/index.ts
const LOCALE_COOKIE = "NEXT_LOCALE";

// Request header used to forward the resolved locale to the root layout.
const LOCALE_HEADER = "x-locale";

/**
 * Resolve the preferred locale for a request.
 *
 * Priority order:
 *  1. NEXT_LOCALE cookie (set when user explicitly switches locale)
 *  2. Accept-Language header negotiation
 *  3. Default locale ('en')
 */
function resolveLocale(request: NextRequest): Locale {
  // 1. Explicit cookie
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }

  // 2. Accept-Language header — try each tag in quality order
  const acceptLang = request.headers.get("Accept-Language") ?? "";
  for (const part of acceptLang.split(",")) {
    const tag = part.split(";")[0].trim();
    // Exact match first (e.g. "en-NG")
    if (SUPPORTED_LOCALES.includes(tag as Locale)) {
      return tag as Locale;
    }
    // Language-only prefix match (e.g. "ar" matches "ar")
    const lang = tag.split("-")[0];
    const match = SUPPORTED_LOCALES.find(
      (l) => l === lang || l.startsWith(`${lang}-`),
    );
    if (match) return match;
  }

  // 3. Fallback
  return DEFAULT_LOCALE;
}

/**
 * Returns true if the pathname starts with one of the supported locale
 * prefixes, e.g. /en/..., /en-NG/..., etc.
 */
function hasLocalePrefix(pathname: string): boolean {
  return SUPPORTED_LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
}

// Paths that should NOT be redirected to a locale-prefixed URL.
// These are either Next.js internals, API routes, or static assets that the
// matcher config already excludes — but we double-check here for safety.
const SKIP_REDIRECT_PREFIXES = [
  "/api/",
  "/_next/",
  "/favicon",
  "/robots",
  "/sitemap",
  "/manifest",
];

function shouldSkipLocaleRedirect(pathname: string): boolean {
  return SKIP_REDIRECT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Strip a leading locale prefix (e.g. /en, /en-NG) from a pathname so that
 * public-path checks can be performed against the locale-agnostic route.
 */
function stripLocalePrefix(pathname: string): string {
  for (const locale of SUPPORTED_LOCALES) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}

/**
 * Returns true if the (locale-stripped) pathname matches a public auth route.
 * PUBLIC_PATHS are declared without a locale prefix (e.g. "/auth/signin"),
 * so we compare against the stripped pathname.
 */
function isPublicPath(pathname: string): boolean {
  const stripped = stripLocalePrefix(pathname);
  return PUBLIC_PATHS.some(
    (p) => stripped === p || stripped.startsWith(`${p}/`),
  );
}

export function middleware(request: NextRequest) {
  // Block .md files
  if (request.nextUrl.pathname.endsWith(".md")) {
    const notFound = new NextResponse(null, { status: 404 });
    return applySecurityHeaders(notFound, request);
  }

  const { pathname } = request.nextUrl;

  // Public auth routes (locale-prefixed) must not be redirected or guarded.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // ── Locale redirect ────────────────────────────────────────────────────
  // If the request does not already carry a locale prefix (e.g. /en/mint)
  // and is not an internal/API path, resolve the preferred locale and
  // redirect so that every page is served under a locale-prefixed URL.
  // This ensures the NEXT_LOCALE cookie is honoured on ALL routes, not just
  // the [locale] segment pages.
  if (!hasLocalePrefix(pathname) && !shouldSkipLocaleRedirect(pathname)) {
    const locale = resolveLocale(request);

    // Build the redirect URL preserving query string and hash
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

    const redirectResponse = NextResponse.redirect(redirectUrl);

    // Persist the resolved locale as a cookie so subsequent requests (and
    // the top-level pages that read it) stay consistent.
    redirectResponse.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      sameSite: "lax",
      // Don't set httpOnly so the client-side setLocale() can update it too
      httpOnly: false,
      // 1 year TTL
      maxAge: 60 * 60 * 24 * 365,
    });

    applySecurityHeaders(redirectResponse, request);
    return redirectResponse;
  }

  // Resolve the locale for requests that already carry a prefix (or are
  // skipped from redirect) so the root layout can render the correct `lang`.
  const resolvedLocale = hasLocalePrefix(pathname)
    ? (pathname.split("/")[1] as Locale)
    : resolveLocale(request);

  // ── CSP / Security headers ─────────────────────────────────────────────
  const nonce = Buffer.from(randomUUID()).toString("base64");

  const isDev = process.env.NODE_ENV === "development";

  const cspDirectives = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      isDev ? "'unsafe-eval'" : "",
    ].filter(Boolean),
    "style-src": ["'self'", `'nonce-${nonce}'`, "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", "https://*"],
    "font-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/api/csp-report"],
    "report-to": ["csp-endpoint"],
    "connect-src": [
      "'self'",
      "https://*.stellar.org",
      "https://*.soroban-rpc.com",
      "https://*.vercel-analytics.com",
      isDev ? "ws://localhost:*" : "",
    ].filter(Boolean),
    "upgrade-insecure-requests": [],
  };

  const cspString = Object.entries(cspDirectives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(" ")}`;
    })
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspString);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", cspString);
  response.headers.set(LOCALE_HEADER, resolvedLocale);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Reporting-Endpoints",
    'csp-endpoint="/api/csp-report"',
  );
  if (!isDev) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  return response;
}

/**
 * Attach the standard security headers to a response that is returned
 * before the main CSP block runs (e.g. redirects, 404s). Keeps every
 * response from the middleware hardened, not just the pass-through case.
 */
function applySecurityHeaders(
  response: NextResponse,
  request: NextRequest,
): NextResponse {
  const isDev = process.env.NODE_ENV === "development";
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (!isDev) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|otf|map)).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};