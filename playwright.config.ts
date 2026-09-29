import { defineConfig } from '@playwright/test';

// The Electron end-to-end smoke (charter §12 C1 *Test runners*). Playwright drives Electron through `_electron` only;
// no browser is installed. One worker: every test launches its own app, and the app owns real processes on this Mac.
export default defineConfig({
  testDir: 'e2e',
  // carried by C9 until the rebase over C6: the terminal spec drives the harness build, so it runs only under
  // `pnpm e2e:terminal` (MAWS_HARNESS=1)
  testIgnore: process.env.MAWS_HARNESS === '1' ? [] : ['terminal.spec.ts'],
  // carried by C9 until the rebase over C6
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
