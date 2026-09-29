import { defineConfig } from '@playwright/test';

// The Electron end-to-end smoke (charter §12 C1 *Test runners*). Playwright drives Electron through `_electron` only;
// no browser is installed. One worker: every test launches its own app, and the app owns real processes on this Mac.
export default defineConfig({
  testDir: 'e2e',
  // C6: the transcript spec drives the harness build, so it runs only under `pnpm e2e:transcript` (MAWS_HARNESS=1).
  // C9 (inside C6's block, wave-2 ledger (d)): so does the terminal spec, under `pnpm e2e:terminal`.
  testIgnore: process.env.MAWS_HARNESS === '1' ? [] : ['transcript.spec.ts', 'terminal.spec.ts'],
  // end C6
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
