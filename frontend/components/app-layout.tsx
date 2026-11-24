"use client";

import { MobileNav } from "./mobile-nav";
import { DesktopSidebar } from "./desktop-sidebar";
import { PageTransition } from "./page-transition";
import { usePathname } from "next/navigation";
import { SessionExpiryWarning } from "@/components/session-expiry-warning";
import { useSessionGuard } from "@/hooks/use-session-guard";
import { NavigationGuardProvider } from "@/contexts/navigation-guard-context";
import { stripLocalePrefix } from "@/components/navigation/nav-items";

const PUBLIC_PATHS = ["/auth/signin", "/auth/signup", "/auth/2fa", "/recovery"];

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  // Every route is served under a locale prefix, so the public paths have to
  // be compared against the locale agnostic path.
  const routePath = stripLocalePrefix(pathname ?? "");
  const isPublic = PUBLIC_PATHS.some(
    (p) => routePath.startsWith(p) || routePath === p,
  );
  const { status, dismissWarning, warningDismissed } = useSessionGuard();

  return (
    <div className="bg-background flex min-h-screen">
      {/*
        The navigation guard has to wrap the navigations as well as the page
        content, otherwise the bottom tab bar cannot ask for confirmation
        before leaving a page with unsaved changes.
      */}
      <NavigationGuardProvider>
        {!isPublic && <DesktopSidebar />}

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <main
            data-testid="app-main-content"
            className={`flex-1 ${!isPublic ? "pb-24 md:pb-0" : ""}`}
          >
            <PageTransition>{children}</PageTransition>
          </main>

          {!isPublic && (
            <SessionExpiryWarning
              status={status}
              onDismiss={dismissWarning}
              dismissed={warningDismissed}
            />
          )}
        </div>

        {!isPublic && <MobileNav />}
      </NavigationGuardProvider>
    </div>
  );
}
