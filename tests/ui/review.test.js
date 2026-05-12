// UI tests — Review tab
// All tests run as the demo user so real account data is never touched.
const { test, expect } = require('@playwright/test');
const { loginAsDemo, goToTab } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page);
  await goToTab(page, 'Review');
});

test('review tab loads with progress header', async ({ page }) => {
  await expect(page.locator('text=Transaction Review')).toBeVisible();
  // Progress percentage should be visible
  await expect(page.locator('text=/%/')).toBeVisible();
});

test('changing category on one row does not affect other rows', async ({ page }) => {
  // Wait for category pickers to load
  const pickers = page.locator('.cat-pill-btn');
  await pickers.first().waitFor({ timeout: 10_000 });

  const count = await pickers.count();
  if (count < 2) {
    test.skip('not enough transactions in demo batch to test isolation');
    return;
  }

  // Record all categories before
  const before = await pickers.allTextContents();

  // Change only the first row's category
  await pickers.first().click();
  await page.waitForSelector('.cat-menu', { timeout: 5_000 });
  await page.locator('.cat-menu-item').nth(1).click();  // pick second option
  await page.waitForTimeout(300);

  // Check categories after — only first row should differ
  const after = await pickers.allTextContents();
  for (let i = 1; i < after.length; i++) {
    expect(after[i]).toBe(before[i]);
  }
});

test('approve button is enabled when batch is loaded', async ({ page }) => {
  const approveBtn = page.locator('button:has-text(/approve/i)');
  // If there are transactions to review, button should be present and enabled
  const hasTransactions = await page.locator('text=Transaction Review').isVisible();
  if (hasTransactions) {
    const remaining = await page.locator('text=/remaining/i').textContent().catch(() => '0');
    if (!remaining.includes('0')) {
      await expect(approveBtn).toBeEnabled();
    }
  }
});

test('approving batch updates progress and clears rows', async ({ page }) => {
  const approveBtn = page.locator('button:has-text(/approve/i)');
  const hasBtn = await approveBtn.isVisible().catch(() => false);
  if (!hasBtn) {
    test.skip('no transactions to approve in demo account');
    return;
  }

  // Get remaining count before
  const beforeText = await page.locator('text=/remaining/i').textContent().catch(() => '');
  const beforeCount = parseInt(beforeText.match(/\d+/)?.[0] || '0');

  await approveBtn.click();
  // Wait for saving to complete
  await page.waitForSelector('button:has-text(/approve|caught up/i)', { timeout: 10_000 });

  // Progress should update (remaining decreases or all-done message)
  const afterText = await page.locator('text=/remaining|caught up/i').textContent().catch(() => '');
  const afterCount = parseInt(afterText.match(/\d+/)?.[0] || '0');

  expect(afterCount).toBeLessThan(beforeCount);
});

test('all-done state shows celebration when all transactions reviewed', async ({ page }) => {
  // Check if demo is already fully reviewed
  const caughtUp = await page.locator("text=You're all caught up").isVisible().catch(() => false);
  if (!caughtUp) {
    test.skip('demo account still has transactions to review');
    return;
  }
  await expect(page.locator('text=You\'re all caught up')).toBeVisible();
  // Celebration emoji should be shown
  await expect(page.locator('text=🎉')).toBeVisible();
});
