// Exercise the launcher with real commits and a local origin; only Actions is fake. The tests catch shared refs,
// overwritten transcripts/reports, and accidental final-bundle routing. Collected by gate.yml's scripts/*.test.mjs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { FINAL_LABELS, planOf } from '../.github/scripts/gate-plan.mjs';
import { workflowEnv } from './ci-gate-alerts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = workflowEnv(readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8'));
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
const fakeGh = `#!/usr/bin/env bash
case "$*" in
  'variable get GATE_RUNNER '*) echo "\${TEST_CLASS1A:-pool}" ;;
  'variable get GATE_E2E_RUNNER '*) echo macos ;;
  'variable list '*HOSTED_MAC_ROUTE*) echo "\${TEST_ROUTE:-mirror}" ;;
  'variable list '*) ;;
  *' run list '*) [[ \${TEST_RESULT:-failure} == no-run ]] || echo "$TEST_RUN" ;;
  *' run watch '*) ;;
  *' run view '*'--json status '*) echo completed ;;
  *' run view '*'--log-failed'*) printf 'e2e:document\\twait\\t2026-10-28 hosted: failure https://github.com/SSFSKIM/maws-app/actions/runs/999\\n' ;;
  *' run download '*)
    kind=report; [[ $* != *maws-app* ]] || kind=hosted
    while [[ $1 != -D ]]; do shift; done
    mkdir -p "$2"
    echo "$TEST_RUN" > "$2/\${TEST_RUN}-$kind.txt"
    ;;
  *'/attempts/1/jobs?'*) printf '101\\t%s\\tGitHub Actions\\tstatic\\n' "\${TEST_RESULT:-failure}" ;;
  *'actions/runs/'*) printf '1\\tcompleted\\t%s\\n' "\${TEST_RESULT:-failure}" ;;
  *) echo "unexpected gh: $*" >&2; exit 1 ;;
esac
`;

