import { defineConfig, type ReporterDescription } from '@playwright/test';
import { finalBundleOption } from './e2e/support/final-bundle-reporter';

// The test process formats its expectations as the app formats its dates (a spec computes "in 1m" with the app's own
// formatters), and the app runs in en-US (launch.ts's E2E_APP_ARGS). Node's Intl default follows LC_ALL, then
// LC_MESSAGES, then LANG, read when a process starts, so it is set here, before the workers are forked (gate-offload
// §3.6: on the Mac mini the runner has no LANG, so the test process wrote English while the app wrote the machine's
// Korean; on a Korean MacBook both wrote Korean).
process.env.LC_ALL = 'en_US.UTF-8';

const FINAL_REPORTER = finalBundleReporter();

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
  // E13 (inside C6's block, as E4a's): so does cua's primitive server spec, under `pnpm e2e:browser-cua` (E4c's browser
  // tools spec and E4d's live proof through them retired with the tools on 2026-10-08, P1 A-54).
  // cua board #90 (inside C6's block, as E13's): so does the Chrome-like top chrome's spec, under `pnpm e2e:browser-chrome`.
  // P3-B (inside C6's block, as cua #90's): so does the document editor's spec, under `pnpm e2e:document`.
  testIgnore: process.env.MAWS_HARNESS === '1' ? [] : ['transcript.spec.ts', 'terminal.spec.ts', 'code-tools.spec.ts', 'agent-tools.spec.ts', /* E5 start */ 'code-editor.spec.ts', /* E5 end */ /* E1 start */ 'maws-tools.spec.ts' /* E1 end */, /* E2 start */ 'deliverables.spec.ts' /* E2 end */, /* E4a start */ 'browser.spec.ts' /* E4a end */, /* E4d start */ 'browser-comment.spec.ts' /* E4d end */, /* E4b start */ 'browser-import.spec.ts' /* E4b end */, /* E13 start */ 'browser-cua.spec.ts' /* E13 end */, /* cua #90 start */ 'browser-chrome.spec.ts' /* cua #90 end */, /* P3-B start */ 'document-editor.spec.ts' /* P3-B end */, /* P3-F1 start */ 'document-editor-width.spec.ts' /* P3-F1 end */],
  // end C6
  // C8a start: so does the panel spec, under `pnpm e2e:panel` (its product-app cases pass MAWS_HARNESS=0 per launch),
  // and the live check against this checkout runs only when named under MAWS_PANEL_LIVE=1 (it skips itself otherwise).
  // A file runs when it matches `testMatch` and not `testIgnore`, so narrowing `testMatch` leaves C6's list whole.
  ...(process.env.MAWS_HARNESS === '1' || process.env.MAWS_PANEL_LIVE === '1' ? {} : { testMatch: /(?<!\/panel(-live)?)\.spec\.ts$/ }),
  // C8a end
  workers: 1,
  retries: 0,
  timeout: 60_000,
  // Gate-offload Decision Log 50: a child's acceptance script names its reserved final label and the variant its live
  // spec needs (MAWS_E2E_FINAL_BUNDLE=<label>:<variant>); the final reporter then writes that build into the evidence
  // when the whole invocation passed on that final gate (e2e/support/final-bundle-reporter.ts). Such a group forbids
  // `test.only`, which would narrow it unseen by its command line (P3-F). Unset: as before.
  reporter: [['list'], ['html', { open: 'never' }], ...FINAL_REPORTER],
  forbidOnly: FINAL_REPORTER.length > 0,
});

function finalBundleReporter(): ReporterDescription[] {
  const options = finalBundleOption(process.env.MAWS_E2E_FINAL_BUNDLE);
  return options === null ? [] : [['./e2e/support/final-bundle-reporter.ts', options]];
}
