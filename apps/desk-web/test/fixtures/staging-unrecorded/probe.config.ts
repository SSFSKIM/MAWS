import { defineConfig } from '@playwright/test';

// The staging check's Playwright run, its recording settings as playwright.staging.config.ts sets them, around a test
// that fails while its page shows a secret (test/staging-recording.test.ts runs it).
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 3_000,
  reporter: [['list']],
  outputDir: process.env.PROBE_OUT,
  use: { browserName: 'chromium', headless: true, trace: 'off', video: 'off', screenshot: 'off' },
});
