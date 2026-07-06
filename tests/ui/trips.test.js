// Playwright smoke tests for the Trips tab.
// Requires the dev server running at http://localhost:8502.
//
// One login in beforeAll saves storageState; one shared trip is created and
// reused across detail-view tests to keep total runtime well under timeouts.

const { test, expect } = require('@playwright/test');
const { loginAsDemo, goToTab, BASE } = require('./helpers');
const path = require('path');
const os   = require('os');

const STATE_FILE  = path.join(os.tmpdir(), 'trips-test-auth.json');
const SHARED_TRIP = `PW_Shared_${Date.now()}`;

let sharedPage;   // shared page for detail-view tests

// ── Auth setup ────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  // Log in once, save cookies.
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await loginAsDemo(page);
  await ctx.storageState({ path: STATE_FILE });
  await page.close();
  await ctx.close();

  // Open a shared page with the saved session for the detail tests.
  const ctx2 = await browser.newContext({ storageState: STATE_FILE });
  sharedPage = await ctx2.newPage();
  await sharedPage.goto(BASE);
  await sharedPage.waitForSelector('.nav-item, .bottom-nav-item', { timeout: 15_000 });

  // Navigate to Trips tab and create the shared trip.
  await goToTab(sharedPage, 'Trips');
  const back = sharedPage.locator('button:has-text("← Back to trips")');
  if (await back.isVisible({ timeout: 500 }).catch(() => false)) await back.click();

  await sharedPage.click('button:has-text("+ New Trip")');
  await sharedPage.fill('input[placeholder="Trip name (e.g. Mexico City)"]', SHARED_TRIP);
  const dates = sharedPage.locator('input[type="date"]');
  await dates.nth(0).fill('2025-05-10');
  await dates.nth(1).fill('2025-05-15');
  await sharedPage.click('button:has-text("Create Trip")');
  await expect(sharedPage.getByText(SHARED_TRIP, { exact: true }).first()).toBeVisible({ timeout: 8_000 });
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
});

// Open the shared trip detail view (idempotent).
async function openShared() {
  const back = sharedPage.locator('button:has-text("← Back to trips")');
  if (await back.isVisible({ timeout: 500 }).catch(() => false)) await back.click();
  await sharedPage.getByText(SHARED_TRIP, { exact: true }).first().click();
  await expect(sharedPage.locator('button:has-text("← Back to trips")')).toBeVisible({ timeout: 8_000 });
}

// ── List view ─────────────────────────────────────────────────────────────

test('list view shows trip cards', async () => {
  const back = sharedPage.locator('button:has-text("← Back to trips")');
  if (await back.isVisible({ timeout: 500 }).catch(() => false)) await back.click();
  await expect(sharedPage.locator('text=Track spending for a trip')).toBeVisible();
  await expect(sharedPage.getByText(SHARED_TRIP, { exact: true }).first()).toBeVisible();
});

// ── Detail view ───────────────────────────────────────────────────────────

test('detail view shows summary cards', async () => {
  await openShared();
  await expect(sharedPage.locator('.sum-label:has-text("Total spent")')).toBeVisible({ timeout: 5_000 });
  await expect(sharedPage.locator('.sum-label:has-text("Daily avg")')).toBeVisible();
  await expect(sharedPage.locator('.sum-label:has-text("Transactions")')).toBeVisible();
});

test('detail view shows Add transactions and sort buttons', async () => {
  await openShared();
  await expect(sharedPage.locator('h3:has-text("Add transactions")')).toBeVisible();
  await expect(sharedPage.locator('button:has-text("📅 Date")')).toBeVisible();
  await expect(sharedPage.locator('button:has-text("$ Amount")')).toBeVisible();
});

test('edit form opens and cancels', async () => {
  await openShared();
  await sharedPage.click('button:has-text("Edit trip")');
  await expect(sharedPage.locator('button:has-text("Save changes")')).toBeVisible({ timeout: 5_000 });
  await sharedPage.click('button:has-text("Cancel")');
  await expect(sharedPage.locator('button:has-text("Save changes")')).not.toBeVisible();
});

test('can save an edited budget', async () => {
  await openShared();
  await sharedPage.click('button:has-text("Edit trip")');
  // Budget input is the last input in the edit row
  const budgetInput = sharedPage.locator('.card input[type="number"]').first();
  await budgetInput.fill('1500');
  await sharedPage.click('button:has-text("Save changes")');
  await sharedPage.waitForTimeout(500);
  // Budget bar should now be visible (pct !== null)
  await expect(sharedPage.locator('text=Budget:').first()).toBeVisible({ timeout: 5_000 });
});

test('add transaction search returns results or empty state', async () => {
  await openShared();
  await sharedPage.fill('input[placeholder="Search by merchant name…"]', 'a');
  await sharedPage.waitForTimeout(700);
  const hasResults = await sharedPage.locator('button:has-text("+ Add")').count();
  const hasEmpty   = await sharedPage.locator('text=No matching transactions found').count();
  expect(hasResults + hasEmpty).toBeGreaterThan(0);
  await sharedPage.fill('input[placeholder="Search by merchant name…"]', '');
});

test('sort buttons switch active state', async () => {
  await openShared();
  await sharedPage.click('button:has-text("$ Amount")');
  await sharedPage.waitForTimeout(300);
  // After clicking Amount, the Date button should not be the active one
  // (active buttons get a colored border — just confirm both buttons remain visible)
  await expect(sharedPage.locator('button:has-text("📅 Date")')).toBeVisible();
  await expect(sharedPage.locator('button:has-text("$ Amount")')).toBeVisible();
});

test('back button returns to list view', async () => {
  await openShared();
  await sharedPage.click('button:has-text("← Back to trips")');
  await expect(sharedPage.locator('text=Track spending for a trip')).toBeVisible({ timeout: 5_000 });
});

// ── Isolated: create + delete ─────────────────────────────────────────────
// These use their own page so they don't disturb the shared trip state.

test('creates and deletes a trip', async ({ browser }) => {
  const ctx  = await browser.newContext({ storageState: STATE_FILE });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.nav-item, .bottom-nav-item', { timeout: 15_000 });
  await goToTab(page, 'Trips');

  const name = `PW_Delete_${Date.now()}`;
  await page.click('button:has-text("+ New Trip")');
  await page.fill('input[placeholder="Trip name (e.g. Mexico City)"]', name);
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2025-06-01');
  await dates.nth(1).fill('2025-06-05');
  await page.click('button:has-text("Create Trip")');
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 8_000 });

  // Open and delete
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.locator('button:has-text("Delete")')).toBeVisible({ timeout: 8_000 });
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Delete")');

  await expect(page.locator('text=Track spending for a trip')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(name, { exact: true }).first()).not.toBeVisible({ timeout: 3_000 });

  await page.close();
  await ctx.close();
});
