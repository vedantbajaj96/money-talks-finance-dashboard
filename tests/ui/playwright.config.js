// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout:  30_000,
  workers:  1,          // run sequentially — avoids overwhelming the dev server
  use: {
    baseURL:   'http://localhost:8502',
    headless:  true,
    viewport:  { width: 1280, height: 800 },
  },
});
