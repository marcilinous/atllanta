import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// The sandbox this suite was written in ships Chromium at a fixed path. Use it
// when it's actually there, otherwise fall back to Playwright's own download so
// the suite runs on a normal dev machine too.
const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = fs.existsSync(SANDBOX_CHROME)
  ? { executablePath: SANDBOX_CHROME }
  : {};

export default defineConfig({
  testDir: './tests',
  // The unit suite runs under `node --test` (npm run test:unit); Playwright
  // should only pick up the browser specs.
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions,
  },
  webServer: {
    command: 'npx serve . -p 3000',
    port: 3000,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
