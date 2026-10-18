// node --test scripts/ci-gate-preemptions.test.mjs (from anywhere; no install needed). ci-gate.sh's retry of the jobs a
// spot preemption ended, scripts/ci-gate-preemptions.sh, run in bash as ci-gate.sh runs it against a fake `gh` that
// plays a run's attempts the way GitHub's API reports them.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const preempted = (name, runner = 'ci-kit-gce-hs99r2glck') => ({ name, conclusion: recorded.job.conclusion, runner_name: runner, annotations: recorded.annotations });
const green = (name, runner = 'ci-kit-gce-hs99qt76im') => ({ name, conclusion: 'success', runner_name: runner, annotations: [] });
const red = (name, runner = 'ci-kit-gce-hs99sz4glw') => ({ name, conclusion: 'failure', runner_name: runner, annotations: [{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }] });
const plan = { name: 'plan', conclusion: 'success', runner_name: 'GitHub Actions 1000005582', annotations: [] };
const classOneA = (unit) => [plan, green('probes', 'ci-kit-gce-hs99q9dpex'), green('static'), unit];

// The fake gh. Attempt 1 is the scenario's jobs; each rerun makes the next attempt, as GitHub does: every job gets a
// new id, the rerun job takes the scenario's next outcome for it, and the others are copied without their
// annotations (observed on SSFSKIM/ci-kit-sandbox run 39110966829). It answers only the calls and --jq expressions
// the script makes, so a changed call fails here rather than passing on a guess, and it refuses a rerun by any id but
// the latest attempt's, or one the scenario gives no outcome for.
const fakeGh = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = path.dirname(process.argv[1]);
const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
const statePath = path.join(dir, 'state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { reruns: [] };
const args = process.argv.slice(2);
const fail = (message) => { process.stderr.write(message + '\n'); process.exit(1); };
const attempts = [scenario.jobs.map((job) => ({ ...job }))];
const taken = {};
for (const name of state.reruns) {
  taken[name] = (taken[name] ?? 0) + 1;
  attempts.push(attempts.at(-1).map((job) => (job.name === name ? { name, ...scenario.reruns[name][taken[name] - 1] } : { ...job, annotations: [] })));
}
const attempt = attempts.length;
const jobs = attempts.at(-1).map((job, i) => ({ id: 117000000000 + attempt * 1000 + i, status: 'completed', run_attempt: attempt, ...job }));
const conclusion = scenario.cancelled ? 'cancelled' : jobs.every((job) => ['success', 'skipped'].includes(job.conclusion)) ? 'success' : 'failure';
const runObject = { id: Number(scenario.run), status: 'completed', conclusion, run_attempt: attempt };
const jq = {
  '"\\(.run_attempt)\\t\\(.conclusion)"': (o) => o.run_attempt + '\t' + o.conclusion,
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
  if (endpoint === repo + 'actions/runs/' + scenario.run) print(runObject, flag('--jq'));
  else if (endpoint === repo + 'actions/runs/' + scenario.run + '/jobs?per_page=100' && args.includes('--paginate')) print({ total_count: jobs.length, jobs }, flag('--jq'));
  else if ((match = /^check-runs\/(\d+)\/annotations\?per_page=100$/.exec(endpoint.slice(repo.length))) && args.includes('--paginate')) {
    const job = jobs.find((candidate) => String(candidate.id) === match[1]);
    if (!job) fail('gh: Not Found (HTTP 404)');
    print(job.annotations, flag('--jq'));
  } else fail('fake gh: unexpected api call ' + JSON.stringify(args));
} else if (args[0] === '-R' && args[1] === scenario.repo && args[2] === 'run' && args[3] === 'rerun' && args[4] === scenario.run && args[5] === '--job') {
  const job = jobs.find((candidate) => String(candidate.id) === args[6]);
  if (!job) fail('job ' + args[6] + ' cannot be rerun');
  if (!scenario.reruns[job.name]?.[taken[job.name] ?? 0]) fail('fake gh: the scenario has no outcome for this rerun of ' + job.name);
  state.reruns.push(job.name);
  fs.writeFileSync(statePath, JSON.stringify(state));
} else fail('fake gh: unexpected call ' + JSON.stringify(args));
`;

// Plays a scenario through settle_run, its wait a no-op since every fake attempt is complete when read. Returns what it
// printed, the jobs, attempt, conclusion and summary it set, and the jobs it reran in order.
function settle(scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-preemptions-'));
  try {
    writeFileSync(join(dir, 'gh'), fakeGh);
    chmodSync(join(dir, 'gh'), 0o755);
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ repo: 'SSFSKIM/MAWS', run, reruns: {}, ...scenario }));
    const out = execFileSync(
      'bash',
      ['-c', 'set -uo pipefail; source "$0"; await_run() { :; }; settle_run; printf "%s\\n" "--" "$jobs" "--" "$run_attempt $conclusion" "$preemptions"', join(root, 'scripts/ci-gate-preemptions.sh')],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPO: 'SSFSKIM/MAWS', run_id: run } },
    );
    const [printed, jobs, tail] = out.split('--\n');
    const [attempt, summary] = tail.split('\n');
    let reruns = [];
    try {
      reruns = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).reruns;
    } catch {}
    return { printed, jobs: jobs.trimEnd().split('\n'), attempt, summary, reruns };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a preempted job is rerun alone, once, and the final attempt reports it green', () => {
  const result = settle({ jobs: classOneA(preempted('unit')), reruns: { unit: [green('unit', 'ci-kit-gce-hs99zzfujv')] } });
  assert.deepEqual(result.reruns, ['unit']);
  assert.equal(result.printed, 'ci-gate: unit preempted in attempt 1; rerunning it alone as attempt 2\n');
  assert.equal(result.attempt, '2 success');
  assert.deepEqual(result.jobs, ['success\tplan', 'success\tprobes', 'success\tstatic', 'success\tunit']);
  assert.equal(result.summary, 'ci-gate: preempted by GCE (1): unit; green on its rerun: unit');
});

test('a job preempted again on its rerun stays red, and the summary says it was preempted twice', () => {
  const result = settle({ jobs: classOneA(preempted('unit')), reruns: { unit: [preempted('unit', 'ci-kit-gce-hs99zzfujv')] } });
  assert.deepEqual(result.reruns, ['unit']);
  assert.equal(result.printed, 'ci-gate: unit preempted in attempt 1; rerunning it alone as attempt 2\nci-gate: unit preempted again in attempt 2; it stays red\n');
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

test('two preempted jobs are rerun one after the other, a red beside them is not rerun, and each reads by its final attempt', () => {
  const jobs = [plan, preempted('e2e:desk-web', 'ci-kit-gce-hs99wo3ici'), green('probes'), red('static'), preempted('unit')];
  const result = settle({ jobs, reruns: { 'e2e:desk-web': [green('e2e:desk-web')], unit: [red('unit')] } });
  assert.deepEqual(result.reruns, ['e2e:desk-web', 'unit']);
  assert.equal(
    result.printed,
    'ci-gate: e2e:desk-web preempted in attempt 1; rerunning it alone as attempt 2\nci-gate: unit preempted in attempt 2; rerunning it alone as attempt 3\n',
  );
  assert.equal(result.attempt, '3 failure');
  assert.deepEqual(result.jobs, ['success\te2e:desk-web', 'success\tplan', 'success\tprobes', 'failure\tstatic', 'failure\tunit']);
  assert.equal(result.summary, 'ci-gate: preempted by GCE (2): e2e:desk-web unit; green on its rerun: e2e:desk-web; red on its rerun: unit');
});

// The whole script, against a local origin and the fake gh: the transcript's last lines carry the summary and the run's
// final attempt, and the exit status is the final attempt's.
test("ci-gate.sh's status line carries the final attempt", () => {
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
    assert.deepEqual(lines.slice(-4), [
      'ci-gate: preempted by GCE (1): unit; green on its rerun: unit',
      `ci-gate: run ${run} attempt 2 success`,
      `ci-gate: removed ci/preempt-${short}`,
      `ci-gate: transcript in /tmp/maws-review/gates/ci-${short}.log`,
    ]);
    assert.ok(lines.includes('ci-gate: unit preempted in attempt 1; rerunning it alone as attempt 2'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (short) rmSync(`/tmp/maws-review/gates/ci-${short}.log`, { force: true });
  }
});
