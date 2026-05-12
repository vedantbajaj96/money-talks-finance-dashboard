// Shared helpers for UI tests.

const BASE      = 'http://localhost:8502';
const DEMO_USER = 'demo';
const DEMO_PASS = 'demo';

/**
 * Log in as the demo user and return the page ready for use.
 */
async function loginAsDemo(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', DEMO_USER);
  await page.fill('input[name="password"]', DEMO_PASS);
  await page.click('button[type="submit"]');
  // Wait for redirect away from login and app to render
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 10_000 });
  await page.waitForSelector('.nav-item, .bottom-nav-item', { timeout: 15_000 });
}

/**
 * Navigate to a named tab via the sidebar nav.
 */
async function goToTab(page, name) {
  await page.click(`.nav-item:has-text("${name}"), .bottom-nav-item:has-text("${name}")`);
  await page.waitForTimeout(500);
}

module.exports = { loginAsDemo, goToTab, BASE, DEMO_USER, DEMO_PASS };
