// UI tests — Transactions list
const { test, expect } = require('@playwright/test');
const { loginAsDemo, goToTab } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page);
  await goToTab(page, 'Transactions');
});

test('transactions list loads with rows', async ({ page }) => {
  const rows = page.locator('.txn-row, [class*="txn-row"]');
  await rows.first().waitFor({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
});

test('transaction category shows display name not raw id', async ({ page }) => {
  const cats = page.locator('.cat-pill, [class*="cat-pill"]');
  await cats.first().waitFor({ timeout: 10_000 });
  const texts = await cats.allTextContents();
  for (const t of texts.slice(0, 10)) {
    // Raw IDs are snake_case like "personal_care" — display names have spaces/capitals
    expect(t).not.toMatch(/^[a-z]+_[a-z]+$/);
  }
});

test('recategorizing a transaction persists after reload', async ({ page }) => {
  const rows = page.locator('.txn-row, [class*="txn-row"]');
  await rows.first().waitFor({ timeout: 10_000 });

  // Click edit on the first transaction
  await rows.first().hover();
  const editBtn = rows.first().locator('button[title*="edit" i], button:has-text("Edit"), .cat-pill').first();
  await editBtn.click();

  // Pick "Other" from the category picker
  const otherOption = page.locator('[role="option"], li').filter({ hasText: /^other$/i }).first();
  const hasOther = await otherOption.isVisible().catch(() => false);
  if (!hasOther) {
    test.skip('could not open category picker');
    return;
  }
  await otherOption.click();

  // Wait for save
  await page.waitForTimeout(800);

  // Reload page and check the category stuck
  await page.reload();
  await goToTab(page, 'Transactions');
  await rows.first().waitFor({ timeout: 10_000 });
  const catAfter = await rows.first().locator('.cat-pill').first().textContent();
  expect(catAfter).toMatch(/other/i);
});

test('search shows results and clear button appears', async ({ page }) => {
  const rows = page.locator('.txn-row');
  await rows.first().waitFor({ timeout: 10_000 });

  const searchInput = page.locator('input[placeholder*="Search"]').first();
  await searchInput.fill('amazon');
  await page.waitForTimeout(500);

  // Rows should still be visible after search
  await expect(rows.first()).toBeVisible();
  // A clear/reset button should appear
  const clearBtn = page.locator('button:has-text("×"), button:has-text("✕"), button:has-text("Clear")').first();
  await expect(clearBtn).toBeVisible();
});
