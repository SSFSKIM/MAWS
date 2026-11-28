import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// The question sheet's live check (e2e/sheet-live.rig.ts; docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md,
// M6): its own invocation, `pnpm exec playwright test --config e2e/sheet-live.config.ts`. The driver is not a *.spec.ts,
// so neither the shared config's testMatch nor Playwright's default one collects it, and no e2e group lists it. This is
// the shared config (its locale pin, its one worker, its reporters) with the driver as its whole selection; the config
// sits beside the driver, so its test directory is this one.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'sheet-live.rig.ts',
  testIgnore: [],
  retries: 0,
});
