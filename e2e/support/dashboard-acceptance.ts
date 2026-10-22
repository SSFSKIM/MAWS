// The dashboard acceptance invocation's declared file list (P3-E2 M6 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md;
// P3-E Decision Logs 36 (2) and E2's execution Decision Log 31): the spec files `pnpm e2e:dashboard` runs, named in its
// own config (playwright.dashboard.config.ts) so the package command passes no file argument, and the number of cases
// each declares, which the final reporter compares with the root suite it was given (a narrowed run, by the command line
// or by the config, fails the reserved final run by name). test/support/final-invocation.test.ts keeps the counts equal
// to the specs' own `test(` declarations. The live and scale specs are separate explicit scripts, never listed here.
export const DASHBOARD_ACCEPTANCE: readonly { file: string; tests: number }[] = [
  { file: 'dashboard.spec.ts', tests: 4 },
  { file: 'dashboard-comments.spec.ts', tests: 1 },
  { file: 'dashboard-history.spec.ts', tests: 2 },
  { file: 'dashboard-export.spec.ts', tests: 4 },
  { file: 'dashboard-provisional.spec.ts', tests: 1 }, // P4-A2 G2.6: the dataset call's layer
];
