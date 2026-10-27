import { defineConfig } from '@playwright/test';
import { refuseRecording } from './e2e-staging/recording';

// Acceptance 8's desk-web check against the staging Worker (e2e-staging/; `apps/desk-hub/deploy/staging-run.sh desk-web
// <n>` runs it while staging serves a throwaway org). Playwright's own headless Chromium, never the system Chrome or a
// profile of the owner's. The browser holds the owner's Access token as a cookie, so nothing that could carry a request
// is recorded: no trace, no video, no failure screenshot, and no option or variable can turn one back on
// (e2e-staging/recording.ts); nor the failure context Playwright writes whatever these say, with a snapshot of the page
// (the spec's `test`, e2e-staging/unrecorded.ts). The spec's screenshots go where DESK_STAGING_SHOTS names.

// The runner's own process, before any test: a worker loads this file again under the runner's arguments.
if (process.env.TEST_WORKER_INDEX === undefined) refuseRecording(process.argv, process.env);

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
