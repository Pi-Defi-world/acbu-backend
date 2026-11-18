"use client";

import React, { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  isNavItemActive,
  primaryNavItems,
  secondaryNavItems,
  type NavItem,
} from "@/components/navigation/nav-items";
import { useNavigationGuard } from "@/contexts/navigation-guard-context";
import { cn } from "@/lib/utils";

interface SidebarLinkProps {
  item: NavItem;
  pathname: string | null;
  onNavigate: (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => void;
}

/**
 * A single destination of the desktop sidebar.
 *
 * Rendered as a real link so the browser keeps its native affordances
 * (middle click, "copy link address", prefetching on hover).
 */
function SidebarLink({ item, pathname, onNavigate }: SidebarLinkProps) {
  const isActive = isNavItemActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        onClick={(event) => onNavigate(event, item.href)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.name}</span>
      </Link>
    </li>
  );
}

/**
 * Desktop navigation.
 *
 * Rendered next to the page content from `md` upwards and hidden below it, so
 * that the mobile bottom tab bar stays the only navigation on small screens.
 */
export function DesktopSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { hasUnsavedChanges, confirmNavigation } = useNavigationGuard();

  const handleNavigate = useCallback(
    async (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // Nothing to confirm: let the link navigate as usual.
      if (!hasUnsavedChanges) return;

      // `preventDefault` only works while the event is being dispatched, so it
      // has to happen synchronously — the confirmation dialog is awaited
      // afterwards and the navigation is performed manually.
      event.preventDefault();
      const confirmed = await confirmNavigation();
      if (confirmed) router.push(href);
    },
    [hasUnsavedChanges, confirmNavigation, router],
  );

  return (
    <nav
      data-testid="desktop-sidebar"
      aria-label="Desktop navigation"
      className="bg-card border-border sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r md:flex"
    >
      <div className="border-border flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground grid h-8 w-8 place-items-center rounded-lg text-sm font-bold"
        >
          A
        </span>
        <span className="text-foreground text-base font-semibold">ACBU</span>
      </div>

      <ul
        data-testid="desktop-sidebar-primary"
        className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        {primaryNavItems.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            pathname={pathname}
            onNavigate={handleNavigate}
          />
        ))}
      </ul>

      <ul
        data-testid="desktop-sidebar-secondary"
        className="border-border flex flex-col gap-1 border-t p-3"
      >
        {secondaryNavItems.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            pathname={pathname}
            onNavigate={handleNavigate}
          />
        ))}
      </ul>
    </nav>
  );
}
