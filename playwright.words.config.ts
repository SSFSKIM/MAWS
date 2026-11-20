import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The word cut's words rig (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M0): its own invocation, which only
// `pnpm shots:words` names. The rig's file is e2e/words-shots.rig.ts, not a *.spec.ts, so neither the shared config's
// testMatch nor Playwright's default one collects it: the bare `pnpm e2e`, every e2e group and default's derivation
// list what they listed before. This is the shared config (its locale pin, its worker, timeout and reporters) with the
// rig as its whole selection.
export default defineConfig({
  ...base,
  testMatch: 'words-shots.rig.ts',
  testIgnore: [],
});
