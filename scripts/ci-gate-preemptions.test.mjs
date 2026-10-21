// node --test scripts/ci-gate-preemptions.test.mjs (from anywhere; no install needed). ci-gate.sh's retry of the jobs a
// spot preemption ended, scripts/ci-gate-preemptions.sh, run in bash as ci-gate.sh runs it against a fake `gh` that
// plays a run's attempts the way GitHub's API reports them.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = '39110000001';

// ci-kit's simulated preemption, SSFSKIM/ci-kit-sandbox run 38927837115, as recorded: the job's fields that ci-gate.sh
// reads (GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs) and its annotations (GET .../check-runs/{job_id}/annotations).
const recorded = {
  job: { id: 117063935642, name: 'ci / hold', status: 'completed', conclusion: 'failure', runner_name: 'ci-kit-gce-hs7ekfgg2o', run_attempt: 1 },
  annotations: [
    { path: '.github', start_line: 2, end_line: 2, annotation_level: 'failure', title: '', message: 'The operation was canceled.', raw_details: '' },
    { path: '.github', start_line: 12, end_line: 12, annotation_level: 'failure', title: '', message: 'Process completed with exit code 130.', raw_details: '' },
  ],
};
// A MAWS pool job ended the same way: the recorded job's conclusion, runner shape and annotations under a gate's name.
const preempted = (name, runner = 'ci-kit-gce-hs99r2glck', annotations = recorded.annotations) => ({ name, conclusion: recorded.job.conclusion, runner_name: runner, annotations });
// MAWS's own pool jobs, preempted mid-step (simulated, run 39112141861: unit 117630377116 in its vitest step, static
// 117630377153 in typecheck), carry the first annotation alone: the exit-130 line is the sandbox's step's own.
const preemptedMidStep = (name, runner) => preempted(name, runner, [{ path: '.github', annotation_level: 'failure', title: '', message: 'The operation was canceled.', raw_details: '' }]);
const green = (name, runner = 'ci-kit-gce-hs99qt76im') => ({ name, conclusion: 'success', runner_name: runner, annotations: [] });
const red = (name, runner = 'ci-kit-gce-hs99sz4glw') => ({ name, conclusion: 'failure', runner_name: runner, annotations: [{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }] });
const plan = { name: 'plan', conclusion: 'success', runner_name: 'GitHub Actions 1000005582', annotations: [] };
const classOneA = (unit) => [plan, green('probes', 'ci-kit-gce-hs99q9dpex'), green('static'), unit];

