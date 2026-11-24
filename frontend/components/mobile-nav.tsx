"use client";

import React, { useRef, useState, useEffect, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Home, Send, Coins, Briefcase, User, Wallet } from "lucide-react";
import { useNavigationGuard } from "@/contexts/navigation-guard-context";
import {
  isNavItemActive,
  primaryNavItems,
} from "@/components/navigation/nav-items";

interface MobileNavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
}

export function MobileNav() {
  const locale = useLocale();
  const navItems: NavItem[] = [
    { name: "Home", href: `/${locale}`, icon: <Home className="h-5 w-5" /> },
    { name: "Send", href: `/${locale}/send`, icon: <Send className="h-5 w-5" /> },
    { name: "Mint", href: `/${locale}/mint`, icon: <Coins className="h-5 w-5" /> },
    {
      name: "Business",
      href: `/${locale}/business`,
      icon: <Briefcase className="h-5 w-5" />,
    },
    { name: "Wallet", href: `/${locale}/wallet`, icon: <Wallet className="h-5 w-5" /> },
    { name: "Me", href: `/${locale}/me`, icon: <User className="h-5 w-5" /> },
  ];
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const navigatingTo = useRef<string | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const { confirmNavigation } = useNavigationGuard();

  // The tab bar and the desktop sidebar share the same destination list, so
  // they can never drift apart.
  const navItems: MobileNavItem[] = primaryNavItems.map((item) => {
    const Icon = item.icon;
    return {
      name: item.name,
      href: item.href,
      icon: <Icon className="h-5 w-5" />,
    };
  });

  useEffect(() => {
    navigatingTo.current = null;
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const handleViewportChange = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const offset = window.innerHeight - (vv.height + vv.offsetTop);
      setBottomOffset(Math.max(0, offset));
    };

    const vv = window.visualViewport;
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);

    handleViewportChange();

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  async function handleNav(href: string) {
    if (isPending || navigatingTo.current !== null) return;
    if (isNavItemActive(pathname, href)) return;
    const confirmed = await confirmNavigation();
    if (!confirmed) return;
    navigatingTo.current = href;
    startTransition(() => {
      router.push(href);
      navigatingTo.current = null;
    });
  }

  return (
    <nav
      data-testid="mobile-nav"
      className="border-border bg-card fixed right-0 bottom-0 left-0 z-40 border-t transition-[bottom] duration-150 ease-out md:hidden"
      role="navigation"
      aria-label="Mobile navigation"
      style={{ bottom: `${bottomOffset}px` }}
    >
      <div className="flex h-20 items-center justify-between px-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href === `/${locale}` && (pathname === `/${locale}` || pathname === `/${locale}/`));
          return (
            <button
              key={item.href}
              data-testid={`nav-${item.name.toLowerCase()}`}
              onClick={() => handleNav(item.href)}
              aria-label={item.name}
              aria-current={isActive ? "page" : undefined}
              disabled={isPending}
              className={`flex h-20 flex-1 flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.icon}
              <span className="text-center text-xs font-medium">
                {item.name}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
