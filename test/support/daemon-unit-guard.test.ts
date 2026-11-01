// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"; the architect's rulings on
// e2e:daemon-unit): the launchd group loads LaunchAgents into the account it runs in, so it refuses to start outside CI,
// in its package script and in its spec, before anything reaches launchd; and every label it installs is unique per
// run and per case, under one prefix the gate's cleanup sweeps.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ciRefusal, e2eLabel, E2E_LABEL_PREFIX, HOME_INSTANCE_RUNNER, homeInstanceRefusal, runIdOf } from '../../e2e/support/daemon-unit-guard.mjs';

const ROOT = join(__dirname, '../..');
const GUARD = join(ROOT, 'e2e/support/daemon-unit-guard.mjs');

describe('the CI guard', () => {
  it('refuses with one line naming the group and why, with neither CI nor GITHUB_ACTIONS set', () => {
    const refusal = ciRefusal({});
    expect(refusal).toBe("e2e:daemon-unit: refused outside CI (neither CI nor GITHUB_ACTIONS is set): it loads LaunchAgents into this account's launchd; nothing was touched");
    expect(refusal).not.toContain('\n');
    for (const value of ['', 'false', '0']) expect(ciRefusal({ CI: value, GITHUB_ACTIONS: value }), `CI=${JSON.stringify(value)}`).toBe(refusal);
  });

  it('lets a CI run through', () => {
    expect(ciRefusal({ CI: 'true' })).toBeNull();
    expect(ciRefusal({ GITHUB_ACTIONS: 'true' })).toBeNull();
    expect(ciRefusal({ CI: '1' })).toBeNull();
  });

  it('as a command, exits 1 with the refusal on stderr outside CI and 0 in CI, writing nothing else', () => {
    const run = (env: Record<string, string>) => spawnSync(process.execPath, [GUARD], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
    const outside = run({});
    expect([outside.status, outside.stdout, outside.stderr]).toEqual([1, '', `${ciRefusal({})}\n`]);
    const inside = run({ GITHUB_ACTIONS: 'true' });
    expect([inside.status, inside.stdout, inside.stderr]).toEqual([0, '', '']);
    const home = run({ GITHUB_ACTIONS: 'true', RUNNER_NAME: HOME_INSTANCE_RUNNER }); // P5 O5 M6: the mini's home instance
    expect([home.status, home.stdout, home.stderr]).toEqual([1, '', `${homeInstanceRefusal({ RUNNER_NAME: HOME_INSTANCE_RUNNER }, false)}\n`]);
  });

  it('is the package script’s step before Playwright, after the build (whose leading step the gate reads as the variant)', () => {
    const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(scripts['e2e:daemon-unit']!.split(' && ').slice(0, 2)).toEqual(['scripts/e2e-build.sh plain', 'node e2e/support/daemon-unit-guard.mjs']);
  });
});

describe('the labels', () => {
  it('names the GitHub run and its attempt, and the case', () => {
    expect(runIdOf({ GITHUB_RUN_ID: '40563335469', GITHUB_RUN_ATTEMPT: '2' })).toBe('40563335469-2');
    expect(e2eLabel('40563335469-2', 'a')).toBe('dev.maws.mawsd.e2e-40563335469-2-a');
    expect(e2eLabel('x', 'a').startsWith(E2E_LABEL_PREFIX)).toBe(true);
  });

  it('takes a random id with no run id, or one that is not a number', () => {
    expect(runIdOf({}, () => 'r4nd0m')).toBe('r4nd0m');
    expect(runIdOf({ GITHUB_RUN_ID: '../x' }, () => 'r4nd0m')).toBe('r4nd0m');
    expect(runIdOf({ GITHUB_RUN_ID: '7' })).toBe('7-1'); // no attempt: the first
    expect(runIdOf({})).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is a label launchd and the installer take: letters, digits, dots and dashes', () => {
    expect(e2eLabel(runIdOf({ GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' }), 'restart')).toMatch(/^[A-Za-z0-9.-]+$/);
  });
});

// P5 O5 M4 (the architect's ruling): no group that installs a unit mawsd runs on the mini's home instance
describe('the home instance’s refusal', () => {
  const RULE = "no group that installs a unit mawsd runs where the owner's own dev.maws.mawsd lives (the architect's ruling); nothing was installed";
  it('refuses on the mini’s home runner, naming the rule', () => {
    expect(homeInstanceRefusal({ RUNNER_NAME: 'ci-kit-mac-mini' }, false)).toBe(`refused on the mini's home instance (RUNNER_NAME ci-kit-mac-mini): ${RULE}`);
  });

  it('refuses where the owner’s dev.maws.mawsd is loaded, whatever the runner', () => {
    expect(homeInstanceRefusal({ RUNNER_NAME: 'GitHub Actions 1000001' }, true)).toBe(`refused: dev.maws.mawsd is loaded in this account's gui domain: ${RULE}`);
    expect(homeInstanceRefusal({}, true)).not.toBeNull();
  });

  it('lets a hosted or EC2 runner with no owner unit through', () => {
    expect(homeInstanceRefusal({ RUNNER_NAME: 'GitHub Actions 1000001' }, false)).toBeNull();
    expect(homeInstanceRefusal({ RUNNER_NAME: 'ci-kit-ec2-mac-1' }, false)).toBeNull();
    expect(homeInstanceRefusal({}, false)).toBeNull();
  });
});
