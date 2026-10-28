// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"): e2e:daemon-unit's guard and labels.
// The group loads LaunchAgents into the launchd of the account it runs in, so it runs only in CI (the hosted Macs, or
// the gate's own Mac): its package script runs this file between the build and Playwright, which exits 1 with a
// one-line refusal when neither CI nor GITHUB_ACTIONS is set, and its spec refuses the same way before any test. Every
// label it installs is `dev.maws.mawsd.e2e-<run>-<case>`, the run being the GitHub run and its attempt, or a random id;
// the gate job's last step (.github/scripts/launchd-sweep.sh) removes every label under the prefix, whichever run left
// it.
// Plain JavaScript the package script runs with no transform; its types are daemon-unit-guard.d.mts. No `import.meta`:
// Playwright's loader, which the spec imports it through, refuses it.
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import process from 'node:process';

export const E2E_LABEL_PREFIX = 'dev.maws.mawsd.e2e-';

const set = (value) => value !== undefined && value !== '' && value !== 'false' && value !== '0';

export function ciRefusal(env) {
  if (set(env.CI) || set(env.GITHUB_ACTIONS)) return null;
  return "e2e:daemon-unit: refused outside CI (neither CI nor GITHUB_ACTIONS is set): it loads LaunchAgents into this account's launchd; nothing was touched";
}

export function runIdOf(env, random = () => randomBytes(4).toString('hex')) {
  if (!/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) return random();
  return `${env.GITHUB_RUN_ID}-${/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ? env.GITHUB_RUN_ATTEMPT : '1'}`;
}

export const e2eLabel = (run, name) => `${E2E_LABEL_PREFIX}${run}-${name}`;

// run as the package script's step (`node e2e/support/daemon-unit-guard.mjs`), not when imported
if (basename(process.argv[1] ?? '') === 'daemon-unit-guard.mjs') {
  const refusal = ciRefusal(process.env);
  if (refusal !== null) {
    process.stderr.write(`${refusal}\n`);
    process.exit(1);
  }
}
