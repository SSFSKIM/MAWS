import { defineConfig } from '@playwright/test';

// The Electron end-to-end smoke (charter §12 C1 *Test runners*). Playwright drives Electron through `_electron` only;
// no browser is installed. One worker: every test launches its own app, and the app owns real processes on this Mac.
export default defineConfig({
  testDir: 'e2e',
  // C6: the transcript spec drives the harness build, so it runs only under `pnpm e2e:transcript` (MAWS_HARNESS=1).
  // C9 (inside C6's block, wave-2 ledger (d)): so does the terminal spec, under `pnpm e2e:terminal`.
  // C8c (inside C6's block, as C9's): so does the code tools spec, under `pnpm e2e:code`.
  // C8b (inside C6's block, as C9's and C8c's): so does the agent tools spec, under `pnpm e2e:agents`.
  // E5 (inside C6's block, as C8c's): so does the editor spec, under `pnpm e2e:code` beside the code tools spec.
  // E1 (inside C6's block, as C8b's): so does the `maws` tools spec, under `pnpm e2e:tools`.
  testIgnore: process.env.MAWS_HARNESS === '1' ? [] : ['transcript.spec.ts', 'terminal.spec.ts', 'code-tools.spec.ts', 'agent-tools.spec.ts', /* E5 start */ 'code-editor.spec.ts', /* E5 end */ /* E1 start */ 'maws-tools.spec.ts' /* E1 end */],
  // end C6
  // C8a start: so does the panel spec, under `pnpm e2e:panel` (its product-app cases pass MAWS_HARNESS=0 per launch),
  // and the live check against this checkout runs only when named under MAWS_PANEL_LIVE=1 (it skips itself otherwise).
  // A file runs when it matches `testMatch` and not `testIgnore`, so narrowing `testMatch` leaves C6's list whole.
  ...(process.env.MAWS_HARNESS === '1' || process.env.MAWS_PANEL_LIVE === '1' ? {} : { testMatch: /(?<!\/panel(-live)?)\.spec\.ts$/ }),
  // C8a end
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
