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
  // E2 (inside C6's block, as E1's): so does the deliverables spec, under `pnpm e2e:deliverables`.
  // E4a (inside C6's block, as E2's): so does the browser spec, under `pnpm e2e:browser`.
  // E4d (inside C6's block, as E4a's): so does the comment mode spec, under `pnpm e2e:browser-comment`.
  // E4b (inside C6's block, as E4a's): so does the profile import spec, under `pnpm e2e:browser-import`.
  // E4c (inside C6's block, as E4a's): so does the browser tools spec, under `pnpm e2e:browser-tools`.
  // E13 (inside C6's block, as E4c's): so does cua's primitive server spec, under `pnpm e2e:browser-cua`.
  // E4d (M5): the live proof runs only under MAWS_E4D_LIVE=1 (`pnpm e2e:browser-comment-live`, spending money).
  testIgnore: process.env.MAWS_HARNESS === '1' ? [] : ['transcript.spec.ts', 'terminal.spec.ts', 'code-tools.spec.ts', 'agent-tools.spec.ts', /* E5 start */ 'code-editor.spec.ts', /* E5 end */ /* E1 start */ 'maws-tools.spec.ts' /* E1 end */, /* E2 start */ 'deliverables.spec.ts' /* E2 end */, /* E4a start */ 'browser.spec.ts' /* E4a end */, /* E4d start */ 'browser-comment.spec.ts' /* E4d end */, /* E4b start */ 'browser-import.spec.ts' /* E4b end */, /* E4c start */ 'browser-tools.spec.ts' /* E4c end */, /* E13 start */ 'browser-cua.spec.ts' /* E13 end */, /* E4d start: the live proof, only under its flag (it also skips itself) */ ...(process.env.MAWS_E4D_LIVE === '1' ? [] : ['browser-comment-live.spec.ts']) /* E4d end */],
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
