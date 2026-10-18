// node --test scripts/ci-gate-refusals.test.mjs (from anywhere; no install needed). ci-gate.sh's summary of a run the mini
// refused jobs of, scripts/ci-gate-refusals.sh, run in bash as ci-gate.sh runs it, on a run's job list and failed log.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = '512107c14abcdef0512107c14abcdef0512107c1';

// The summary line for a run's jobs ("conclusion<TAB>name", sorted by name as ci-gate.sh sorts them) and failed log,
// under ci-gate.sh's flags.
function refusals(jobs, log, { gates = '', runner = 'macos', class1a = 'pool', default_beside = '', label = 'f1-landing' } = {}) {
  return execFileSync('bash', ['-c', 'set -uo pipefail; source "$0"; refusals "$1" "$2"', join(root, 'scripts/ci-gate-refusals.sh'), jobs.join('\n'), log.join('\n')], {
    encoding: 'utf8',
    env: { ...process.env, sha, gates, runner, class1a, default_beside, label },
  });
}

// ci-kit's job-started refusal, as a failed job's log carries it (run 39012865379), and an ordinary red.
const refusal = (job) => `${job}\tSet up runner\t2026-10-17T07:59:12.2418710Z ci-kit: a system dialog (UserNotificationCenter: source unknown) holds focus on the mini — dismiss it there and rerun`;
const red = (job) => `${job}\tRun .github/scripts/gate-run.sh\t2026-10-17T08:10:02.1000000Z   1 failed`;
const run = (defaultConclusion = 'failure') => [
  `${defaultConclusion}\te2e:default`,
  'failure\te2e:desk-web',
  'failure\te2e:library',
  'success\te2e:side',
  'failure\te2e:tools',
  'skipped\tpackaged',
  'success\tplan',
  'success\tprobes',
  'success\tstatic',
  'success\tunit',
  'success\tunit:darwin',
];

test("a relaunch that takes default names the run's other e2e groups in --default-beside", () => {
  const log = [refusal('e2e:default'), refusal('e2e:desk-web'), red('e2e:library'), refusal('e2e:tools')];
  assert.equal(
    refusals(run(), log),
    'ci-gate: refused by the mini (3): e2e:default e2e:desk-web e2e:tools; green (5): e2e:side probes static unit unit:darwin; red (1): e2e:library; ' +
      `relaunch the refused and the red (less any red baseline, Decision Log 58(c)): scripts/ci-gate.sh ${sha} --runner macos --class1a pool ` +
      '--gates e2e:default,e2e:desk-web,e2e:library,e2e:tools --default-beside desk-web,library,side,tools --label f1-landing --evidence\n',
  );
});

test("a relaunch of a relaunch keeps the groups its own --default-beside named, after the run's", () => {
  const log = [refusal('e2e:default'), refusal('e2e:tools')];
  assert.match(refusals(run(), log, { default_beside: 'artifacts, e2e:side default,c7' }), / --gates e2e:default,e2e:desk-web,e2e:library,e2e:tools --default-beside desk-web,library,side,tools,artifacts,c7 --label /);
});

test('a relaunch without default carries no --default-beside', () => {
  const line = refusals(run('success'), [refusal('e2e:desk-web'), refusal('e2e:tools')], { default_beside: 'side' });
  assert.match(line, / --gates e2e:desk-web,e2e:library,e2e:tools --label f1-landing --evidence\n$/);
  assert.doesNotMatch(line, /--default-beside/);
});

test('a refused plan relaunches the whole run with its own flags; a run nothing was refused in says nothing', () => {
  const planRefused = ['skipped\te2e:${{ matrix.group }}', 'skipped\tpackaged', 'failure\tplan', 'skipped\tprobes', 'skipped\tstatic', 'skipped\tunit', 'skipped\tunit:darwin'];
  assert.equal(
    refusals(planRefused, [refusal('plan')], { gates: 'e2e:default,e2e:side', default_beside: 'library,tools' }),
    `ci-gate: the mini refused the plan job, so nothing ran; relaunch the run: scripts/ci-gate.sh ${sha} --runner macos --class1a pool --gates e2e:default,e2e:side --default-beside library,tools --label f1-landing --evidence\n`,
  );
  assert.equal(refusals(planRefused, [refusal('plan')], { runner: '', class1a: '' }), `ci-gate: the mini refused the plan job, so nothing ran; relaunch the run: scripts/ci-gate.sh ${sha} --label f1-landing --evidence\n`);
  assert.equal(refusals(run(), [red('e2e:library')]), '');
});
