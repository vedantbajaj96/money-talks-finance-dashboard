// UI tests — authentication flows
const { test, expect } = require('@playwright/test');
const { loginAsDemo, BASE } = require('./helpers');

test('login page loads', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('wrong password shows error', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', 'demo');
  await page.fill('input[name="password"]', 'wrongpassword');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  // Should stay on login page with an error message
  await expect(page).toHaveURL(/login/);
  await expect(page.locator('.error')).toBeVisible();
});

test('demo login succeeds and lands on dashboard', async ({ page }) => {
  await loginAsDemo(page);
  await expect(page).not.toHaveURL(/login/);
  await expect(page.locator('.nav').first()).toBeVisible();
});

test('logout clears session and redirects to login', async ({ page }) => {
  await loginAsDemo(page);
  await page.click('button.avatar');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Sign out")');
  await expect(page).toHaveURL(/login/);
});

test('unauthenticated access redirects to login', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page).toHaveURL(/login/);
});
