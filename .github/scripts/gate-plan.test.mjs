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
        INPUT_LIVE: '',
        GATE_RUNNER: '',
        GATE_E2E_RUNNER: '',
        CLASS1_E2E: '',
        LINUX_E2E: '',
        POOL_E2E: '',
        LIBREOFFICE_E2E: '',
        LIVE_E2E: '',
        MEASURED_E2E: '',
        ...scenarioEnv,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
      stdio: 'pipe',
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

// The plan's refusal: its exit status and its stderr line.
function refusal(scenarioEnv) {
  try {
    plan(scenarioEnv);
  } catch (error) {
    return { status: error.status, stderr: String(error.stderr) };
  }
  assert.fail('the plan did not refuse');
}

// Decision Log 75: a live run spends on purpose, so it takes the live groups alone.
const live = { LIVE_E2E: 'library-live send-to-live', CLASS1_E2E: 'default library', GATE_E2E_RUNNER: 'macos' };
const livePush = (gates, trailers = '\nLive: yes') => `ci-gate: test\n\nGates: ${gates}${trailers}`;

test('the Live: yes trailer, or the live input on a dispatch, turns live on for a set of live groups', () => {
  const on = plan({ ...live, HEAD_MESSAGE: livePush('e2e:library-live,e2e:send-to-live') });
  assert.equal(on.outputs.live, 'true');
  assert.deepEqual(JSON.parse(on.outputs.e2e).map((entry) => entry.group), ['library-live', 'send-to-live']);
  assert.match(on.summary, /Live: yes \(MAWS_LIVE, MAWS_LIBRARY_LIVE, MAWS_LIVE_DOCUMENT at 1\)\./);

  const off = plan({ ...live, HEAD_MESSAGE: livePush('static,e2e:default', '') });
  assert.equal(off.outputs.live, 'false');
  assert.doesNotMatch(off.summary, /Live/);
  assert.equal(plan({ ...live, HEAD_MESSAGE: livePush('static,e2e:default', '\nLive: no') }).outputs.live, 'false');

  const dispatch = { ...live, EVENT: 'workflow_dispatch', INPUT_RUNNER: 'macos' };
  assert.equal(plan({ ...dispatch, INPUT_GATES: 'e2e:library-live', INPUT_LIVE: 'true' }).outputs.live, 'true');
  assert.equal(plan({ ...dispatch, INPUT_GATES: 'e2e:library', INPUT_LIVE: 'false', HEAD_MESSAGE: 'Live: yes' }).outputs.live, 'false');
  assert.equal(plan({ ...dispatch, INPUT_GATES: 'e2e:library', HEAD_MESSAGE: 'Live: yes' }).outputs.live, 'false');
});

