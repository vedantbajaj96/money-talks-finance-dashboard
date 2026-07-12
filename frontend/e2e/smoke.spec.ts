// Smoke tests: log in as demo/demo and verify each tab renders without crashing.
// Run with: cd frontend && npx playwright test
// Requires backend running on :8502 and Vite dev server on :5175

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

let sharedContext: BrowserContext;
let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext();
  sharedPage = await sharedContext.newPage();

  await sharedPage.goto('/login');
  await sharedPage.fill('input[name="username"], input[type="text"]', 'demo');
  await sharedPage.fill('input[name="password"], input[type="password"]', 'demo');
  await sharedPage.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');

  // Wait for React app to mount
  await sharedPage.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.querySelector('.app, .sidebar, nav');
  }, { timeout: 20000 });
});

test.afterAll(async () => {
  await sharedContext.close();
});

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'txns',        label: 'Transactions' },
  { id: 'monthly',     label: 'Monthly' },
  { id: 'review',      label: 'Review' },
  { id: 'cashflow',    label: 'Cash Flow' },
  { id: 'flow',        label: 'Flow' },
  { id: 'categories',  label: 'Categories' },
  { id: 'trends',      label: 'Trends' },
  { id: 'investments', label: 'Investments' },
  { id: 'networth',    label: 'Net Worth' },
  { id: 'accounts',    label: 'Accounts' },
  { id: 'recurring',   label: 'Recurring' },
  { id: 'chat',        label: 'Chat' },
  { id: 'flagged',     label: 'Flagged' },
  { id: 'settings',    label: 'Settings' },
];

for (const { label } of TABS) {
  test(`${label} tab renders without errors`, async () => {
    // Click the nav item
    const navBtn = sharedPage.locator('.nav-item, .sidebar button').filter({ hasText: label });
    if (await navBtn.count() > 0) {
      await navBtn.first().click();
    } else {
      const moreBtn = sharedPage.locator('.bottom-nav button').filter({ hasText: 'More' });
      if (await moreBtn.count() > 0) {
        await moreBtn.click();
        await sharedPage.locator('.more-sheet-item').filter({ hasText: label }).click();
      }
    }

    await sharedPage.waitForTimeout(600);

    // No error boundary
    await expect(sharedPage.locator('text=Something went wrong in this tab')).toHaveCount(0);
    // Page has content
    await expect(sharedPage.locator('.page')).not.toBeEmpty();
  });
}
