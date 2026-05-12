// UI tests — Category search (via CategoryPicker in Review tab)
const { test, expect } = require('@playwright/test');
const { loginAsDemo, goToTab } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page);
  await goToTab(page, 'Review');
  // Open the first category picker in the review batch
  await page.locator('.cat-pill-btn').first().click();
  await page.waitForSelector('.cat-menu', { timeout: 5_000 });
});

test('category search returns relevant results for "dining"', async ({ page }) => {
  await page.fill('.cat-menu input', 'dining');
  await page.waitForTimeout(500);
  const items = page.locator('.cat-menu-item');
  const first = await items.first().textContent();
  expect(first).toMatch(/dining/i);
});

test('category search for "food" returns dining not travel', async ({ page }) => {
  await page.fill('.cat-menu input', 'food');
  await page.waitForTimeout(600);
  const items = await page.locator('.cat-menu-item').allTextContents();
  expect(items.length).toBeGreaterThan(0);
  // Top result should not be travel
  expect(items[0].toLowerCase()).not.toMatch(/travel/i);
});

test('transfer appears in category search', async ({ page }) => {
  await page.fill('.cat-menu input', 'transfer');
  await page.waitForTimeout(400);
  const body = await page.locator('.cat-menu').textContent();
  expect(body).toMatch(/transfer/i);
});
