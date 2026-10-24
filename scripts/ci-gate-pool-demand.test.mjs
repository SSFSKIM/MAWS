// The advisory hint must count the jobs gate.yml actually schedules, not a past run's shape. No install needed;
// gate.yml's static job collects this file with scripts/*.test.mjs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { workflowEnv } from './ci-gate-alerts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/ci-gate-pool-demand.mjs');
const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');
const variables = { GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos' };
const identity = Object.fromEntries(['AUTHOR', 'COMMITTER'].flatMap((role) => [[`GIT_${role}_NAME`, 'pool-demand test'], [`GIT_${role}_EMAIL`, 'pool-demand@test.invalid']]));
const message = (trailers) => `ci-gate: test\n\n${trailers}`;
const legacyPlanner = "console.log('unsupported workflow output'); process.exit(0);\n";

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-pool-demand-'));
  const tree = join(dir, 'tree');
  const git = (...args) => execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8', env: { ...process.env, ...identity }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path, text) => {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  };
  try {
    mkdirSync(tree);
    git('init', '--quiet', '-b', 'demand');
    put('package.json', packageJson);
    put('.github/workflows/gate.yml', workflow);
    cpSync(join(root, '.github/scripts'), join(tree, '.github/scripts'), { recursive: true });
    put('src/shared/pool-demand.ts', 'export const value = 1;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'tested inputs');
    return run({ dir, tree, git, put, sha: git('rev-parse', 'HEAD') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function demand(tree, sha, trailers, vars = variables) {
  return spawnSync(process.execPath, [cli, '--git-dir', tree, '--sha', sha], {
    cwd: tmpdir(), // neither package.json nor gate.yml may come from the caller's cwd
    encoding: 'utf8',
    env: { ...process.env, ...vars, HEAD_MESSAGE: message(trailers) },
  });
}

function workflowPlan(dir, trailers, vars = variables) {
  const output = join(dir, 'output');
  const summary = join(dir, 'summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  execFileSync(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], {
    cwd: root,
    env: { PATH: process.env.PATH, ...workflowEnv(workflow), ...vars, EVENT: 'push', HEAD_MESSAGE: message(trailers), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    stdio: 'pipe',
  });
  return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

// Interpret only the workflow's job-level if, matrix and runs-on expressions. Unknown syntax fails rather than silently
// losing a job. This is intentionally independent of the CLI's counting: a changed workflow graph must change the hint.
function scheduledPoolDemand(outputs) {
  const jobs = [...workflow.slice(workflow.indexOf('\njobs:\n')).matchAll(/^ {2}([\w-]+):\n((?: {4}.*\n|\n)*)/gm)];
  const boxes = [];
  for (const [, name, body] of jobs) {
    if (name === 'plan') {
      assert.match(body, /^ {4}runs-on: \$\{\{ vars\.GATE_RUNNER == 'macos' && fromJSON\('\["self-hosted","macOS","ARM64"\]'\) \|\| 'ubuntu-slim' \}\}$/m);
      continue; // never a pool job
    }
    const condition = /^ {4}if: (.*)$/m.exec(body)?.[1];
    const [, key, operator, value] = /^needs\.plan\.outputs\.(\w+) (==|!=) '([^']*)'$/.exec(condition) ?? [];
    assert.ok(key, `${name}: unsupported condition ${condition}`);
    assert.ok(Object.hasOwn(outputs, key), `${name}: missing output ${key}`);
    if (operator === '==' ? outputs[key] !== value : outputs[key] === value) continue;
    const matrix = /^ {8}(include|variant): \$\{\{ fromJSON\(needs\.plan\.outputs\.(\w+)\) \}\}$/m.exec(body);
    const rows = matrix ? JSON.parse(outputs[matrix[2]]).map((entry) => matrix[1] === 'include' ? entry : { variant: entry }) : [{}];
    const runner = /^ {4}runs-on: (.*)$/m.exec(body)?.[1];
    for (const row of rows) {
      const outputRunner = /^\$\{\{ fromJSON\(needs\.plan\.outputs\.(\w+)\) \}\}$/.exec(runner);
      const labels = outputRunner ? JSON.parse(outputs[outputRunner[1]]) : runner === '${{ fromJSON(matrix.runner) }}' ? JSON.parse(row.runner) : runner;
      if (!Array.isArray(labels) || !labels.includes('ci-kit-pool')) continue;
      const cpu = labels.find((label) => /^cpus-\d+$/.test(label));
      assert.ok(cpu, `${name}: pool job lacks a size`);
      boxes.push(Number(cpu.slice(5)));
    }
  }
  const counts = new Map();
  for (const cpu of boxes) counts.set(cpu, (counts.get(cpu) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => b - a).map(([cpu, count]) => `${cpu}x${count}`).join(' ') || 'none';
}

const scenarios = [
  ['class 1a on the pool counts every unit shard', 'Gates: static,unit,probes\nClass1a: pool', '16x1 8x4 2x1'],
  ['the whole macOS matrix counts pool e2e and each guest build variant, not Mac jobs', 'Runner: macos', '16x1 8x4 4x3 2x1'],
  ['a Mac-only run asks for no pool boxes', 'Gates: static,unit,unit:darwin,probes,packaged\nClass1a: macos\nRunner: macos', 'none'],
  ['affected selection counts the single related-unit job', 'Gates: static,unit,probes\nSelection: affected\nAffected-Count: 1\nAffected: M\tsrc/shared/pool-demand.ts', '16x1 8x1 2x1'],
  ['an affected fallback still counts all unit shards', 'Gates: unit\nSelection: affected\nAffected-Count: 1\nAffected: M\tpackage.json', '8x4'],
  ['the VM lane needs one e2e-build box per variant, not one per guest group', 'Gates: e2e:document-app,e2e:widgets,e2e:to-human\nClass1a: linux\nRunner: macos\nLane: vm', '4x2'],
  ['hosted jobs and a hosted POOL_E2E group ask for no boxes', 'Gates: static,unit,probes,e2e:desk-web\nClass1a: linux\nRunner: linux', 'none'],
];
for (const [name, trailers, expected] of scenarios) {
  test(name, () => fixture(({ tree, sha, dir }) => {
    const result = demand(tree, sha, trailers);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${expected}\n`);
    assert.equal(result.stdout.trim(), scheduledPoolDemand(workflowPlan(dir, trailers)));
  }));
}

test('the CLI reads scripts and env lists at the pushed sha, ignoring dirty files and ambient workflow inputs', () => fixture(({ tree, sha, put, git }) => {
  const changedScripts = JSON.parse(packageJson);
  changedScripts.scripts['e2e:document-app'] = 'scripts/e2e-build.sh harness && playwright test';
  put('package.json', JSON.stringify(changedScripts));
  put('.github/workflows/gate.yml', workflow.replace(/^ {2}MAC_VM_E2E: (?:>-\n(?: {4}.*\n)+|.*\n)/m, '  MAC_VM_E2E: document-app widgets\n'));
  git('add', '.');
  git('commit', '--quiet', '-m', 'target has one build variant');
  const target = git('rev-parse', 'HEAD');
  put('package.json', packageJson);
  put('.github/workflows/gate.yml', workflow);
  const trailers = 'Gates: e2e:document-app,e2e:widgets\nRunner: macos\nLane: vm';
  assert.equal(demand(tree, target, trailers, { ...variables, MAC_VM_E2E: '', EVENT: 'workflow_dispatch', INPUT_GATES: 'static' }).stdout, '4x1\n');
  assert.equal(demand(tree, sha, trailers).stdout, '4x2\n');
}));

test('the CLI uses the target exported planner for its shard count, not the launcher or dirty tree', () => fixture(({ tree, sha, put, git }) => {
  const planner = readFileSync(join(tree, '.github/scripts/gate-plan.mjs'), 'utf8');
  put('.github/scripts/gate-plan.mjs', planner.replace('const UNIT_SHARDS = 4;', 'const UNIT_SHARDS = 1;'));
  git('add', '.');
  git('commit', '--quiet', '-m', 'target runs one unsharded unit job');
  const target = git('rev-parse', 'HEAD');
  put('.github/scripts/gate-plan.mjs', planner);
  const result = demand(tree, target, 'Gates: unit');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '8x1\n');
  assert.equal(demand(tree, sha, 'Gates: unit').stdout, '8x4\n');
}));

test('the CLI loads planner dependencies from the target commit', () => fixture(({ tree, sha, put, git }) => {
  const dependency = readFileSync(join(tree, '.github/scripts/gate-affected.mjs'), 'utf8');
  put('.github/scripts/gate-affected.mjs', "export const affected = () => ({ paths: 1, reason: 'target requires the full suite' });\n");
  git('add', '.');
  git('commit', '--quiet', '-m', 'target selection falls back to all shards');
  const target = git('rev-parse', 'HEAD');
  put('.github/scripts/gate-affected.mjs', dependency);
  const trailers = 'Gates: unit\nSelection: affected\nAffected-Count: 1\nAffected: M\tsrc/shared/pool-demand.ts';
  const result = demand(tree, target, trailers);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '8x4\n');
  assert.equal(demand(tree, sha, trailers).stdout, '8x1\n');
}));

test('the CLI refuses a missing or unsupported planner without leaking its output', () => fixture(({ tree, put, git }) => {
  for (const source of [null, 'export const notAPlanner = true;\n', legacyPlanner]) {
    if (source === null) rmSync(join(tree, '.github/scripts/gate-plan.mjs'));
    else put('.github/scripts/gate-plan.mjs', source);
    if (source === legacyPlanner) {
      const standalone = spawnSync(process.execPath, [join(tree, '.github/scripts/gate-plan.mjs')], { cwd: tree, encoding: 'utf8' });
      assert.equal(standalone.status, 0, standalone.stderr);
      assert.equal(standalone.stdout, 'unsupported workflow output\n');
    }
    git('add', '.');
    git('commit', '--quiet', '-m', 'unsupported target planner');
    const result = demand(tree, git('rev-parse', 'HEAD'), 'Gates: unit');
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
}));

test('the CLI refuses an unreadable tree or invalid plan without emitting a hint', () => fixture(({ tree, sha }) => {
  for (const [target, trailers] of [['no-such-sha', 'Gates: unit'], [sha, 'Gates: no-such-gate']]) {
    const result = demand(tree, target, trailers);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
}));

// A real local origin captures the pushed empty commit; gh and sleep alone are fake. No Actions run is created, so
// ci-gate ends at "no run" (exit 1) after the push, and --keep leaves the message available for inspection.
function pushedGate(args, { failure = '', affected = false } = {}) {
  return fixture(({ dir, tree, git, put, sha }) => {
    const origin = join(dir, 'origin.git');
    execFileSync('git', ['init', '--quiet', '--bare', origin]);
    git('remote', 'add', 'origin', origin);
    git('push', '--quiet', 'origin', 'HEAD:master');
    if (affected) {
      put('src/shared/pool-demand.ts', 'export const value = 2;\n');
      git('add', '.');
      git('commit', '--quiet', '-m', 'source change');
      sha = git('rev-parse', 'HEAD');
    }
    if (failure === 'workflow') put('.github/workflows/gate.yml', 'env:\n  MAC_VM_E2E: [cannot, read]\n');
    if (failure === 'missing-planner') rmSync(join(tree, '.github/scripts/gate-plan.mjs'));
    if (failure === 'unsupported-planner') put('.github/scripts/gate-plan.mjs', legacyPlanner);
    if (['workflow', 'missing-planner', 'unsupported-planner'].includes(failure)) {
      git('add', '.');
      git('commit', '--quiet', '-m', 'target cannot provide a pool hint');
      sha = git('rev-parse', 'HEAD');
    }
    // Dirty caller files must not affect the hint, even for --gates all.
    put('package.json', '{}');
    put('.github/workflows/gate.yml', 'env:\n  MAC_VM_E2E: not-the-tree\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> '${join(dir, 'gh-calls')}'
case "$*" in
  'variable get GATE_RUNNER -R SSFSKIM/MAWS') ${failure === 'variable' ? 'exit 1' : 'echo pool'} ;;
  'variable get GATE_E2E_RUNNER -R SSFSKIM/MAWS') echo macos ;;
  *' run list '*) ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`);
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\n');
    chmodSync(join(dir, 'gh'), 0o755);
    chmodSync(join(dir, 'sleep'), 0o755);
    const result = spawnSync('bash', [join(root, 'scripts/ci-gate.sh'), tree, ...args, '--keep'], {
      cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, ...identity, PATH: `${dir}:${process.env.PATH}`, MAWS_GATE_IGNORE_ALERTS: '1', MAWS_GATE_RUNNER: '' },
    });
    const pushed = git('--git-dir', origin, 'log', '-1', '--format=%B', `refs/heads/ci/demand-${sha.slice(0, 8)}`);
    rmSync(`/tmp/maws-review/gates/ci-${sha.slice(0, 8)}.log`, { force: true });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /ci-gate: no run of/);
    return { message: pushed, calls: readFileSync(join(dir, 'gh-calls'), 'utf8') };
  });
}

test('ci-gate pushes exactly one Pool-Demand line from the same trailers and push-time variables', () => {
  for (const [args, expected, affected] of [
    [['--gates', 'static,unit,probes'], '16x1 8x4 2x1', false],
    [['--gates', 'all', '--runner', 'macos'], '16x1 8x4 4x3 2x1', false],
    [['--gates', 'unit', '--class1a', 'macos'], 'none', false],
    [['--gates', 'static,unit,probes', '--affected'], '16x1 8x1 2x1', true],
  ]) {
    const result = pushedGate(args, { affected });
    assert.deepEqual(result.message.match(/^Pool-Demand: .*$/gm), [`Pool-Demand: ${expected}`]);
    assert.match(result.calls, /^variable get GATE_RUNNER -R SSFSKIM\/MAWS$/m);
    assert.match(result.calls, /^variable get GATE_E2E_RUNNER -R SSFSKIM\/MAWS$/m);
  }
});

test('failed variable reads or a failed CLI omit the advisory hint but still push', () => {
  for (const failure of ['variable', 'workflow', 'missing-planner', 'unsupported-planner']) {
    const result = pushedGate(['--gates', 'static,unit,probes'], { failure });
    assert.doesNotMatch(result.message, /^Pool-Demand:/m);
    assert.match(result.message, /^Gates: static,unit,probes$/m);
  }
});
