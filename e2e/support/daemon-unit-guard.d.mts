// P5 O2 M7: the types of e2e:daemon-unit's guard and labels (./daemon-unit-guard.mjs).

export const E2E_LABEL_PREFIX: 'dev.maws.mawsd.e2e-';
// The one-line refusal outside CI (neither CI nor GITHUB_ACTIONS set to a true value), or null in CI.
export function ciRefusal(env: Readonly<Record<string, string | undefined>>): string | null;
// `<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`, or `random()` (8 hex digits by default) without a numeric run id.
export function runIdOf(env: Readonly<Record<string, string | undefined>>, random?: () => string): string;
export function e2eLabel(run: string, name: string): string;
