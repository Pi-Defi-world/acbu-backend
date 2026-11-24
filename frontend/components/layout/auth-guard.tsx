"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { locales } from "@/i8n/locales";

// Auth route segments that are publicly accessible.
// These are matched both as bare paths (/auth/signin) and locale-prefixed
// paths (/en/auth/signin, /ar/auth/signin, etc.).
const PUBLIC_PATHS = [
  "/auth/signin",
  "/auth/signup",
  "/auth/2fa",
  "/auth/oauth/callback",
  "/recovery",
  "/auth/oauth/callback",
];

function isPublicPath(pathname: string): boolean {
  // Match bare paths: /auth/signin, /recovery, etc.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")))
    return true;
  // Match locale-prefixed paths: /en/auth/signin, /ar/auth/2fa, etc.
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (
      PUBLIC_PATHS.some(
        (p) => pathname === prefix + p || pathname.startsWith(prefix + p + "/"),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Extract the locale segment from a pathname, e.g. /en/... → 'en'. */
function getLocaleFromPath(pathname: string): string {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`))
      return locale;
  }
  return "en";
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isHydrated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (!isPublic && isHydrated && !isAuthenticated) {
      const locale = getLocaleFromPath(pathname);
      router.replace(`/${locale}/auth/signin`);
    }
  }, [isAuthenticated, isHydrated, isPublic, pathname, router]);

  if (!isPublic && (!isHydrated || !isAuthenticated)) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return <React.Fragment>{children}</React.Fragment>;
}