function fixture(body, branch = 'feature/work') {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-identity-'));
  const tree = join(dir, 'tree');
  const origin = join(dir, 'origin.git');
  const outputs = [];
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, MAWS_GATE_RUNNER: '', MAWS_GATE_IGNORE_ALERTS: '1' };
  for (const role of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${role}_NAME`]: 'identity test', [`GIT_${role}_EMAIL`]: 'identity@test.invalid' });
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '--quiet', '--bare', origin);
    git('init', '--quiet', '-b', branch, tree);
    cpSync(join(root, '.github'), join(tree, '.github'), { recursive: true });
    cpSync(join(root, 'package.json'), join(tree, 'package.json'));
    mkdirSync(join(tree, 'src/shared/ipc'), { recursive: true });
    writeFileSync(join(tree, 'src/shared/ipc/wire-manifest.json'), '{"major":3,"minor":0}');
    git('-C', tree, 'add', '.');
    git('-C', tree, 'commit', '--quiet', '-m', 'tested tree');
    git('-C', tree, 'remote', 'add', 'origin', origin);
    git('-C', tree, 'push', '--quiet', 'origin', 'HEAD:master');
    for (const [name, text] of [['gh', fakeGh], ['sleep', '#!/bin/sh\n']]) {
      writeFileSync(join(dir, name), text);
      chmodSync(join(dir, name), 0o755);
    }
    const sha = git('-C', tree, 'rev-parse', 'HEAD');
    let sequence = 0;
    const launch = (args, extra = {}) => {
      const runId = String(98700000000 + ++sequence);
      const result = spawnSync('bash', [join(root, 'scripts/ci-gate.sh'), tree, '--peer', 'none', '--keep', ...args], {
        env: { ...env, TEST_RUN: runId, ...extra }, encoding: 'utf8', maxBuffer: 8 << 20,
      });
      const text = result.stdout + result.stderr;
      outputs.push(text);
      const ref = / as (ci\/\S+)/.exec(text)?.[1];
      if (args.includes('--gates')) assert.ok(ref, text); // a refusal is not a distinct configuration's ref
      const log = /^ci-gate: transcript in (.+)$/m.exec(text)?.[1];
      const reports = /^ci-gate: reports in (.+)\/$/m.exec(text)?.[1];
      return { ...result, text, ref, log, reports, runId, sha };
    };
    body({ launch, sha, tree, git: (...args) => git('-C', tree, ...args) });
  } finally {
    for (const text of outputs) {
      const log = /^ci-gate: transcript in (.+)$/m.exec(text)?.[1];
      if (log?.endsWith('/transcript.log')) rmSync(dirname(log), { recursive: true, force: true });
      else if (log) rmSync(log, { force: true }); // cleans up the pre-fix RED run too
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

const staticArgs = ['--gates', 'static', '--class1a', 'pool'];
const hostedArgs = ['--gates', 'e2e:document', '--runner', 'macos', '--lane', 'hosted'];

test('different calls on one commit preserve both refs, transcripts and downloaded reports; identical calls keep only the ref', () => fixture(({ launch }) => {
  const a = launch(staticArgs);
  const before = readFileSync(a.log, 'utf8');
  const b = launch(hostedArgs);
  const again = launch(staticArgs);
  assert.notEqual(a.ref, b.ref, 'static and hosted must not cancel each other');
  assert.equal(a.ref, again.ref, 'an identical call may supersede its predecessor');
  for (const key of ['log', 'reports']) assert.equal(new Set([a[key], b[key], again[key]]).size, 3, key);
  assert.equal(readFileSync(a.log, 'utf8'), before, 'a later call must not overwrite the first transcript');
  for (const result of [a, b, again]) {
    assert.equal(result.status, 1, result.text);
    assert.ok(result.log.includes(result.runId));
    assert.ok(result.reports.includes(result.runId));
    assert.equal(readFileSync(join(result.reports, `${result.runId}-report.txt`), 'utf8').trim(), result.runId);
    assert.equal(readFileSync(join(result.reports, `${result.runId}-hosted.txt`), 'utf8').trim(), result.runId);
    assert.match(readFileSync(result.log, 'utf8'), new RegExp(`transcript in ${result.log}`));
    assert.match(result.text, /hosted report of SSFSKIM\/maws-app run 999/);
  }
}));

test('every run-shaping option and resolved repository default separates the ref', () => fixture(({ launch }) => {
  const baseline = launch(staticArgs).ref;
  for (const args of [
    ['--gates', 'probes'], ['--runner', 'linux'], ['--class1a', 'linux'], ['--lane', 'hosted'],
    ['--hosted-route', 'direct'], ['--default-beside', 'document'], ['--evidence'], ['--live'], ['--affected'],
  ]) assert.notEqual(launch([...staticArgs, ...args]).ref, baseline, args.join(' '));
  assert.notEqual(launch(staticArgs, { TEST_ROUTE: 'direct' }).ref, baseline);
  const defaultRunner = launch(['--gates', 'static']).ref;
  assert.notEqual(launch(['--gates', 'static'], { TEST_CLASS1A: 'linux' }).ref, defaultRunner);
}));

test('gate ordering and repeated gates do not change the resolved identity', () => fixture(({ launch }) => {
  const a = launch(['--gates', 'static,probes']);
  const b = launch(['--gates', ' probes,static,static ']);
  assert.equal(a.ref, b.ref);
}));

test('explicit labels retain their sanitizing and reserved-final routing', () => fixture(({ launch, sha }) => {
  for (const [label, expected] of [['my/custom label', 'my-custom-label'], ...FINAL_LABELS.map((label) => [label, label])]) {
    const result = launch([...hostedArgs, '--label', label]);
    assert.equal(result.ref, `ci/${expected}-${sha.slice(0, 8)}`);
  }
}));

test('branch names that resemble final labels never force a derived run onto the final Mac', () => {
  for (const branch of [...FINAL_LABELS, 'h-final-diagnostic', `feature/${'long'.repeat(35)}`]) fixture(({ launch }) => {
    const result = launch(hostedArgs);
    assert.ok(result.ref.length < 120, result.ref);
    assert.match(result.ref, /^ci\/[A-Za-z0-9._-]+$/);
    assert.ok(!FINAL_LABELS.some((label) => result.ref.startsWith(`ci/${label}-`)), result.ref);
    const plan = planOf({ ...workflow, EVENT: 'push', GITHUB_REF_NAME: result.ref, HEAD_MESSAGE: 'Gates: e2e:document\nRunner: macos\nLane: hosted' }, scripts);
    assert.equal(JSON.parse(plan.outputs.e2e)[0].hosted, true, plan.summary);
  }, branch);
});

test('green, red, missing-run and validation errors end with discoverable paths', () => fixture(({ launch }) => {
  for (const [args, outcome, status] of [[staticArgs, 'success', 0], [staticArgs, 'failure', 1], [staticArgs, 'no-run', 1], [[], 'success', 2]]) {
    const result = launch(args, { TEST_RESULT: outcome });
    assert.equal(result.status, status, result.text);
    if (status === 2) {
      assert.match(result.stderr, /ci-gate: name the gates:/);
      assert.equal(result.stdout, 'ci-gate: transcript: none (stopped before a run)\nci-gate: reports: none (stopped before a run)\n');
    } else {
      assert.match(result.stdout.trimEnd(), /ci-gate: transcript in .+\nci-gate: reports in .+\/$/);
      assert.ok(existsSync(result.log));
      assert.ok(existsSync(result.reports));
    }
  }
}));


test('resolved peer commits separate refs, while two names for one peer retain the ref', () => fixture(({ launch, sha, tree, git }) => {
  // Two master states followed by a draft a minor ahead of both.
  writeFileSync(join(tree, 'peer.txt'), 'second master state');
  git('add', '.');
  git('commit', '--quiet', '-m', 'second master');
  git('push', '--quiet', 'origin', 'HEAD:master');
  writeFileSync(join(tree, 'src/shared/ipc/wire-manifest.json'), '{"major":3,"minor":1}');
  git('add', '.');
  git('commit', '--quiet', '-m', 'draft wire');
  const first = launch([...staticArgs, '--peer', sha]);
  const second = launch([...staticArgs, '--peer', 'origin/master']);
  const alias = launch([...staticArgs, '--peer', `${sha.slice(0, 12)}`]);
  assert.ok(first.ref && second.ref && alias.ref, first.text + second.text + alias.text);
  assert.notEqual(first.ref, second.ref);
  assert.equal(first.ref, alias.ref);
}));

test('backlog changes neither the default ref hash nor the committed planner outputs used by that hash', () => fixture(({ tree, sha }) => {
  const message = 'Gates: e2e:document\nRunner: macos\nHosted-Route: direct';
  const sample = { v: 1, at: new Date().toISOString(), hostedQueued: 20, hostedRunning: 5, ec2: 'idle', ec2Queued: 0, partial: [] };
  const messages = [message, `${message}\nMac-Backlog: ${JSON.stringify(sample)}`, `${message}\nMac-Backlog: ${JSON.stringify({ ...sample, hostedQueued: 0, hostedRunning: 0 })}`];
  const env = { ...process.env, GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos', HOSTED_MAC_ROUTE: 'direct' };
  // These samples really do change placement if allowed through to the planner.
  const placements = messages.map((HEAD_MESSAGE) => planOf({ ...workflow, ...env, HEAD_MESSAGE }, scripts, Date.now()).outputs.e2e);
  assert.notEqual(placements[0], placements[1]);
  assert.equal(placements[0], placements[2]);
  const labels = messages.map((HEAD_MESSAGE) => execFileSync(process.execPath, [join(root, 'scripts/ci-gate-identity.mjs'), '--git-dir', tree, '--sha', sha, '--branch', 'feature/work'], { encoding: 'utf8', env: { ...env, HEAD_MESSAGE }, stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  assert.equal(new Set(labels).size, 1, 'a relaunch supersedes the same work regardless of its sampled placement');
}));


test('unset optional hosted variables preserve a resolved planner and pool hint', () => fixture(({ launch }) => {
  const result = launch(staticArgs);
  assert.doesNotMatch(result.text, /default label uses configuration only|could not plan pool demand/);
}));
