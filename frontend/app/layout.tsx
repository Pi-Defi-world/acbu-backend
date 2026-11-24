import React from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import OfflineIndicator from "@/components/offline-indicator-dynamic";
import VercelAnalytics from "@/components/vercel-analytics-dynamic";
import { AuthProvider } from "@/contexts/auth-context";
import { I18nProvider } from "@/contexts/i18n-context";
import { ErrorBoundary } from "@/components/error-boundary";
import { GlobalErrorHandler } from "@/components/global-error-handler";
import "./globals.css";
import { AuthGuard } from "@/components/layout/auth-guard";
import { AppLayout } from "@/components/app-layout";
import { WalletSetupModal } from "@/components/wallet-setup-modal";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { NavigationGuardProvider } from "@/contexts/navigation-guard-context";

function getApiOrigin(): string | null {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  const rawUrl = apiBaseUrl || apiUrl;
  if (!rawUrl) return null;

  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title: "ACBU - P2P Transfers",
  description: "Send and receive money securely with ACBU",
  generator: "v0.app",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#433875" },
    { media: "(prefers-color-scheme: dark)", color: "#1a0a2e" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") ?? undefined;
  const lang = headersList.get("x-locale") ?? "en";

  // Compute at render time to avoid module-scope env access (Edge / SSR safe)
  const apiOrigin = getApiOrigin();

  // Load next-intl messages for the resolved locale so that ALL pages
  // (not just [locale]/...) have access to NextIntlClientProvider context.
  // Non-locale pages (send, wallet, mint, bills, etc.) use useTranslations /
  // useFormatter / useLocale from next-intl and need this provider.
  const messages = await getMessages();

  if (
    process.env.NODE_ENV === "development" &&
    !process.env.NEXT_PUBLIC_API_BASE_URL?.trim() &&
    !process.env.NEXT_PUBLIC_API_URL?.trim()
  ) {
    console.error(
      "\n=================================================================\n" +
        "🚨 CRITICAL MISSING CONFIGURATION 🚨\n" +
        "NEXT_PUBLIC_API_BASE_URL (or NEXT_PUBLIC_API_URL) is not set.\n" +
        "Without this, POST/auth requests will hit Next.js and return 405 errors.\n" +
        "Please update your .env.local file with your backend API root.\n" +
        "=================================================================\n",
    );
  }

  return (
    <html lang={lang} dir="ltr" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/placeholder-logo.svg"
          as="image"
          type="image/svg+xml"
        />
        {apiOrigin && (
          <>
            <link rel="dns-prefetch" href={apiOrigin} />
            <link
              rel="preconnect"
              href={apiOrigin}
              crossOrigin="use-credentials"
            />
          </>
        )}
        {/*
          Print stylesheet is deferred until the browser enters print mode.
          media="print" prevents the browser from downloading and parsing
          this resource on non-print (screen/mobile) page loads.
        */}
        <link rel="stylesheet" href="/print.css" media="print" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {nonce && (
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  try {
                    const mql = window.matchMedia('(prefers-color-scheme: dark)');
                    function updateTheme(e) {
                      document.documentElement.classList.toggle('dark', e.matches);
                    }
                    mql.addEventListener('change', updateTheme);
                  } catch (err) {}
                })();
              `,
            }}
          />
        )}
      </head>
      <body className={`font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <GlobalErrorHandler />
          <OfflineIndicator />
          <ErrorBoundary level="app">
            <NextIntlClientProvider messages={messages} locale={lang}>
              <I18nProvider>
                <NavigationGuardProvider>
                  <AuthProvider>
                    <AppLayout>
                      <AuthGuard>{children}</AuthGuard>
                    </AppLayout>
                    <WalletSetupModal />
                    <Toaster />
                    {/*
                      F-065 SRI review: analytics is non-critical, so it is
                      dynamically loaded on the client instead of being emitted as a
                      beforeInteractive script that can block initial rendering.
                    */}
                    <VercelAnalytics />
                  </AuthProvider>
                </NavigationGuardProvider>
              </I18nProvider>
            </NextIntlClientProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
