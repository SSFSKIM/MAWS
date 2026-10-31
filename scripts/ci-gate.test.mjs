// node --test scripts/ci-gate.test.mjs (from anywhere; no install needed). ci-gate.sh's --gates: a call that names no
// gates is refused before anything is pushed, `all` pushes the trailers the whole set always had (no `Gates:`), and a
// list goes through as it was given. The script runs whole, against a local origin and a fake `gh` that finds no run, so
// a call that pushes ends at "no run" with its commit left on the ci/ ref (--keep) to read the trailers from.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { planOf } from '../.github/scripts/gate-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// The fake gh logs every call. It finds no run of the push, and answers ci-gate-alerts.mjs's three reads with the mini's
// runner online under an open alert, so a run that puts jobs on a Mac is refused there and one that does not goes ahead.
const fakeGh = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$(dirname "$0")/gh-calls"
case "$*" in
  *" run list "*) ;;
  'variable get GATE_RUNNER '*) echo pool ;;
  'variable get GATE_E2E_RUNNER '*) echo macos ;;
  'variable list '*) ;;
  *"repos/SSFSKIM/MAWS/actions/variables"*) echo '["GATE_RUNNER","pool"]'; echo '["GATE_E2E_RUNNER","macos"]' ;;
  *"repos/SSFSKIM/ci-kit-sandbox/issues"*) echo '{"number":18,"title":"ci-kit alert: mini: UserNotificationCenter since 2026-10-19T21:08Z"}' ;;
  *"repos/SSFSKIM/MAWS/actions/runners"*) echo '{"name":"ci-kit-mac-mini","status":"online","labels":["self-hosted","macOS","ARM64","ci-kit-mac","ci-kit-mac-solo","ci-kit-mac-home"]}' ;;
  *) echo "fake gh: unexpected call $*" >&2; exit 1 ;;
esac
`;

// ci-gate.sh on a one-commit tree with `args` after the tree. Returns its status and output, the gh calls, the refs the
// origin holds and the pushed commit's message (empty when nothing was pushed). With `change`, the origin's master holds
// a first commit of `base` (path → content) and the tested commit is `change(tree, git)` on top of it.
function gate(args, { alerts = false, base = {}, change, backlog } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, XDG_CACHE_HOME: join(dir, 'cache'), MAWS_GATE_RUNNER: '', MAWS_GATE_IGNORE_ALERTS: alerts ? '' : '1' };
  for (const role of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${role}_NAME`]: 'ci-gate test', [`GIT_${role}_EMAIL`]: 'ci-gate@test.invalid' });
  const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8', env }).trim();
  let transcript = '';
  try {
    const origin = join(dir, 'origin.git');
    const tree = join(dir, 'tree');
    git('init', '--quiet', '--bare', origin);
    git('init', '--quiet', '-b', 'gates', tree);
    git('-C', tree, 'remote', 'add', 'origin', origin);
    // Every launched tree has a workflow: peer preflight reads its PEER_E2E even for a non-peer e2e request.
    mkdirSync(join(tree, '.github/workflows'), { recursive: true });
    writeFileSync(join(tree, '.github/workflows/gate.yml'), 'env:\n  PEER_E2E: cross-build\n');
    git('-C', tree, 'add', '-A');
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
    let gh = fakeGh;
    if (backlog) {
      gh = gh.replace("'variable list '*) ;;", "'variable list '*) echo direct ;;");
      gh = gh.replace('case "$*" in', `case "$*" in
  'api repos/SSFSKIM/MAWS/actions/runners?'*) ${backlog === 'failed' ? 'exit 1' : `echo '${JSON.stringify({ total_count: 1, runners: [{ name: 'ci-kit-mac-ec2', status: 'online', busy: false, labels: ['self-hosted', 'macOS', 'ARM64', 'ci-kit-mac-ec2'].map((name) => ({ name })) }] })}'`} ;;
  'api repos/'*'/actions/runs?'*) echo '{"total_count":0,"workflow_runs":[]}' ;;`);
    }
    writeFileSync(join(dir, 'gh'), gh);
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\n'); // the 30 polls for the run, at once
    chmodSync(join(dir, 'gh'), 0o755);
    chmodSync(join(dir, 'sleep'), 0o755);
    const run = spawnSync('bash', [join(root, 'scripts/ci-gate.sh'), tree, ...args, '--keep'], { encoding: 'utf8', env, maxBuffer: 8 << 20 });
    transcript = /^ci-gate: transcript in (.+)$/m.exec(run.stdout)?.[1] ?? '';
    const refs = git('--git-dir', origin, 'for-each-ref', '--format=%(refname)').split('\n').filter((ref) => ref && ref !== 'refs/heads/master');
    const calls = join(dir, 'gh-calls');
    return {
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trimEnd().split('\n') : [],
      refs,
      message: refs.length > 0 ? git('--git-dir', origin, 'log', '-1', '--format=%B', refs[0]) : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (transcript) rmSync(dirname(transcript), { recursive: true, force: true });
  }
}

