import { defineConfig } from '@playwright/test';

// The Electron end-to-end smoke (charter §12 C1 *Test runners*). Playwright drives Electron through `_electron` only;
// no browser is installed. One worker: every test launches its own app, and the app owns real processes on this Mac.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
