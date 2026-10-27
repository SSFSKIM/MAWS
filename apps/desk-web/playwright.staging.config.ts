import { defineConfig } from '@playwright/test';

// Acceptance 8's desk-web check against the staging Worker (e2e-staging/; `apps/desk-hub/deploy/staging-run.sh desk-web
// <n>` runs it while staging serves a throwaway org). Playwright's own headless Chromium, never the system Chrome or a
// profile of the owner's. The browser holds the owner's Access token as a cookie, so nothing that could carry a request
// is recorded: no trace, no video, no failure screenshot; the spec's screenshots go where DESK_STAGING_SHOTS names.
export default defineConfig({
  testDir: 'e2e-staging',
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [['list']],
  outputDir: process.env.DESK_STAGING_SHOTS ? `${process.env.DESK_STAGING_SHOTS}/playwright` : 'test-results',
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
