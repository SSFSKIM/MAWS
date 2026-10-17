import { defineConfig, type ReporterDescription } from '@playwright/test';
import base from './playwright.config';
import { DASHBOARD_ACCEPTANCE } from './e2e/support/dashboard-acceptance';

// P3-E2 M6 (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; P3-E Decision Log 36 (2)): the dashboard acceptance
// invocation's own config, which only `pnpm e2e:dashboard` names. It is the shared config (its locale pin, its worker,
// timeout and reporters) with the declared acceptance files as its whole selection, so the package command passes no
// file argument, and the test-owned final reporter added: on the reserved `ci/e2-final-*` gate ref it writes the live
// run's bundle or fails the run by name; on any other run it does nothing. The shared playwright.config.ts is unchanged;
// the live and scale specs stay their own explicit scripts outside this list.
export default defineConfig({
  ...base,
  testMatch: DASHBOARD_ACCEPTANCE.map(({ file }) => file),
  reporter: [...(base.reporter as ReporterDescription[]), ['./e2e/support/dashboard-final-reporter.ts']],
});