// Selection trailers after the unique nonce. Coverage advice (including timing) is checked separately below.
const trailers = (message) => {
  const lines = message.trimEnd().split('\n\n').at(-1).split('\n');
  assert.match(lines[0], /^Nonce: \d+-\d+$/);
  return lines.slice(1).filter((line) => !/^(E2E|Unit)-Coverage:/.test(line));
};

test('omitting unit warns for non-doc changes, including fixture additions, deletes and moves into docs, without refusing the push', () => {
  const base = { 'fixtures/recording.json': '{}', 'docs/note.md': 'note' };
  for (const [gates, change] of [
    ['probes', (tree) => writeFileSync(join(tree, 'fixtures/new.json'), '{}')],
    ['static,unit:darwin', (tree) => rmSync(join(tree, 'fixtures/recording.json'))],
    ['probes', (_tree, git) => git('mv', 'fixtures/recording.json', 'docs/recording.json')],
    ['static', (tree) => writeFileSync(join(tree, 'README.md'), 'changed')],
  ]) {
    const result = gate(['--gates', gates, '--peer', 'none'], { base, change });
    assert.equal(result.refs.length, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /ci-gate: warning: unit omitted;.*outside docs\//);
    assert.match(result.message, /^Unit-Coverage: unit omitted;.*outside docs\//m);
    assert.deepEqual(trailers(result.message), [`Gates: ${gates}`]);
    const planned = planOf({ HEAD_MESSAGE: result.message }, { e2e: 'playwright test' });
    assert.match(planned.summary, /Unit-Coverage: unit omitted;/);
    assert.equal(planned.outputs.unit, 'false');
  }
});

test('unit coverage is quiet for docs-only or empty diffs and for unit or all selections', () => {
  const base = { 'fixtures/recording.json': '{}', 'docs/note.md': 'note' };
  for (const [gates, change] of [
    ['probes', (tree) => writeFileSync(join(tree, 'docs/note.md'), 'changed')],
    ['probes', () => {}],
    ['static, unit, probes', (tree) => writeFileSync(join(tree, 'fixtures/new.json'), '{}')],
    ['all', (tree) => writeFileSync(join(tree, 'fixtures/new.json'), '{}')],
  ]) {
    const result = gate(['--gates', gates, '--peer', 'none'], { base, change });
    assert.equal(result.refs.length, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr + result.message, /unit omitted|Unit-Coverage:/);
  }
});

test('an unreadable unit diff warns but still pushes', () => {
  const result = gate(['--gates', 'probes', '--peer', 'none']); // no origin/master
  assert.equal(result.refs.length, 1);
  assert.match(result.stdout, /warning: unit coverage failed; going ahead/);
  assert.match(result.message, /^Unit-Coverage: note: unit coverage failed; no advice available$/m);
});

test('omitted spec-import coverage warns before push and travels in the pushed commit without adding gates', () => {
  const result = gate(['--gates', 'static', '--peer', 'none'], {
    base: {
      'package.json': JSON.stringify({ scripts: { e2e: 'playwright test', 'e2e:one': 'playwright test e2e/one.spec.ts' } }),
      'playwright.config.ts': "export default { testDir: 'e2e' };",
      'e2e/one.spec.ts': "import '../src/endpoint';",
      'src/endpoint.ts': 'export const endpoint = 1;',
    },
    change(tree) { writeFileSync(join(tree, 'src/endpoint.ts'), 'export const endpoint = 2;'); },
  });
  assert.equal(result.status, 1); // the fake gh finds no run, but the advisory did not prevent the push
  assert.equal(result.refs.length, 1);
  assert.match(result.stdout, /ci-gate: warning: missing e2e:one; specs reach src\/endpoint.ts/);
  assert.match(result.message, /^E2E-Coverage: missing e2e:one; specs reach src\/endpoint.ts$/m);
  assert.deepEqual(trailers(result.message), ['Gates: static']);
});

test('an oversized advisory still produces a commit with bounded trailers and a truncation note', () => {
  const scripts = { e2e: 'playwright test' };
  for (let i = 0; i < 320; i++) scripts[`e2e:g${i}-${'x'.repeat(4000)}`] = 'playwright test e2e/one.spec.ts';
  const result = gate(['--gates', 'static', '--peer', 'none'], {
    base: {
      'package.json': JSON.stringify({ scripts }),
      'playwright.config.ts': "export default { testDir: 'e2e' };",
      'e2e/one.spec.ts': "import '../src/endpoint';",
      'src/endpoint.ts': 'export const endpoint = 1;',
    },
    change(tree) { writeFileSync(join(tree, 'src/endpoint.ts'), 'export const endpoint = 2;'); },
  });
  assert.equal(result.refs.length, 1, 'the advisory must not hit the OS argument limit before pushing');
  const advice = result.message.split('\n').filter((line) => line.startsWith('E2E-Coverage:')).join('\n');
  assert.ok(Buffer.byteLength(advice) <= 4096);
  assert.match(advice, /truncated.*stderr/);
  assert.equal((result.stdout.match(/ci-gate: warning: missing e2e:/g) ?? []).length, 320, 'stderr keeps the full group list');
  assert.deepEqual(trailers(result.message), ['Gates: static']);
});

test('a failed advisory does not stop a push, and all skips coverage entirely', () => {
  // No origin/master: the advisory cannot form its diff on this one-commit fixture.
  const failed = gate(['--gates', 'static', '--peer', 'none']);
  assert.equal(failed.refs.length, 1);
  assert.match(failed.message, /^E2E-Coverage: note: spec-import coverage unavailable/m);
  const all = gate(['--gates', 'all', '--peer', 'none']);
  assert.equal(all.refs.length, 1);
  assert.doesNotMatch(all.message, /^E2E-Coverage:/m);
});

test('a call that names no gates is refused with exit 2 and the two forms, before the alert check and the push', () => {
  // The landing set that meant the whole set before, and the class 1a call that queued it by accident (runs 39342833882,
  // 39360667046).
  for (const args of [['--class1a', 'pool', '--runner', 'macos', '--evidence'], ['--class1a', 'pool']]) {
    const result = gate(args, { alerts: true });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stderr, 'ci-gate: name the gates: --gates static,unit,probes for class 1a only, --gates all for the whole set\n');
    assert.equal(result.stdout, 'ci-gate: transcript: none (stopped before a run)\nci-gate: reports: none (stopped before a run)\n');
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
  assert.match(result.stdout, /^ci-gate: [0-9a-f]{40} as ci\/auto-gates-[A-Za-z0-9._-]+-[0-9a-f]{8} \(Gates: all\) \(Runner: macos\) \(Class1a: pool\) \(Evidence: yes\)$/m);
  assert.deepEqual(trailers(result.message), ['Runner: macos', 'Class1a: pool', 'Evidence: yes']);
});

test('--gates all reaches the alert check as the whole set, unit:darwin and the class-1 e2e groups on the Mac', () => {
  const result = gate(['--gates', 'all', '--class1a', 'pool', '--runner', 'macos'], { alerts: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^ci-gate: not pushing: this run puts jobs on a Mac \(unit:darwin, the class-1 e2e groups\) /m);
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

// ci-kit's VM lane: --lane names where the run's MAC_VM_E2E groups go (gate-plan.mjs reads the `Lane:` trailer); and
// ci-kit's hosted-Mac spec: `hosted` sends every eligible e2e group to GitHub's hosted Macs, `no-hosted` none.
test('--lane vm, vm-trial, hosted or no-hosted goes through as a Lane: trailer; any other value is refused before anything is pushed', () => {
  const vm = gate(['--gates', 'e2e:document-app', '--runner', 'macos', '--lane', 'vm']);
  assert.match(vm.stdout, /^ci-gate: [0-9a-f]{40} as ci\/auto-gates-[A-Za-z0-9._-]+-[0-9a-f]{8} \(Gates: e2e:document-app\) \(Runner: macos\) \(Lane: vm\)$/m);
  assert.deepEqual(trailers(vm.message), ['Gates: e2e:document-app', 'Runner: macos', 'Lane: vm']);
  for (const lane of ['vm-trial', 'hosted', 'no-hosted']) assert.deepEqual(trailers(gate(['--gates', 'e2e:document-app', '--lane', lane]).message), ['Gates: e2e:document-app', `Lane: ${lane}`], lane);
  for (const value of ['host', 'VM', 'vm,vm-trial', 'Hosted', 'nohosted']) {
    const refused = gate(['--gates', 'e2e:document-app', '--lane', value], { alerts: true });
    assert.equal(refused.status, 2, value);
    assert.equal(refused.stderr, `ci-gate: --lane is vm, vm-trial, hosted or no-hosted, not ${value}\n`);
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
  assert.match(plan(result.message).summary, /^Selection: affected — full suite: a deleted non-test file \(src\/shared\/d.ts\)$/m);
  const kept = plan(result.message.replace('\nAffected: D\tsrc/shared/d.ts', '').replace('Affected-Count: 4', 'Affected-Count: 3'));
  assert.match(kept.outputs, /\nrelated=\["src\/shared\/a.ts","src\/shared\/e.ts","src\/shared\/f.test.ts",/);
  assert.match(kept.summary, /^Selection: affected — 3 paths, unit runs vitest related$/m);
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

// The peer of the PEER_E2E groups (ci-gate-peer.mjs): a tree with a wire manifest names its merge base with origin/master
// and both wires in the pushed commit, from which the plan adds the peer groups when they are a minor apart.
const MANIFEST = 'src/shared/ipc/wire-manifest.json';
const wire = (minor) => `${JSON.stringify({ major: 3, minor, capabilities: [], entries: {} })}\n`;
const bump = { base: { [MANIFEST]: wire(0) }, change: (tree) => writeFileSync(join(tree, MANIFEST), wire(1)) };

test('a tree a minor past its merge base pushes the peer and both wires after the other trailers; --peer none pushes none', () => {
  const result = gate(['--gates', 'static,unit,probes', '--class1a', 'pool'], bump);
  assert.equal(result.status, 1, result.stdout + result.stderr); // the fake gh finds no run
  assert.match(result.stdout, /^ci-gate: peer [0-9a-f]{8} \(the merge base with origin\/master\), wire 3\.0; this tree's 3\.1, a minor apart$/m);
  const pushed = trailers(result.message);
  assert.deepEqual(pushed.slice(0, 2), ['Gates: static,unit,probes', 'Class1a: pool']);
  assert.match(pushed[2], /^Peer: [0-9a-f]{40}$/);
  assert.deepEqual(pushed.slice(3), ['Peer-Wire: 3.0', 'Wire: 3.1']);
  assert.deepEqual(trailers(gate(['--gates', 'static', '--peer', 'none'], bump).message), ['Gates: static']);
});

test('a --peer that names no commit is refused with exit 2 before the alert check and the push', () => {
  const result = gate(['--gates', 'static', '--peer', 'no-such-ref'], { ...bump, alerts: true });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, 'ci-gate: --peer no-such-ref: no such commit\n');
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.refs, []);
});

// The alert check plans the tested tree with the peer's trailers and an iteration run's Selection, as the run's plan
// will: a bump tree's class 1a gains a Mac job the mini's alert holds, its --affected iteration does not.
test('the alert check sees the peer group a bump adds, and none for an --affected run, which goes ahead past an alert', () => {
  const own = (path) => readFileSync(join(root, path), 'utf8');
  const planned = { ...bump, base: { ...bump.base, '.github/scripts/gate-plan.mjs': own('.github/scripts/gate-plan.mjs'), '.github/scripts/gate-affected.mjs': own('.github/scripts/gate-affected.mjs'), '.github/scripts/gate-backlog.mjs': own('.github/scripts/gate-backlog.mjs'), '.github/workflows/gate.yml': own('.github/workflows/gate.yml'), 'package.json': own('package.json') }, alerts: true };
  const held = gate(['--gates', 'static,unit,probes', '--class1a', 'pool'], planned);
  assert.equal(held.status, 2, held.stdout + held.stderr);
  assert.match(held.stderr, /^ci-gate: not pushing: this run puts jobs on a Mac \(e2e:cross-build\) /m);
  assert.deepEqual(held.refs, []);
  const iteration = gate(['--gates', 'unit', '--class1a', 'pool', '--affected'], planned);
  assert.equal(iteration.status, 1, iteration.stdout + iteration.stderr); // pushed; the fake gh finds no run
  assert.match(trailers(iteration.message).join('\n'), /^Selection: affected$/m);
});

test('--hosted-route writes a validated override, with no trailer when omitted', () => {
  for (const route of ['direct', 'mirror']) {
    const result = gate(['--gates', 'e2e:document', '--runner', 'macos', '--hosted-route', route]);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(trailers(result.message), ['Gates: e2e:document', 'Runner: macos', `Hosted-Route: ${route}`]);
  }
  const bad = gate(['--gates', 'static', '--hosted-route', 'typo']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--hosted-route is direct or mirror/);
  assert.deepEqual(bad.refs, []);
  assert.deepEqual(bad.calls, []);
});

test('a direct packaged/peer admission push is not held by the mini alert', () => {
  const own = (path) => readFileSync(join(root, path), 'utf8');
  const base = Object.fromEntries(['.github/scripts/gate-plan.mjs', '.github/scripts/gate-affected.mjs', '.github/scripts/gate-backlog.mjs', '.github/workflows/gate.yml', 'package.json'].map((path) => [path, own(path)]));
  base['.github/workflows/gate.yml'] = base['.github/workflows/gate.yml'].replace("HOSTED_MAC_JOBS: ''", 'HOSTED_MAC_JOBS: packaged');
  const result = gate(['--gates', 'packaged,e2e:cross-build', '--runner', 'macos', '--lane', 'hosted', '--hosted-route', 'direct'], { ...bump, alerts: true, base: { ...base, ...bump.base } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.refs.length > 0);
  assert.match(result.message, /^Peer: [0-9a-f]{40}\nPeer-Wire: 3\.0\nWire: 3\.1$/m);
});


test('the reserved final push ref keeps direct packaged on the Mac in the alert preflight', () => {
  const own = (path) => readFileSync(join(root, path), 'utf8');
  const base = Object.fromEntries(['.github/scripts/gate-plan.mjs', '.github/scripts/gate-affected.mjs', '.github/scripts/gate-backlog.mjs', '.github/workflows/gate.yml', 'package.json'].map((path) => [path, own(path)]));
  base['.github/workflows/gate.yml'] = base['.github/workflows/gate.yml'].replace("HOSTED_MAC_JOBS: ''", 'HOSTED_MAC_JOBS: packaged');
  const result = gate(['--gates', 'packaged', '--runner', 'macos', '--hosted-route', 'direct', '--lane', 'hosted', '--peer', 'none', '--label', 'e1-final'], { alerts: true, base, change: () => {} });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /this run puts jobs on a Mac \(packaged\)/);
  assert.deepEqual(result.refs, []);
});


test('direct calls put the cached backlog into the pushed commit, and failed counts still push without it', () => {
  const good = gate(['--gates', 'e2e:document', '--peer', 'none'], { backlog: 'good' });
  assert.equal(good.refs.length, 1, good.stdout + good.stderr);
  const sample = JSON.parse(/^Mac-Backlog: (.+)$/m.exec(good.message)?.[1] || 'null');
  assert.equal(sample?.ec2, 'idle');
  assert.equal(sample.hostedQueued, 0);
  assert.equal(good.calls.filter((call) => /actions\/runs\?status=/.test(call)).length, 10);
  const failed = gate(['--gates', 'e2e:document', '--peer', 'none'], { backlog: 'failed' });
  assert.equal(failed.refs.length, 1, failed.stdout + failed.stderr);
  assert.doesNotMatch(failed.message, /^Mac-Backlog:/m);
  assert.match(failed.stdout + failed.stderr, /backlog unavailable/);
  // A hosted-lane call (a trial or an admission) and a no-hosted one never sample: nothing of them may move to EC2.
  for (const lane of ['hosted', 'no-hosted']) {
    const asked = gate(['--gates', 'e2e:document', '--peer', 'none', '--lane', lane], { backlog: 'good' });
    assert.equal(asked.refs.length, 1, asked.stdout + asked.stderr);
    assert.doesNotMatch(asked.message, /^Mac-Backlog:/m, lane);
    assert.equal(asked.calls.filter((call) => /actions\/runs\?status=/.test(call)).length, 0, lane);
  }
});
