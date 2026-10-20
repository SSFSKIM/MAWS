// node --test scripts/ci-gate.test.mjs (from anywhere; no install needed). ci-gate.sh's --gates: a call that names no
// gates is refused before anything is pushed, `all` pushes the trailers the whole set always had (no `Gates:`), and a
// list goes through as it was given. The script runs whole, against a local origin and a fake `gh` that finds no run, so
// a call that pushes ends at "no run" with its commit left on the ci/ ref (--keep) to read the trailers from.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// The fake gh logs every call. It finds no run of the push, and answers ci-gate-alerts.mjs's three reads with the mini's
// runner online under an open alert, so a run that puts jobs on a Mac is refused there and one that does not goes ahead.
const fakeGh = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$(dirname "$0")/gh-calls"
case "$*" in
  *" run list "*) ;;
  *"repos/SSFSKIM/MAWS/actions/variables"*) echo '["GATE_RUNNER","pool"]'; echo '["GATE_E2E_RUNNER","macos"]' ;;
  *"repos/SSFSKIM/ci-kit-sandbox/issues"*) echo '{"number":18,"title":"ci-kit alert: mini: UserNotificationCenter since 2026-10-19T21:08Z"}' ;;
  *"repos/SSFSKIM/MAWS/actions/runners"*) echo '{"name":"ci-kit-mac-mini","status":"online"}' ;;
  *) echo "fake gh: unexpected call $*" >&2; exit 1 ;;
esac
`;

// ci-gate.sh on a one-commit tree with `args` after the tree. Returns its status and output, the gh calls, the refs the
// origin holds and the pushed commit's message (empty when nothing was pushed).
function gate(args, { alerts = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, MAWS_GATE_RUNNER: '', MAWS_GATE_IGNORE_ALERTS: alerts ? '' : '1' };
  for (const role of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${role}_NAME`]: 'ci-gate test', [`GIT_${role}_EMAIL`]: 'ci-gate@test.invalid' });
  const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8', env }).trim();
  let short = '';
  try {
    const origin = join(dir, 'origin.git');
    const tree = join(dir, 'tree');
    git('init', '--quiet', '--bare', origin);
    git('init', '--quiet', '-b', 'gates', tree);
    git('-C', tree, 'commit', '--quiet', '--allow-empty', '-m', 'tested tree');
    git('-C', tree, 'remote', 'add', 'origin', origin);
    short = git('-C', tree, 'rev-parse', '--short=8', 'HEAD');
    writeFileSync(join(dir, 'gh'), fakeGh);
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\n'); // the 30 polls for the run, at once
    chmodSync(join(dir, 'gh'), 0o755);
    chmodSync(join(dir, 'sleep'), 0o755);
    const run = spawnSync('bash', [join(root, 'scripts/ci-gate.sh'), tree, ...args, '--keep'], { encoding: 'utf8', env });
    const refs = git('--git-dir', origin, 'for-each-ref', '--format=%(refname)');
    const calls = join(dir, 'gh-calls');
    return {
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trimEnd().split('\n') : [],
      refs: refs ? refs.split('\n') : [],
      message: refs ? git('--git-dir', origin, 'log', '-1', '--format=%B', `refs/heads/ci/gates-${short}`) : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (short) rmSync(`/tmp/maws-review/gates/ci-${short}.log`, { force: true });
  }
}

// The trailers after the nonce, which is unique to each push.
const trailers = (message) => {
  const lines = message.trimEnd().split('\n\n').at(-1).split('\n');
  assert.match(lines[0], /^Nonce: \d+-\d+$/);
  return lines.slice(1);
};

test('a call that names no gates is refused with exit 2 and the two forms, before the alert check and the push', () => {
  // The landing set that meant the whole set before, and the class 1a call that queued it by accident (runs 39342833882,
  // 39360667046).
  for (const args of [['--class1a', 'pool', '--runner', 'macos', '--evidence'], ['--class1a', 'pool']]) {
    const result = gate(args, { alerts: true });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stderr, 'ci-gate: name the gates: --gates static,unit,probes for class 1a only, --gates all for the whole set\n');
    assert.equal(result.stdout, '');
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refs, []);
  }
});

test('a live call that names no gates is refused with the live form, since a live run takes its live groups alone', () => {
  const result = gate(['--runner', 'macos', '--live'], { alerts: true });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "ci-gate: name the gates: a live run takes its live e2e groups alone, --live --gates e2e:<group>,… (gate.yml's LIVE_E2E)\n");
  assert.deepEqual(result.refs, []);
});

test('--gates all pushes the whole set as the plan reads it: no Gates: trailer, the other flags as given', () => {
  const result = gate(['--gates', 'all', '--class1a', 'pool', '--runner', 'macos', '--evidence']);
  assert.equal(result.status, 1, result.stdout + result.stderr); // the fake gh finds no run
  assert.match(result.stdout, /^ci-gate: [0-9a-f]{40} as ci\/gates-[0-9a-f]{8} \(Gates: all\) \(Runner: macos\) \(Class1a: pool\) \(Evidence: yes\)$/m);
  assert.deepEqual(trailers(result.message), ['Runner: macos', 'Class1a: pool', 'Evidence: yes']);
});

test('--gates all reaches the alert check as the whole set, unit:darwin and the class-1 e2e groups on the Mac', () => {
  const result = gate(['--gates', 'all', '--class1a', 'pool', '--runner', 'macos'], { alerts: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^ci-gate: not pushing: this run puts jobs on a Mac \(unit:darwin, the class-1 e2e groups\) /);
  assert.deepEqual(result.refs, []);
});

test('a list of gates goes through as given, live groups with --live too', () => {
  const classOneA = gate(['--gates', 'static,unit,probes', '--class1a', 'pool']);
  assert.deepEqual(trailers(classOneA.message), ['Gates: static,unit,probes', 'Class1a: pool']);
  const live = gate(['--gates', 'e2e:library-live', '--runner', 'macos', '--live']);
  assert.deepEqual(trailers(live.message), ['Gates: e2e:library-live', 'Runner: macos', 'Live: yes']);
  // A class 1a run on the pool puts nothing on a Mac, so the open alert does not hold it.
  const pooled = gate(['--gates', 'static,unit,probes', '--class1a', 'pool', '--runner', 'macos'], { alerts: true });
  assert.equal(pooled.status, 1, pooled.stdout + pooled.stderr);
  assert.deepEqual(trailers(pooled.message), ['Gates: static,unit,probes', 'Runner: macos', 'Class1a: pool']);
});