test('a live run refuses any gate that is not a live group: e2e:default, a fake group, class 1a, the default set', () => {
  const cases = [
    [livePush('e2e:library-live,e2e:default'), /not e2e:default:/],
    [livePush('e2e:library,e2e:send-to-live'), /not e2e:library:/],
    [livePush('static,unit,probes,e2e:library-live'), /not static, unit, probes:/],
    ['ci-gate: test\n\nLive: yes', /not the default set:/],
  ];
  for (const [message, named] of cases) {
    const { status, stderr } = refusal({ ...live, HEAD_MESSAGE: message });
    assert.equal(status, 1, message);
    assert.match(stderr, /^gate-plan: a live run takes only the live e2e groups \(e2e:library-live, e2e:send-to-live\), /, message);
    assert.match(stderr, named, message);
    assert.match(stderr, /ask with Gates: naming those alone \(ci-gate\.sh --live --gates e2e:<group>,…\)/, message);
  }
  const dispatched = refusal({ ...live, EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:library-live,e2e:default', INPUT_RUNNER: 'macos', INPUT_LIVE: 'true' });
  assert.equal(dispatched.status, 1);
  assert.match(dispatched.stderr, /not e2e:default:/);
});

// design-live and dashboard-live set MAWS_LIVE=1 in their own scripts, so outside a live run they would spend.
test('a run that is not live refuses a live group, whether a trailer or a dispatch asks for it', () => {
  for (const scenario of [
    { HEAD_MESSAGE: livePush('static,e2e:library-live,e2e:send-to-live', '') },
    { HEAD_MESSAGE: livePush('static,e2e:library-live,e2e:send-to-live', '\nLive: no') },
    { EVENT: 'workflow_dispatch', INPUT_GATES: 'static,e2e:library-live,e2e:send-to-live', INPUT_RUNNER: 'macos', HEAD_MESSAGE: 'Live: yes' },
  ]) {
    const { status, stderr } = refusal({ ...live, ...scenario });
    assert.equal(status, 1, JSON.stringify(scenario));
    assert.equal(stderr, 'gate-plan: e2e:library-live, e2e:send-to-live run only in a live run, a paid one: ask with Live: yes (ci-gate.sh --live)\n');
  }
});

// The flags the e2e job sets under live are the ones the LIVE_E2E groups' specs skip without; a group whose spec gates
// on another flag would build and skip under --live, as five of them did before it.
test("every LIVE_E2E group's spec skips on a flag the e2e job sets under live", () => {
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  const groups = /^ {2}LIVE_E2E: (.*)$/m.exec(workflow)[1].split(/\s+/).filter(Boolean);
  const exported = [...workflow.matchAll(/^ {6}(MAWS_\w+): \$\{\{ needs\.plan\.outputs\.live == 'true' && '1' \|\| '' \}\}$/gm)].map((match) => match[1]);
  assert.deepEqual(exported.sort(), ['MAWS_LIBRARY_LIVE', 'MAWS_LIVE', 'MAWS_LIVE_DOCUMENT']);
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const group of groups) {
    const script = scripts[`e2e:${group}`];
    assert.ok(script, `e2e:${group} has a package script`);
    const specs = script.split(/\s+/).filter((word) => /^e2e\/.*\.spec\.ts$/.test(word));
    assert.equal(specs.length, 1, `e2e:${group} runs one spec`);
    const flags = [...readFileSync(join(root, specs[0]), 'utf8').matchAll(/test\.skip\(process\.env\.(MAWS_\w+) !== '1'/g)].map((match) => match[1]);
    assert.equal(flags.length, 1, `${specs[0]} skips on one flag`);
    assert.ok(exported.includes(flags[0]), `${specs[0]} skips without ${flags[0]}, which the e2e job does not set under live`);
  }
});

// A measured group's job waits first for ci-kit's measured-job guard on a Mac, and gets the guard's 15-minute bound on
// top of the usual 30 (Decision Log 75's posture go, automated).
test('a MEASURED_E2E group is marked measured in its matrix entry, and gate.yml guards and times it by that mark', () => {
  const { outputs } = plan({ MEASURED_E2E: 'artifacts-perf document-scale', HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:artifacts-perf,e2e:library\nRunner: macos' });
  assert.deepEqual(Object.fromEntries(JSON.parse(outputs.e2e).map((entry) => [entry.group, entry.measured])), { 'artifacts-perf': true, library: false });

  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const group of /^ {2}MEASURED_E2E: (.*)$/m.exec(workflow)[1].split(/\s+/).filter(Boolean)) assert.ok(scripts[`e2e:${group}`], `e2e:${group} has a package script`);
  const job = /\n {2}e2e:\n((?: {4}.*\n|\n)*?)(?= {2}\S|$)/.exec(workflow)[1];
  assert.match(job, /\n {4}timeout-minutes: \$\{\{ matrix\.measured && 45 \|\| 30 \}\}\n/);
  // The guard is the job's first step, before the checkout, and only for a measured group on a Mac.
  assert.match(job, /\n {4}steps:\n(?: {6}#.*\n)* {6}- if: matrix\.measured && runner\.os == 'macOS'\n {8}uses: SSFSKIM\/ci-kit\/mac\/settle@v1\n {6}- id: checkout\n {8}uses: actions\/checkout@v7\n/);
  // A job refused before its checkout uploads nothing: the Mac's persistent workspace still holds the last job's reports.
  assert.match(job, /\n {6}- if: \(failure\(\) \|\| needs\.plan\.outputs\.evidence == 'true'\) && steps\.checkout\.outcome == 'success'\n {8}uses: actions\/upload-artifact@v7\n/);
});
