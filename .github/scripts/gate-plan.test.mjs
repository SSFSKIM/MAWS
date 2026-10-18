import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scenarios = [
  { name: 'pushes retain failure-only uploads by default', env: {}, evidence: 'false' },
  { name: 'the Evidence: yes trailer enables success uploads', env: { HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit\nEvidence: yes' }, evidence: 'true' },
  { name: 'a non-opt-in trailer leaves success uploads disabled', env: { HEAD_MESSAGE: 'Evidence: no' }, evidence: 'false' },
  { name: 'manual dispatch enables success uploads with its evidence input', env: { EVENT: 'workflow_dispatch', INPUT_EVIDENCE: 'true' }, evidence: 'true' },
  { name: 'manual dispatch false overrides a pushed evidence trailer', env: { EVENT: 'workflow_dispatch', INPUT_EVIDENCE: 'false', HEAD_MESSAGE: 'Evidence: yes' }, evidence: 'false' },
  { name: 'manual dispatch without an evidence input stays off despite a trailer', env: { EVENT: 'workflow_dispatch', HEAD_MESSAGE: 'Evidence: yes' }, evidence: 'false' },
];

// One run of the plan: its outputs and its summary.
function plan(scenarioEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-gate-plan-'));
  const output = join(dir, 'output');
  const summary = join(dir, 'summary');
  try {
    execFileSync(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        EVENT: 'push',
        HEAD_MESSAGE: '',
        INPUT_GATES: '',
        INPUT_RUNNER: '',
        INPUT_CLASS1A: '',
        INPUT_EVIDENCE: '',
        GATE_RUNNER: '',
        GATE_E2E_RUNNER: '',
        CLASS1_E2E: '',
        LINUX_E2E: '',
        POOL_E2E: '',
        LIBREOFFICE_E2E: '',
        ...scenarioEnv,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    return { outputs, summary: readFileSync(summary, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  test(scenario.name, () => {
    const { outputs, summary } = plan(scenario.env);
    assert.equal(outputs.evidence, scenario.evidence);
    assert.equal(/evidence/i.test(summary), scenario.evidence === 'true');
  });
}

test("the DefaultBeside: trailer's groups reach the e2e jobs, less default, e2e: prefixes and repeats; a dispatch has none", () => {
  const relaunch = 'ci-gate: test\n\nGates: e2e:default,e2e:side\nRunner: macos\nDefaultBeside: default,side, library e2e:tools,library';
  const { outputs, summary } = plan({ HEAD_MESSAGE: relaunch });
  assert.equal(outputs.default_beside, '["side","library","tools"]');
  assert.deepEqual(JSON.parse(outputs.e2e).map((entry) => entry.group), ['default', 'side']);
  assert.match(summary, /Default beside: side, library, tools\./);
  assert.equal(plan({}).outputs.default_beside, '[]');
  assert.equal(plan({ EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:default', INPUT_RUNNER: 'macos', HEAD_MESSAGE: relaunch }).outputs.default_beside, '[]');
});

const lists = { CLASS1_E2E: 'library desk-web', LINUX_E2E: 'library desk-web', POOL_E2E: 'desk-web' };
const runners = (outputs) => Object.fromEntries(JSON.parse(outputs.e2e).map((entry) => [entry.group, JSON.parse(entry.runner)]));
const box = ['self-hosted', 'ci-kit-pool', 'cpus-4'];
const hosted = 'ubuntu-24.04';
const mac = ['self-hosted', 'macOS', 'ARM64'];

test("a Linux lane's POOL_E2E groups run on the pool when class 1a does; the rest keep the lane's runner", () => {
  const linuxRun = (trailers) => `ci-gate: test\n\nGates: e2e:library,e2e:desk-web\nRunner: linux${trailers}`;

  const variable = plan({ ...lists, GATE_RUNNER: 'pool', HEAD_MESSAGE: linuxRun('') });
  assert.deepEqual(runners(variable.outputs), { library: hosted, 'desk-web': box });
  // No class-1a job asked for, yet the pool serves desk-web: pool-ensure runs.
  assert.equal(variable.outputs.pool, 'true');
  assert.match(variable.summary, /E2e lane: linux \(on the pool: desk-web\)\./);

  assert.deepEqual(runners(plan({ ...lists, HEAD_MESSAGE: linuxRun('\nClass1a: pool') }).outputs), { library: hosted, 'desk-web': box });
  const off = plan({ ...lists, GATE_RUNNER: 'pool', HEAD_MESSAGE: linuxRun('\nClass1a: linux') });
  assert.deepEqual(runners(off.outputs), { library: hosted, 'desk-web': hosted });
  assert.equal(off.outputs.pool, 'false');
  assert.deepEqual(runners(plan({ ...lists, EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:desk-web', INPUT_RUNNER: 'linux', INPUT_CLASS1A: 'pool' }).outputs), { 'desk-web': box });
});

// Decision Log 72: run 39116987843 planned class 1a pool on a macOS lane, and desk-web's suite drove the mini's system
// Chrome into TCC prompts that held the runner.
test('a macOS lane never takes a POOL_E2E group: the pool when class 1a is pool, else the hosted Linux runner; the Electron groups stay on the Mac', () => {
  const macRun = (trailers) => `ci-gate: test\n\nGates: static,unit,e2e:library,e2e:desk-web\nRunner: macos${trailers}`;

  const pooled = plan({ ...lists, HEAD_MESSAGE: macRun('\nClass1a: pool') });
  assert.deepEqual(runners(pooled.outputs), { library: mac, 'desk-web': box });
  assert.equal(pooled.outputs.static_runner, JSON.stringify(box));
  assert.equal(pooled.outputs.pool, 'true');
  assert.match(pooled.summary, /E2e lane: macos \(on the pool: desk-web\)\./);
  // The repository's variables as they stand (GATE_RUNNER=pool, GATE_E2E_RUNNER=macos), the default set included.
  const today = { ...lists, GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos' };
  assert.deepEqual(runners(plan({ ...today, HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:desk-web' }).outputs), { 'desk-web': box });
  assert.deepEqual(runners(plan({ ...today, HEAD_MESSAGE: 'ci-gate: test' }).outputs), { library: mac, 'desk-web': box });

  for (const class1a of ['linux', 'macos']) {
    const hostedRun = plan({ ...today, HEAD_MESSAGE: macRun(`\nClass1a: ${class1a}`) });
    assert.deepEqual(runners(hostedRun.outputs), { library: mac, 'desk-web': hosted }, class1a);
    assert.equal(hostedRun.outputs.static_runner, JSON.stringify(class1a === 'linux' ? hosted : mac), class1a);
    assert.equal(hostedRun.outputs.pool, 'false', class1a);
    assert.match(hostedRun.summary, /E2e lane: macos \(on the hosted Linux runner: desk-web\)\./, class1a);
  }
  // No variable at all: class 1a on hosted Linux, desk-web beside it.
  assert.deepEqual(runners(plan({ ...lists, HEAD_MESSAGE: macRun('') }).outputs), { library: mac, 'desk-web': hosted });
  assert.deepEqual(runners(plan({ ...lists, EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:library,e2e:desk-web', INPUT_RUNNER: 'macos', INPUT_CLASS1A: 'macos' }).outputs), { library: mac, 'desk-web': hosted });
});
