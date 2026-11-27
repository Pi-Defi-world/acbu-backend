import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppLayout } from "@/components/app-layout";
import {
  isNavItemActive,
  primaryNavItems,
  stripLocalePrefix,
} from "@/components/navigation/nav-items";

const mocks = vi.hoisted(() => ({
  pathname: { value: "/en" },
  push: vi.fn(),
  replace: vi.fn(),
  confirmNavigation: vi.fn(),
}));

// jsdom does not implement `matchMedia`, which the page transition relies on
// to honour the "prefers-reduced-motion" setting.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.value,
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    prefetch: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/contexts/navigation-guard-context", () => ({
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useNavigationGuard: () => ({
    hasUnsavedChanges: false,
    setHasUnsavedChanges: vi.fn(),
    confirmNavigation: mocks.confirmNavigation,
  }),
}));

vi.mock("@/hooks/use-session-guard", () => ({
  useSessionGuard: () => ({
    status: "valid",
    ensureSession: vi.fn(),
    dismissWarning: vi.fn(),
    warningDismissed: false,
  }),
}));

function renderLayout(pathname: string) {
  mocks.pathname.value = pathname;
  return render(
    <AppLayout>
      <p>Page content</p>
    </AppLayout>,
  );
}

describe("responsive navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmNavigation.mockResolvedValue(true);
  });

  it("hides the bottom tab bar from the md breakpoint upwards", () => {
    renderLayout("/en");

    const tabBar = screen.getByTestId("mobile-nav");
    expect(tabBar.className).toContain("md:hidden");
  });

  it("renders the desktop sidebar from the md breakpoint upwards", () => {
    renderLayout("/en");

    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar.className).toContain("hidden");
    expect(sidebar.className).toContain("md:flex");
  });

  it("keeps the bottom clearance for the tab bar on mobile only", () => {
    renderLayout("/en");

    const main = screen.getByTestId("app-main-content");
    expect(main.className).toContain("pb-24");
    expect(main.className).toContain("md:pb-0");
  });

  it("exposes the same primary destinations in both navigations", () => {
    renderLayout("/en");

    const primaryNav = screen.getByTestId("desktop-sidebar-primary");
    const sidebarHrefs = within(primaryNav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    const tabBar = screen.getByTestId("mobile-nav");
    const tabBarLabels = within(tabBar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(sidebarHrefs).toEqual(primaryNavItems.map((item) => item.href));
    expect(tabBarLabels).toEqual(primaryNavItems.map((item) => item.name));
  });

  it("lists the secondary destinations in the desktop sidebar only", () => {
    renderLayout("/en");

    const secondaryNav = screen.getByTestId("desktop-sidebar-secondary");
    const secondaryHrefs = within(secondaryNav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(secondaryHrefs).toEqual(["/activity", "/help"]);

    const tabBar = screen.getByTestId("mobile-nav");
    expect(
      within(tabBar).queryByTestId("nav-activity"),
    ).not.toBeInTheDocument();
  });

  it("marks the current route as active in both navigations", () => {
    renderLayout("/en/send");

    const sidebar = screen.getByTestId("desktop-sidebar");
    const activeSidebarLink = within(sidebar).getByRole("link", {
      name: "Send",
    });
    expect(activeSidebarLink).toHaveAttribute("aria-current", "page");

    const tabBar = screen.getByTestId("mobile-nav");
    const activeTab = within(tabBar).getByRole("button", { name: "Send" });
    expect(activeTab).toHaveAttribute("aria-current", "page");
  });

  it("navigates through the router when a tab is pressed", async () => {
    renderLayout("/en");

    fireEvent.click(screen.getByTestId("nav-send"));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/send"));
  });

  it("renders no navigation on public routes", () => {
    renderLayout("/en/auth/signin");

    expect(screen.queryByTestId("mobile-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-sidebar")).not.toBeInTheDocument();
  });
});

describe("isNavItemActive", () => {
  it("matches the exact route", () => {
    expect(isNavItemActive("/send", "/send")).toBe(true);
    expect(isNavItemActive("/send", "/mint")).toBe(false);
  });

  it("ignores the locale prefix", () => {
    expect(isNavItemActive("/en/send", "/send")).toBe(true);
    expect(isNavItemActive("/ar/send", "/send")).toBe(true);
    expect(isNavItemActive("/en-NG/send", "/send")).toBe(true);
  });

  it("keeps the parent entry active for nested routes", () => {
    expect(isNavItemActive("/en/me/profile", "/me")).toBe(true);
    expect(isNavItemActive("/en/me/settings/security", "/me")).toBe(true);
  });

  it("only highlights home on the root route", () => {
    expect(isNavItemActive("/en", "/")).toBe(true);
    expect(isNavItemActive("/en/send", "/")).toBe(false);
  });

  it("handles a missing pathname", () => {
    expect(isNavItemActive(null, "/send")).toBe(false);
    expect(isNavItemActive(undefined, "/send")).toBe(false);
  });
});

describe("stripLocalePrefix", () => {
  it("removes a known locale segment", () => {
    expect(stripLocalePrefix("/en/send")).toBe("/send");
    expect(stripLocalePrefix("/en-NG/mint")).toBe("/mint");
  });

  it("maps the locale root to the app root", () => {
    expect(stripLocalePrefix("/en")).toBe("/");
  });

  it("keeps unknown first segments untouched", () => {
    expect(stripLocalePrefix("/send")).toBe("/send");
  });
});
