// node --test scripts/ci-gate.test.mjs (from anywhere; no install needed). ci-gate.sh's --gates: a call that names no
// gates is refused before anything is pushed, `all` pushes the trailers the whole set always had (no `Gates:`), and a
// list goes through as it was given. The script runs whole, against a local origin and a fake `gh` that finds no run, so
// a call that pushes ends at "no run" with its commit left on the ci/ ref (--keep) to read the trailers from.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
// origin holds and the pushed commit's message (empty when nothing was pushed). With `change`, the origin's master holds
// a first commit of `base` (path → content) and the tested commit is `change(tree, git)` on top of it.
function gate(args, { alerts = false, base = {}, change } = {}) {
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
    git('-C', tree, 'remote', 'add', 'origin', origin);
    if (change) {
      for (const [path, content] of Object.entries(base)) {
        mkdirSync(dirname(join(tree, path)), { recursive: true });
        writeFileSync(join(tree, path), content);
      }
      git('-C', tree, 'add', '-A');
      git('-C', tree, 'commit', '--quiet', '-m', 'master');
      git('-C', tree, 'push', '--quiet', 'origin', 'HEAD:refs/heads/master');
      change(tree, (...gitArgs) => git('-C', tree, ...gitArgs));
      git('-C', tree, 'add', '-A');
    }
    git('-C', tree, 'commit', '--quiet', '--allow-empty', '-m', 'tested tree');
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
      refs: refs ? refs.split('\n').filter((ref) => ref !== 'refs/heads/master') : [],
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

test('a --gates value of commas and spaces names no gates either, since the plan would read it as the whole set', () => {
  for (const value of ['', ',', ' , ']) {
    const result = gate(['--gates', value, '--class1a', 'pool', '--runner', 'macos'], { alerts: true });
    assert.equal(result.status, 2, JSON.stringify(value));
    assert.equal(result.stderr, 'ci-gate: name the gates: --gates static,unit,probes for class 1a only, --gates all for the whole set\n');
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

// ci-kit's VM lane: --lane names where the run's MAC_VM_E2E groups go (gate-plan.mjs reads the `Lane:` trailer).
test('--lane vm or vm-trial goes through as a Lane: trailer; any other value is refused before anything is pushed', () => {
  const vm = gate(['--gates', 'e2e:document-app', '--runner', 'macos', '--lane', 'vm']);
  assert.match(vm.stdout, /^ci-gate: [0-9a-f]{40} as ci\/gates-[0-9a-f]{8} \(Gates: e2e:document-app\) \(Runner: macos\) \(Lane: vm\)$/m);
  assert.deepEqual(trailers(vm.message), ['Gates: e2e:document-app', 'Runner: macos', 'Lane: vm']);
  assert.deepEqual(trailers(gate(['--gates', 'e2e:document-app', '--lane', 'vm-trial']).message), ['Gates: e2e:document-app', 'Lane: vm-trial']);
  for (const value of ['host', 'VM', 'vm,vm-trial']) {
    const refused = gate(['--gates', 'e2e:document-app', '--lane', value], { alerts: true });
    assert.equal(refused.status, 2, value);
    assert.equal(refused.stderr, `ci-gate: --lane is vm or vm-trial, not ${value}\n`);
    assert.deepEqual(refused.calls, []);
    assert.deepEqual(refused.refs, []);
  }
});

// ci-kit's test-history spec, M4: --affected lists the change from the merge base with origin/master in the pushed
// commit, which the plan (gate-plan.mjs, gate-affected.mjs) reads to narrow unit; the run's title says `affected`.
const files = { 'src/shared/a.ts': 'export const a = 1;\n', 'src/shared/b.test.ts': 'test\n', 'src/shared/c.ts': 'export const c = 1;\n', 'src/shared/d.ts': 'export {};\n' };

test('--affected names the change in the subject and lists its paths, a rename with both, which the plan narrows unit to', () => {
  const result = gate(['--gates', 'unit', '--class1a', 'pool', '--affected'], {
    base: files,
    change: (tree, git) => {
      writeFileSync(join(tree, 'src/shared/a.ts'), 'export const a = 2;\n');
      writeFileSync(join(tree, 'src/shared/e.ts'), 'export const e = 1;\n');
      git('mv', 'src/shared/b.test.ts', 'src/shared/f.test.ts');
      git('rm', '--quiet', 'src/shared/d.ts');
    },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr); // the fake gh finds no run
  assert.match(result.stdout, /^ci-gate: --affected: 4 paths from the merge base [0-9a-f]{8} with origin\/master$/m);
  assert.match(result.stdout, /\(Class1a: pool\) \(Selection: affected\)$/m);
  assert.match(result.message, /^ci-gate: [0-9a-f]{8} affected\n\n/);
  assert.deepEqual(trailers(result.message), [
    'Gates: unit', 'Class1a: pool', 'Selection: affected', 'Affected-Count: 4',
    'Affected: M\tsrc/shared/a.ts', 'Affected: D\tsrc/shared/d.ts', 'Affected: A\tsrc/shared/e.ts', 'Affected: R100\tsrc/shared/b.test.ts\tsrc/shared/f.test.ts',
  ]);
  // The deleted non-test file sends this one to the whole suite; without it, unit runs related over what still exists.
  const plan = (message) => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-gate-plan-'));
    try {
      const env = { ...process.env, EVENT: 'push', HEAD_MESSAGE: message, GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary') };
      for (const name of ['INPUT_GATES', 'INPUT_RUNNER', 'INPUT_CLASS1A', 'INPUT_EVIDENCE', 'INPUT_LIVE', 'GATE_RUNNER', 'GATE_E2E_RUNNER', 'CLASS1_E2E', 'LINUX_E2E', 'POOL_E2E', 'LIBREOFFICE_E2E', 'LIVE_E2E', 'LIVE_GUARD_E2E', 'MEASURED_E2E']) env[name] = '';
      execFileSync(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], { cwd: root, env, stdio: 'pipe' });
      return { outputs: readFileSync(join(dir, 'output'), 'utf8'), summary: readFileSync(join(dir, 'summary'), 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.match(plan(result.message).summary, /\nSelection: affected — full suite: a deleted non-test file \(src\/shared\/d.ts\)\n$/);
  const kept = plan(result.message.replace('\nAffected: D\tsrc/shared/d.ts', '').replace('Affected-Count: 4', 'Affected-Count: 3'));
  assert.match(kept.outputs, /\nrelated=\["src\/shared\/a.ts","src\/shared\/e.ts","src\/shared\/f.test.ts",/);
  assert.match(kept.summary, /\nSelection: affected — 3 paths, unit runs vitest related\n$/);
});

test('--affected on master\'s own tree pushes an affected subject and a zero count, with no path trailers', () => {
  const result = gate(['--gates', 'unit', '--affected'], { base: files, change: () => {} });
  assert.equal(result.status, 1, result.stdout + result.stderr); // the fake gh finds no run
  assert.match(result.stdout, /^ci-gate: --affected: 0 paths from the merge base [0-9a-f]{8} with origin\/master$/m);
  assert.match(result.message, /^ci-gate: [0-9a-f]{8} affected\n\n/);
  assert.deepEqual(trailers(result.message), ['Gates: unit', 'Selection: affected', 'Affected-Count: 0']);
});

test('--affected above its bound counts the paths and lists none; without the flag nothing about them is pushed', () => {
  const many = gate(['--gates', 'unit', '--affected'], {
    base: files,
    change: (tree) => {
      for (let i = 0; i < 201; i++) writeFileSync(join(tree, `src/shared/n${i}.ts`), `export const n = ${i};\n`);
    },
  });
  assert.match(many.stdout, /^ci-gate: --affected: 201 paths from the merge base [0-9a-f]{8} with origin\/master, above the bound of 200, so none is listed and the plan runs the whole suite$/m);
  assert.deepEqual(trailers(many.message), ['Gates: unit', 'Selection: affected', 'Affected-Count: 201']);
  const plain = gate(['--gates', 'unit'], { base: files, change: (tree) => writeFileSync(join(tree, 'src/shared/a.ts'), 'export const a = 2;\n') });
  assert.match(plain.message, /^ci-gate: [0-9a-f]{8}\n\n/);
  assert.deepEqual(trailers(plain.message), ['Gates: unit']);
});
