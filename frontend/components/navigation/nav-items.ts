import {
  Briefcase,
  Clock,
  Coins,
  HelpCircle,
  Home,
  Send,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { locales } from "@/i18n/locales";

export interface NavItem {
  /** Human readable label, used by both the tab bar and the sidebar. */
  name: string;
  /** App relative route, without the locale prefix. */
  href: string;
  icon: LucideIcon;
}

/**
 * Primary destinations.
 *
 * These are the tabs of the mobile bottom bar and the top level entries of the
 * desktop sidebar. Both surfaces read from this list so the two navigations
 * can never drift apart.
 */
export const primaryNavItems: NavItem[] = [
  { name: "Home", href: "/", icon: Home },
  { name: "Send", href: "/send", icon: Send },
  { name: "Mint", href: "/mint", icon: Coins },
  { name: "Business", href: "/business", icon: Briefcase },
  { name: "Wallet", href: "/wallet", icon: Wallet },
  { name: "Me", href: "/me", icon: User },
];

/**
 * Secondary destinations.
 *
 * The mobile tab bar has no room for them, so they are only rendered in the
 * desktop sidebar where there is vertical space to spare.
 */
export const secondaryNavItems: NavItem[] = [
  { name: "Activity", href: "/activity", icon: Clock },
  { name: "Help", href: "/help", icon: HelpCircle },
];

/**
 * Removes the leading locale segment from a pathname.
 *
 * Every route is served under a locale prefix (`/en/send`, `/ar/mint`, …), so
 * the navigation has to compare locale agnostic paths with the item href.
 */
export function stripLocalePrefix(pathname: string): string {
  const firstSegment = pathname.split("/")[1];
  if (firstSegment && (locales as readonly string[]).includes(firstSegment)) {
    const rest = pathname.slice(firstSegment.length + 1);
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

/**
 * Returns true when `pathname` points at the route described by `href`.
 *
 * Nested routes keep their parent highlighted (e.g. `/me/profile` highlights
 * the "Me" entry), and the locale prefix is ignored.
 */
export function isNavItemActive(
  pathname: string | null | undefined,
  href: string,
): boolean {
  if (!pathname) return false;

  const path = stripLocalePrefix(pathname);
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
