import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The desk's words rig (e2e/words-shots.rig.ts; docs/doperpowers/specs/2026-11-16-word-cut/scenes.md, "The desk's
// scenes"): its own invocation, which only `pnpm shots:words` names. The rig is not a *.spec.ts, so the shared config's
// default testMatch never collects it and the gated run lists what it listed before. This is the shared config with the
// rig as its whole selection, in Chromium alone (each scene sets its own viewport, the phone's included), and short
// action and expect timeouts so a scene that cannot reach its state is recorded as not reached in seconds.
export default defineConfig({
  ...base,
  testMatch: 'words-shots.rig.ts',
  timeout: 120_000,
  expect: { timeout: 5_000 },
  outputDir: 'test-results/words',
  use: { ...base.use, trace: 'off', actionTimeout: 5_000, navigationTimeout: 15_000 },
  projects: base.projects!.filter((project) => project.name === 'chromium'),
});
