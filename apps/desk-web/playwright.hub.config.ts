import { defineConfig, type ReporterDescription } from '@playwright/test';

// The desk's browser suites against DC3's local hub (e2e-hub/; `pnpm e2e:hub`, built app first): the suite starts
// `pnpm --filter desk-hub local` itself, on a free port. Kept out of the gate's `e2e` while DC3's M2 contract and its
// local command are provisional (the DC5 plan's Decision Log). Chromium as in playwright.config.ts.
export default defineConfig({
  testDir: 'e2e-hub',
  workers: 1,
  // One retry for the hosted Macs' timing long tail; the gate grants it only to direct, non-measured/non-live/non-secret e2e.
  retries: process.env.MAWS_E2E_RETRY === '1' ? 1 : 0,
  timeout: 30_000,
  reporter: [['list'], ...(process.env.MAWS_E2E_RETRY === '1' ? [['../../scripts/ci-flaky-reporter.mjs'] as ReporterDescription] : [])],
  outputDir: 'test-results',
  use: {
    browserName: 'chromium',
    channel: process.env.DESK_E2E_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined),
    headless: true,
    trace: 'retain-on-failure',
  },
});
