import type { ReactNode } from "react";

/**
 * Locale layout for the [locale] route segment.
 *
 * The root layout (app/layout.tsx) now wraps ALL children in
 * NextIntlClientProvider, so non-locale pages (send, wallet, mint, bills,
 * etc.) also receive the i18n context.  This locale layout previously
 * duplicated that provider (and referenced Suspense/TranslationsFallback
 * that were never imported, which would break the build).
 *
 * It is kept as a pass-through so the [locale] segment still resolves.
 */
export default async function LocaleLayout({
  children,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  return <>{children}</>;
}
