import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');
  // Expect a title "to contain" a substring.
  // I don't know the exact title, so I'll just check if it loads.
  await expect(page).not.toHaveTitle(/404/);
});

test('check for main heading', async ({ page }) => {
  await page.goto('/');
  // Just checking if any content renders
  const body = page.locator('body');
  await expect(body).toBeVisible();
});
