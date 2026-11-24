import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { UserMe } from "@/types/api";

// ---------------------------------------------------------------------------
// Session-based auth mock
//
// The app uses httpOnly cookies for authentication (no /api/auth/** Next.js
// route exists). AuthContext:
//   1. Reads `acbu_user_id` / `acbu_stellar_address` from sessionStorage.
//   2. Calls GET /users/me to validate the httpOnly cookie is still active.
//   3. Marks `isAuthenticated = true` only when both checks pass.
//
// To simulate an authenticated session in Playwright we must:
//   a) Intercept GET **/users/me and return a valid UserMe payload (200 OK).
//   b) Inject sessionStorage keys BEFORE the app boots so AuthContext finds them.
// ---------------------------------------------------------------------------

const MOCK_USER: UserMe = {
  user_id: "test-user-id-001",
  username: "testuser",
  email: "testuser@example.com",
  created_at: new Date().toISOString(),
};

const MOCK_STELLAR_ADDRESS =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

/**
 * Replaces the old (broken) `mockAuth` helper.
 *
 * Sets up:
 *   - A Playwright route intercept for GET *\/users/me → 200 UserMe JSON
 *   - sessionStorage keys so AuthContext reads a stored user on mount
 *
 * Call this BEFORE `page.goto()`.
 */
async function mockAuthSession(page: Page): Promise<void> {
  // 1. Intercept the session-validation endpoint the AuthContext calls.
  //    The pattern covers both bare paths (/users/me) and fully-qualified
  //    backend URLs (https://api.example.com/api/v1/users/me).
  await page.route("**/users/me", async (route) => {
    // Only intercept GET; let other methods fall through.
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_USER),
    });
  });

  // 2. Inject sessionStorage values before the page initialises.
  //    addInitScript runs in the browser context before any page script.
  await page.addInitScript(
    ({ userId, stellarAddress }) => {
      sessionStorage.setItem("acbu_user_id", userId);
      sessionStorage.setItem("acbu_stellar_address", stellarAddress);
    },
    { userId: MOCK_USER.user_id, stellarAddress: MOCK_STELLAR_ADDRESS },
  );
}

/**
 * Assert that the page rendered in authenticated state (not the signin redirect
 * and not stuck on the loading spinner).
 */
async function assertAuthenticated(page: Page): Promise<void> {
  // The AuthGuard shows a loading pulse while hydrating; wait for it to clear.
  await page
    .waitForFunction(() => !document.querySelector(".animate-pulse"), {
      timeout: 10_000,
    })
    .catch(() => {
      // If the element was never present that is fine — just continue.
    });

  // Should NOT have been redirected to the sign-in page.
  expect(page.url()).not.toMatch(/\/auth\/signin/);

  // sessionStorage should still hold our injected values (AuthContext didn't
  // clear them, meaning the /users/me mock was accepted as a valid session).
  const userId = await page.evaluate(() =>
    sessionStorage.getItem("acbu_user_id"),
  );
  expect(userId).toBe(MOCK_USER.user_id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");

  // Wait for any loading indicators to disappear.
  const loadingIndicator = page.locator(".animate-pulse");
  if (await loadingIndicator.isVisible().catch(() => false)) {
    await loadingIndicator
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  }

  await page.waitForTimeout(1000);

  // Handle any authentication or wallet setup modals.
  const skipButton = page.locator(
    'button:has-text("Skip"), button:has-text("Skip for now"), button:has-text("Close")',
  );
  if (await skipButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipButton.click();
    await page.waitForTimeout(1000);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Accessibility Tests", () => {
  test("mint page should have no axe violations", async ({ page }) => {
    await mockAuthSession(page);
    await page.goto("/mint");
    await waitForPageReady(page);
    await assertAuthenticated(page);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("burn page should have no axe violations", async ({ page }) => {
    await mockAuthSession(page);
    await page.goto("/burn");
    await waitForPageReady(page);
    await assertAuthenticated(page);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("send page should have no axe violations", async ({ page }) => {
    await mockAuthSession(page);
    await page.goto("/send");
    await waitForPageReady(page);
    await assertAuthenticated(page);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("savings withdraw page should have no axe violations", async ({
    page,
  }) => {
    await mockAuthSession(page);
    await page.goto("/savings/withdraw");
    await waitForPageReady(page);
    await assertAuthenticated(page);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("mint form interactions should be accessible", async ({ page }) => {
    await mockAuthSession(page);
    await page.goto("/mint");
    await waitForPageReady(page);
    await assertAuthenticated(page);

    // Wait for the mint tab to be active and content to load.
    await page.waitForTimeout(2000);

    const fiatSelectors = [
      "#fiat-account-select",
      "select:has(option)",
      '[name="fiat-account"]',
    ];

    let fiatSelect = null;
    for (const selector of fiatSelectors) {
      const element = page.locator(selector);
      if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
        fiatSelect = element;
        break;
      }
    }

    if (fiatSelect) {
      const options = await fiatSelect.locator("option").count();
      if (options > 1) {
        await fiatSelect.selectOption({ index: 1 });
      }
    }

    const amountSelectors = [
      "#fiat-amount-input",
      'input[type="number"]',
      'input[placeholder*="0.00"]',
    ];

    let amountInput = null;
    for (const selector of amountSelectors) {
      const element = page.locator(selector);
      if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
        amountInput = element;
        break;
      }
    }

    if (amountInput) {
      await amountInput.fill("100");
    }

    const mintButton = page.getByRole("button", { name: /Mint ACBU/i });
    if (await mintButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mintButton.click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });
    }

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("send form interactions should be accessible", async ({ page }) => {
    await mockAuthSession(page);
    await page.goto("/send");
    await waitForPageReady(page);
    await assertAuthenticated(page);

    await page.waitForTimeout(3000);

    const buttonSelectors = [
      'button:has-text("New Transfer")',
      'button:has-text("Send")',
      'button:has-text("Transfer")',
      '[aria-label="Create new transfer"]',
    ];

    let newTransferButton = null;
    for (const selector of buttonSelectors) {
      const element = page.locator(selector);
      if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
        newTransferButton = element;
        break;
      }
    }

    if (newTransferButton) {
      await newTransferButton.click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);
      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);
    }

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
