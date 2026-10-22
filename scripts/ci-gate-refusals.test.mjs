// node --test scripts/ci-gate-refusals.test.mjs (from anywhere; no install needed). ci-gate.sh's summary of a run the mini
// refused jobs of, scripts/ci-gate-refusals.sh, run in bash as ci-gate.sh runs it, on a run's job list and failed log.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = '512107c14abcdef0512107c14abcdef0512107c1';

// The summary line for a run's jobs ("conclusion<TAB>name", sorted by name as ci-gate.sh sorts them) and failed log,
// under ci-gate.sh's flags.
function refusals(jobs, log, { gates = 'all', runner = 'macos', class1a = 'pool', live = '', lane = '', default_beside = '', label = 'f1-landing' } = {}) {
  return execFileSync('bash', ['-c', 'set -uo pipefail; source "$0"; refusals "$1" "$2"', join(root, 'scripts/ci-gate-refusals.sh'), jobs.join('\n'), log.join('\n')], {
    encoding: 'utf8',
    env: { ...process.env, sha, gates, runner, class1a, live, lane, default_beside, label },
  });
}

// ci-kit's job-started refusal, as a failed job's log carries it (run 39012865379), and an ordinary red.
const refusal = (job) => `${job}\tSet up runner\t2026-10-17T07:59:12.2418710Z ci-kit: a system dialog (UserNotificationCenter: source unknown) holds focus on the mini — dismiss it there and rerun`;
// ci-kit's measured-job guard refusing a MEASURED_E2E group at its first step, when the mini's desktop did not settle in
// its bound (ci-kit #58, SSFSKIM/ci-kit/mac/settle@v1).
const settleRefusal = (job) => `${job}\tRun SSFSKIM/ci-kit/mac/settle@v1\t2026-10-19T09:31:02.5512340Z ci-kit: the mini did not settle for a measured job within 15 min (load 7.20, display @1x); waited 900 s; start: frontmost=터미널 display=2560x1440@1x remote=parsec load=15.70/11.06/6.38 computeruse=none; refusal: frontmost=터미널 display=2560x1440@1x remote=none load=7.20/9.81/8.10 computeruse=none — fix that there and rerun`;
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

test("the measured-job guard's refusal at a job's first step counts as refused, beside the job-started check's", () => {
  const measured = ['failure\te2e:artifacts-perf', 'failure\te2e:document-scale', 'success\te2e:presentations-scale', 'success\tplan'];
  assert.equal(
    refusals(measured, [settleRefusal('e2e:artifacts-perf'), refusal('e2e:document-scale')], { class1a: '' }),
    'ci-gate: refused by the mini (2): e2e:artifacts-perf e2e:document-scale; green (1): e2e:presentations-scale; red (0): none; ' +
      `relaunch the refused and the red (less any red baseline, Decision Log 58(c)): scripts/ci-gate.sh ${sha} --runner macos ` +
      '--gates e2e:artifacts-perf,e2e:document-scale --label f1-landing --evidence\n',
  );
});

test("a relaunch of a relaunch keeps the groups its own --default-beside named, after the run's", () => {
  const log = [refusal('e2e:default'), refusal('e2e:tools')];
  assert.match(refusals(run(), log, { default_beside: 'artifacts, e2e:side default,c7' }), / --gates e2e:default,e2e:desk-web,e2e:library,e2e:tools --default-beside desk-web,library,side,tools,artifacts,e2e:side,c7 --label /);
});

test("an own name is carried verbatim, so a prefix doubled by mistake stays an unknown name on the relaunch", () => {
  const log = [refusal('e2e:default'), refusal('e2e:tools')];
  assert.match(refusals(run(), log, { default_beside: 'e2e:e2e:side' }), / --default-beside desk-web,library,side,tools,e2e:e2e:side --label /);
});