// The fake gh. Attempt 1 is the scenario's jobs; each rerun makes the next attempt, as GitHub does: every job gets a
// new id, the rerun job takes the scenario's next outcome for it, and the others are copied without their
// annotations (observed on SSFSKIM/ci-kit-sandbox run 39110966829). A rerun with an empty --job is the whole run's, as
// gh makes it (it takes --job only when non-empty): every job runs again as in attempt 1. It answers only the calls and
// --jq expressions the script makes, so a changed call fails here rather than passing on a guess, and it refuses a
// rerun by any id but the latest attempt's, one the scenario gives no outcome for, or one while the run is running.
// Two scenario options play GitHub's API as it can be read: `lag`, the reads of the run after each rerun that show the
// new attempt running, its rerun jobs in progress (`gh run view` may already show the run completed), and
// `unreadJobs`, { <attempt>: n }, the reads of an attempt's jobs that fail before one succeeds.
const fakeGh = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = path.dirname(process.argv[1]);
const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
const statePath = path.join(dir, 'state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { reruns: [], running: 0, unread: {} };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const args = process.argv.slice(2);
const fail = (message) => { process.stderr.write(message + '\n'); process.exit(1); };
const wholeRun = '<whole run>';
const attempts = [scenario.jobs.map((job) => ({ ...job }))];
const taken = {};
for (const name of state.reruns) {
  if (name === wholeRun) {
    attempts.push(scenario.jobs.map((job) => ({ ...job })));
    continue;
  }
  taken[name] = (taken[name] ?? 0) + 1;
  attempts.push(attempts.at(-1).map((job) => (job.name === name ? { name, ...scenario.reruns[name][taken[name] - 1] } : { ...job, annotations: [] })));
}
const attempt = attempts.length;
const running = state.running > 0;
const rerunning = (job) => running && [wholeRun, job.name].includes(state.reruns.at(-1));
const jobs = attempts.at(-1).map((job, i) => ({
  id: 117000000000 + attempt * 1000 + i,
  status: 'completed',
  run_attempt: attempt,
  ...job,
  ...(rerunning(job) ? { status: 'in_progress', conclusion: null, annotations: [] } : {}),
}));
const conclusion = running ? null : scenario.cancelled ? 'cancelled' : jobs.every((job) => ['success', 'skipped'].includes(job.conclusion)) ? 'success' : 'failure';
const runObject = { id: Number(scenario.run), status: running ? 'in_progress' : 'completed', conclusion, run_attempt: attempt };
const jq = {
  '"\\(.run_attempt)\\t\\(.status)\\t\\(.conclusion)"': (o) => o.run_attempt + '\t' + o.status + '\t' + o.conclusion,
  '.run_attempt': (o) => String(o.run_attempt),
  '.jobs[] | [.id, (.conclusion // .status), (.runner_name // ""), .name] | @tsv': (o) =>
    o.jobs.map((job) => [job.id, job.conclusion ?? job.status, job.runner_name ?? '', job.name].join('\t')).join('\n'),
  '.[].message': (o) => o.map((annotation) => annotation.message).join('\n'),
};
const print = (body, expression) => {
  if (!(expression in jq)) fail('fake gh: unexpected --jq ' + expression);
  const out = jq[expression](body);
  if (out !== '') process.stdout.write(out + '\n');
};
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = 'repos/' + scenario.repo + '/';
if (args[0] === 'api') {
  const endpoint = args.find((arg, i) => i > 0 && !arg.startsWith('-') && args[i - 1] !== '--jq');
  let match;
  if (endpoint === repo + 'actions/runs/' + scenario.run) {
    if (running) {
      state.running -= 1;
      save();
    }
    print(runObject, flag('--jq'));
  } else if (endpoint === repo + 'actions/runs/' + scenario.run + '/attempts/' + attempt + '/jobs?per_page=100' && args.includes('--paginate')) {
    if ((state.unread[attempt] ?? 0) < (scenario.unreadJobs?.[attempt] ?? 0)) {
      state.unread[attempt] = (state.unread[attempt] ?? 0) + 1;
      save();
      fail('gh: HTTP 502: Server Error (https://api.github.com/' + endpoint + ')');
    }
    print({ total_count: jobs.length, jobs }, flag('--jq'));
  } else if ((match = /^check-runs\/(\d+)\/annotations\?per_page=100$/.exec(endpoint.slice(repo.length))) && args.includes('--paginate')) {
    const job = jobs.find((candidate) => String(candidate.id) === match[1]);
    if (!job) fail('gh: Not Found (HTTP 404)');
    print(job.annotations, flag('--jq'));
  } else fail('fake gh: unexpected api call ' + JSON.stringify(args));
} else if (args[0] === '-R' && args[1] === scenario.repo && args[2] === 'run' && args[3] === 'rerun' && args[4] === scenario.run && args[5] === '--job' && args[6] === '') {
  if (running) fail('run ' + scenario.run + ' cannot be rerun; its workflow file may be broken');
  state.reruns.push(wholeRun);
  state.running = scenario.lag ?? 0;
  save();
} else if (args[0] === '-R' && args[1] === scenario.repo && args[2] === 'run' && args[3] === 'rerun' && args[4] === scenario.run && args[5] === '--job') {
  const job = jobs.find((candidate) => String(candidate.id) === args[6]);
  if (!job || running) fail('job ' + args[6] + ' cannot be rerun');
  if (!scenario.reruns[job.name]?.[taken[job.name] ?? 0]) fail('fake gh: the scenario has no outcome for this rerun of ' + job.name);
  state.reruns.push(job.name);
  state.running = scenario.lag ?? 0;
  save();
} else fail('fake gh: unexpected call ' + JSON.stringify(args));
`;

// Plays a scenario through settle_run, its waits no-ops since the fake's attempts move with its reads, not with time,
// and ci-gate.sh's finish only its exit. Returns what it printed, the jobs, attempt, conclusion and summary it set, and
// the jobs it reran in order.
function settle(scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-preemptions-'));
  try {
    writeFileSync(join(dir, 'gh'), fakeGh);
    chmodSync(join(dir, 'gh'), 0o755);
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ repo: 'SSFSKIM/MAWS', run, reruns: {}, ...scenario }));
    const shell = spawnSync(
      'bash',
      [
        '-c',
        'set -uo pipefail; source "$0"; await_run() { :; }; sleep() { :; }; finish() { exit "$1"; }; settle_run; printf "%s\\n" "--" "$jobs" "--" "$run_attempt $conclusion" "$preemptions"',
        join(root, 'scripts/ci-gate-preemptions.sh'),
      ],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPO: 'SSFSKIM/MAWS', run_id: run } },
    );
    assert.equal(shell.status, 0, shell.stdout + shell.stderr);
    const [printed, jobs, tail] = shell.stdout.split('--\n');
    const [attempt, summary] = tail.split('\n');
    const state = join(dir, 'state.json');
    const reruns = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).reruns : [];
    return { printed, jobs: jobs.trimEnd().split('\n'), attempt, summary, reruns };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a preempted job is rerun alone, once, and the final attempt reports it green', () => {
  const result = settle({ jobs: classOneA(preempted('unit')), reruns: { unit: [green('unit', 'ci-kit-gce-hs99zzfujv')] } });
  assert.deepEqual(result.reruns, ['unit']);
  assert.equal(result.printed, 'ci-gate: unit preempted in attempt 1\nci-gate: rerunning unit alone as attempt 2\n');
  assert.equal(result.attempt, '2 success');
  assert.deepEqual(result.jobs, ['success\tplan', 'success\tprobes', 'success\tstatic', 'success\tunit']);
  assert.equal(result.summary, 'ci-gate: preempted by GCE (1): unit; green on its rerun: unit');
});

// On the pool unit runs as shards, `unit <k>/<n>` (gate-plan.mjs's UNIT_SHARDS): a name with a space in it.
const shards = (n, at) => Array.from({ length: n }, (_, i) => at[`unit ${i + 1}/${n}`] ?? green(`unit ${i + 1}/${n}`));
const sharded = (at) => [plan, green('probes', 'ci-kit-gce-hs99q9dpex'), green('static'), ...shards(4, at)];

test('a preempted unit shard is rerun alone by its whole name, and the final attempt reports it green', () => {
  const result = settle({ jobs: sharded({ 'unit 2/4': preempted('unit 2/4') }), reruns: { 'unit 2/4': [green('unit 2/4', 'ci-kit-gce-hs99zzfujv')] } });
  assert.deepEqual(result.reruns, ['unit 2/4']);
  assert.equal(result.printed, 'ci-gate: unit 2/4 preempted in attempt 1\nci-gate: rerunning unit 2/4 alone as attempt 2\n');
  assert.equal(result.attempt, '2 success');
  assert.deepEqual(result.jobs, ['success\tplan', 'success\tprobes', 'success\tstatic', 'success\tunit 1/4', 'success\tunit 2/4', 'success\tunit 3/4', 'success\tunit 4/4']);
  assert.equal(result.summary, 'ci-gate: preempted by GCE (1): unit 2/4; green on its rerun: unit 2/4');
});

// Three shards preempted at once, each kept apart by its whole name: one green on its rerun, one preempted again, one
// whose rerun GitHub refuses (the fake has no outcome for it).
test('preempted shards each keep their own name through the reruns, a second preemption and a refused rerun', () => {
  const result = settle({
    jobs: sharded({ 'unit 1/4': preempted('unit 1/4'), 'unit 3/4': preemptedMidStep('unit 3/4'), 'unit 4/4': preempted('unit 4/4') }),
    reruns: { 'unit 1/4': [green('unit 1/4')], 'unit 3/4': [preempted('unit 3/4', 'ci-kit-gce-hs99zzfujv')] },
  });
  assert.deepEqual(result.reruns, ['unit 1/4', 'unit 3/4']);
  assert.equal(
    result.printed,
    'ci-gate: unit 1/4 preempted in attempt 1\nci-gate: unit 3/4 preempted in attempt 1\nci-gate: unit 4/4 preempted in attempt 1\n' +
      'ci-gate: rerunning unit 1/4 alone as attempt 2\nci-gate: rerunning unit 3/4 alone as attempt 3\nci-gate: unit 3/4 preempted again in attempt 3; it stays red\n' +
      "ci-gate: unit 4/4's rerun was refused: fake gh: the scenario has no outcome for this rerun of unit 4/4; it stays red\n",
  );
  assert.equal(result.attempt, '3 failure');
  assert.equal(result.summary, 'ci-gate: preempted by GCE (3): unit 1/4 unit 3/4 unit 4/4; green on its rerun: unit 1/4; preempted twice, red: unit 3/4; not rerun, red: unit 4/4');
});

test('a job preempted again on its rerun stays red, and the summary says it was preempted twice', () => {
  const result = settle({ jobs: classOneA(preempted('unit')), reruns: { unit: [preempted('unit', 'ci-kit-gce-hs99zzfujv')] } });
  assert.deepEqual(result.reruns, ['unit']);
  assert.equal(result.printed, 'ci-gate: unit preempted in attempt 1\nci-gate: rerunning unit alone as attempt 2\nci-gate: unit preempted again in attempt 2; it stays red\n');
  assert.equal(result.attempt, '2 failure');
  assert.equal(result.summary, 'ci-gate: preempted by GCE (1): unit; preempted twice, red: unit');
});

test('a timeout is not a preemption, though it reads "The operation was canceled." too', () => {
  const timedOut = {
    ...preempted('unit'),
    annotations: [{ annotation_level: 'failure', message: 'The job running on runner ci-kit-gce-hs99r2glck has exceeded the maximum execution time of 30 minutes.' }, recorded.annotations[0]],
  };
  const result = settle({ jobs: classOneA(timedOut) });
  assert.deepEqual(result.reruns, []);
  assert.equal(result.printed, '');
  assert.equal(result.attempt, '1 failure');
  assert.equal(result.summary, '');
});

test('nothing in a cancelled run is retried', () => {
  const result = settle({ jobs: classOneA(preempted('unit')), cancelled: true });
  assert.deepEqual(result.reruns, []);
  assert.equal(result.printed, '');
  assert.equal(result.attempt, '1 cancelled');
  assert.equal(result.summary, '');
});

test("a failure with the preemption's annotations on a runner that is not ci-kit's GCE pool is not retried", () => {
  for (const runner of ['GitHub Actions 1000005582', 'ci-kit-mac-mini', 'ci-kit-hetzner-1']) {
    const result = settle({ jobs: classOneA(preempted('unit', runner)) });
    assert.deepEqual(result.reruns, [], runner);
    assert.equal(result.printed, '', runner);
    assert.equal(result.attempt, '1 failure', runner);
    assert.equal(result.summary, '', runner);
  }
});

// Two jobs preempted in attempt 1 beside a red: the first goes green on its rerun, the second red.
const twoPreempted = {
  jobs: [plan, preempted('e2e:desk-web', 'ci-kit-gce-hs99wo3ici'), green('probes'), red('static'), preemptedMidStep('unit', 'ci-kit-gce-hs9ae8fiqa')],
  reruns: { 'e2e:desk-web': [green('e2e:desk-web')], unit: [red('unit')] },
};
const settledTwoPreempted = (result) => {
  assert.deepEqual(result.reruns, ['e2e:desk-web', 'unit']);
  assert.equal(
    result.printed,
    'ci-gate: e2e:desk-web preempted in attempt 1\nci-gate: unit preempted in attempt 1\nci-gate: rerunning e2e:desk-web alone as attempt 2\nci-gate: rerunning unit alone as attempt 3\n',
  );
  assert.equal(result.attempt, '3 failure');
  assert.deepEqual(result.jobs, ['success\te2e:desk-web', 'success\tplan', 'success\tprobes', 'failure\tstatic', 'failure\tunit']);
  assert.equal(result.summary, 'ci-gate: preempted by GCE (2): e2e:desk-web unit; green on its rerun: e2e:desk-web; red on its rerun: unit');
};

test('two preempted jobs are rerun one after the other, a red beside them is not rerun, and each reads by its final attempt', () => {
  settledTwoPreempted(settle(twoPreempted));
});

// await_run trusts `gh run view`, which can still show the attempt before a rerun completed while the run API shows the
// rerun's attempt running; and a failed read of the jobs leaves no id to rerun the next job by, where gh would take an
// empty --job for the whole run.
test('an attempt the run API shows running, or whose jobs failed to read, is read again before it is acted on', () => {
  settledTwoPreempted(settle({ ...twoPreempted, lag: 2, unreadJobs: { 2: 1 } }));
});

// The whole script, against a local origin and the fake gh: the transcript's last lines carry the summary, the run's
// final attempt and its status, which the briefs' waiters still match, and the exit status is the final attempt's.
test("ci-gate.sh names the final attempt on the line before the run's status, which stays as it was", () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-preemptions-'));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, MAWS_GATE_IGNORE_ALERTS: '1', MAWS_GATE_RUNNER: '' };
  for (const role of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${role}_NAME`]: 'ci-gate test', [`GIT_${role}_EMAIL`]: 'ci-gate@test.invalid' });
  let short = '';
  try {
    const tree = join(dir, 'tree');
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env }).trim();
    git('init', '--quiet', '--bare', join(dir, 'origin.git'));
    git('init', '--quiet', '-b', 'preempt', tree);
    git('-C', tree, 'commit', '--quiet', '--allow-empty', '-m', 'tested tree');
    git('-C', tree, 'remote', 'add', 'origin', join(dir, 'origin.git'));
    short = git('-C', tree, 'rev-parse', '--short=8', 'HEAD');
    // ci-gate.sh's own calls before and around the wait, on top of the retry's.
    const wrapper = String.raw`#!/usr/bin/env bash
case "$*" in
  "-R SSFSKIM/MAWS run list "*) echo ${run} ;;
  "-R SSFSKIM/MAWS run watch ${run} "*) ;;
  "-R SSFSKIM/MAWS run view ${run} --json status --jq .status") echo completed ;;
  *) exec "$(dirname "$0")/gh-api" "$@" ;;
esac
`;
    writeFileSync(join(dir, 'gh'), wrapper);
    writeFileSync(join(dir, 'gh-api'), fakeGh);
    chmodSync(join(dir, 'gh'), 0o755);
    chmodSync(join(dir, 'gh-api'), 0o755);
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ repo: 'SSFSKIM/MAWS', run, jobs: classOneA(preempted('unit')), reruns: { unit: [green('unit')] } }));
    const gate = spawnSync('bash', [join(root, 'scripts/ci-gate.sh'), tree, '--gates', 'static,unit,probes', '--class1a', 'pool'], { encoding: 'utf8', env });
    const lines = gate.stdout.trimEnd().split('\n');
    assert.equal(gate.status, 0, gate.stdout + gate.stderr);
    assert.deepEqual(lines.slice(-5), [
      'ci-gate: preempted by GCE (1): unit; green on its rerun: unit',
      `ci-gate: run ${run} attempt 2`,
      `ci-gate: run ${run} success`,
      `ci-gate: removed ci/preempt-${short}`,
      `ci-gate: transcript in /tmp/maws-review/gates/ci-${short}.log`,
    ]);
    // The waiters' pattern finds the status line and no line before it, the attempt's included.
    assert.deepEqual(lines.filter((line) => /^ci-gate: run [0-9]+ [a-z_]+$/.test(line)), [`ci-gate: run ${run} success`]);
    assert.ok(lines.includes('ci-gate: unit preempted in attempt 1'));
    assert.ok(lines.includes('ci-gate: rerunning unit alone as attempt 2'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (short) rmSync(`/tmp/maws-review/gates/ci-${short}.log`, { force: true });
  }
});
