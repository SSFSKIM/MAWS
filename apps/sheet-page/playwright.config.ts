import { defineConfig } from '@playwright/test';

// The page's browser suite (§Q; T24, T27): the built page served by the built `mawsd`, run as a process over scratch
// directories (e2e/rig.ts), driven in Chromium. Playwright's own Chromium, which the gate's sheet-page job installs on
// Linux, the only place the gate runs it; SHEET_E2E_CHANNEL names another (`chrome` for a Mac's installed Chrome, by
// hand). One worker: each test owns a daemon, and a Mac runs this under the load rule.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(process.env.SHEET_E2E_CHANNEL && { channel: process.env.SHEET_E2E_CHANNEL }) } }],
});