// ci-gate.sh refuses a --default-beside value with a character that is not inert in the printed relaunch command, before
// it touches git or gh; a valid list gets past that check and fails later on the missing target.
test('--default-beside with shell metacharacters is refused with exit 2, a valid list is not', () => {
  const gate = (value) => spawnSync('bash', [join(root, 'scripts/ci-gate.sh'), '/nonexistent', '--gates', 'all', '--default-beside', value], { encoding: 'utf8' });
  const refused = gate('library;x');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^ci-gate: --default-beside takes group names .*, not library;x\n$/);
  const passed = gate('side,library');
  assert.doesNotMatch(passed.stderr, /--default-beside takes/);
  assert.match(passed.stderr, /no commit \/nonexistent/);
});

// On the pool unit runs as shards, `unit <k>/<n>` (gate-plan.mjs's UNIT_SHARDS), jobs of the one gate `unit`.
const shardedRun = ['failure\te2e:library', 'success\te2e:side', 'success\tplan', 'success\tprobes', 'success\tstatic', 'success\tunit 1/4', 'failure\tunit 2/4', 'success\tunit 3/4', 'failure\tunit 4/4', 'success\tunit:darwin'];

test('a red unit shard relaunches as the gate unit, once however many shards were red', () => {
  assert.equal(
    refusals(shardedRun, [refusal('e2e:library'), red('unit 2/4'), red('unit 4/4')]),
    'ci-gate: refused by the mini (1): e2e:library; green (6): e2e:side probes static unit 1/4 unit 3/4 unit:darwin; red (2): unit 2/4 unit 4/4; ' +
      `relaunch the refused and the red (less any red baseline, Decision Log 58(c)): scripts/ci-gate.sh ${sha} --runner macos --class1a pool ` +
      '--gates e2e:library,unit --label f1-landing --evidence\n',
  );
});

test('a refused job is matched by its whole name, a space in it included', () => {
  const jobs = shardedRun.map((job) => job.replace(/^\w+\tunit 1\/4$/, 'failure\tunit 1/4'));
  assert.match(
    refusals(jobs, [refusal('e2e:library'), refusal('unit 1/4'), red('unit 2/4'), red('unit 4/4')]),
    /^ci-gate: refused by the mini \(2\): e2e:library unit 1\/4; green \(5\): e2e:side probes static unit 3\/4 unit:darwin; red \(2\): unit 2\/4 unit 4\/4; .* --gates e2e:library,unit --label /,
  );
});

test('a relaunch without default carries no --default-beside', () => {
  const line = refusals(run('success'), [refusal('e2e:desk-web'), refusal('e2e:tools')], { default_beside: 'side' });
  assert.match(line, / --gates e2e:desk-web,e2e:library,e2e:tools --label f1-landing --evidence\n$/);
  assert.doesNotMatch(line, /--default-beside/);
});

test('a refused plan relaunches the whole run with its own flags, --gates included; a run nothing was refused in says nothing', () => {
  const planRefused = ['skipped\te2e-build', 'skipped\te2e:${{ matrix.group }}', 'skipped\te2e:${{ matrix.group }}', 'skipped\tpackaged', 'failure\tplan', 'skipped\tprobes', 'skipped\tstatic', 'skipped\tunit', 'skipped\tunit:darwin'];
  assert.equal(
    refusals(planRefused, [refusal('plan')], { gates: 'e2e:default,e2e:side', default_beside: 'library,tools' }),
    `ci-gate: the mini refused the plan job, so nothing ran; relaunch the run: scripts/ci-gate.sh ${sha} --runner macos --class1a pool --gates e2e:default,e2e:side --default-beside library,tools --label f1-landing --evidence\n`,
  );
  // A whole-set run relaunches as one: ci-gate.sh refuses a call that names no gates.
  assert.equal(refusals(planRefused, [refusal('plan')], { gates: 'all', runner: '', class1a: '' }), `ci-gate: the mini refused the plan job, so nothing ran; relaunch the run: scripts/ci-gate.sh ${sha} --gates all --label f1-landing --evidence\n`);
  assert.equal(refusals(run(), [red('e2e:library')]), '');
});

// A failed build skips the whole guest matrix: GitHub exposes its expression, not the groups the plan selected.
for (const conclusion of ['failure', 'cancelled']) {
  for (const gates of ['all', 'e2e:default,e2e:widgets,e2e:library']) {
    test(`a ${conclusion} e2e build relaunches the requested ${gates} set, including unnamed skipped guest groups`, () => {
      const jobs = [
        `${conclusion}\te2e-build (harness)`,
        'success\te2e-build (plain)',
        'skipped\te2e:${{ matrix.group }}',
        'failure\te2e:library',
        'success\tplan',
      ];
      const line = refusals(jobs, [red('e2e-build (harness)'), refusal('e2e:library')], { gates, lane: 'vm', default_beside: 'side,tools' });
      assert.match(line, /e2e-build.*guest groups.*relaunch the run:/);
      assert.equal(
        line.slice(line.indexOf('scripts/ci-gate.sh')),
        `scripts/ci-gate.sh ${sha} --runner macos --class1a pool --lane vm --gates ${gates} --default-beside library,side,tools --label f1-landing --evidence\n`,
      );
    });
  }
}

test('a green build relaunches only the refused guest gate, ignoring the unexpanded skipped host matrix', () => {
  const jobs = [
    'success\te2e-build (harness)',
    'success\te2e-build (plain)',
    'skipped\te2e:${{ matrix.group }}',
    'failure\te2e:document-app',
    'success\te2e:widgets',
    'success\tplan',
  ];
  const line = refusals(jobs, [refusal('e2e:document-app')], { lane: 'vm', default_beside: 'side' });
  assert.equal(
    line.slice(line.indexOf('scripts/ci-gate.sh')),
    `scripts/ci-gate.sh ${sha} --runner macos --class1a pool --lane vm --gates e2e:document-app --label f1-landing --evidence\n`,
  );
});

test('a live run relaunches live, its refused groups and a refused plan alike', () => {
  const liveRun = ['failure\te2e:library-live', 'success\te2e:presentations-live', 'success\tplan'];
  assert.match(refusals(liveRun, [refusal('e2e:library-live')], { live: 'yes', class1a: '' }), / scripts\/ci-gate\.sh \w+ --runner macos --live --gates e2e:library-live --label /);
  const planRefused = ['failure\tplan', 'skipped\te2e:library-live'];
  assert.match(refusals(planRefused, [refusal('plan')], { live: 'yes', gates: 'e2e:library-live' }), / --class1a pool --live --gates e2e:library-live --label /);
});

// ci-kit's VM lane: a run sent to the guest (--lane vm) relaunches there, the guest's own refusals (a dialog in the
// guest, a display off its geometry) counted as the host's are.
test('a run on a Lane: relaunches on it, its refused groups and a refused plan alike', () => {
  const guestRefusal = (job) => `${job}\tSet up runner\t2026-10-22T09:00:00.0000000Z ci-kit: the guest on the mini shows a display of 1024x768@2x, under 1600 pt wide — rerun`;
  const vmRun = ['failure\te2e:document-app', 'success\te2e:widgets', 'success\tplan'];
  assert.equal(
    refusals(vmRun, [guestRefusal('e2e:document-app')], { lane: 'vm', class1a: '' }),
    'ci-gate: refused by the mini (1): e2e:document-app; green (1): e2e:widgets; red (0): none; ' +
      `relaunch the refused and the red (less any red baseline, Decision Log 58(c)): scripts/ci-gate.sh ${sha} --runner macos --lane vm ` +
      '--gates e2e:document-app --label f1-landing --evidence\n',
  );
  const planRefused = ['failure\tplan', 'skipped\te2e:document-app'];
  assert.match(refusals(planRefused, [refusal('plan')], { lane: 'vm-trial', gates: 'e2e:document-app' }), / --class1a pool --lane vm-trial --gates e2e:document-app --label /);
});
