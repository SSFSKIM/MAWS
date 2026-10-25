import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { READ_AS_DATA, SOURCE_READERS, affected } from './gate-affected.mjs';

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
        INPUT_LANE: '',
        GATE_RUNNER: '',
        GATE_E2E_RUNNER: '',
        CLASS1_E2E: '',
        LINUX_E2E: '',
        POOL_E2E: '',
        LIBREOFFICE_E2E: '',
        LIVE_E2E: '',
        LIVE_GUARD_E2E: '',
        MEASURED_E2E: '',
        MAC_SHARED_E2E: '',
        MAC_VM_E2E: '',
        ...scenarioEnv,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
      stdio: 'pipe',
    });
    const raw = readFileSync(output, 'utf8');
    const outputs = Object.fromEntries(raw.trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    return { outputs, raw, summary: readFileSync(summary, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// gate.yml as GitHub reads its YAML anchors: a job's `env:` or `steps:` anchored (`    steps: &name`) is the node a later
// job's alias (`    steps: *name`) repeats, so e2e-vm runs the e2e job's steps. The text with each alias replaced by its
// anchor's lines and the anchors dropped, which the regexes and the walk below read as they read any job; an alias
// with no anchor before it throws, and any other anchor or alias stays in the text, which the walk cannot read.
const expandAliases = (workflow) => {
  const lines = workflow.split('\n');
  const anchors = new Map();
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const [, key, kind, name] = /^( {4}[\w-]+:) ([&*])([\w-]+)$/.exec(lines[i]) ?? [];
    if (kind === '&') {
      let end = i + 1;
      while (end < lines.length && /^(?: {6,}.*|\s*)$/.test(lines[end])) end++;
      while (end > i + 1 && /^\s*$/.test(lines[end - 1])) end--;
      anchors.set(name, lines.slice(i + 1, end));
      out.push(key);
    } else if (kind === '*') {
      if (!anchors.has(name)) throw new Error(`gate.yml: the alias *${name} has no anchor before it`);
      out.push(key, ...anchors.get(name));
    } else out.push(lines[i]);
  }
  return out.join('\n');
};
const rawWorkflow = () => readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
const readWorkflow = () => expandAliases(rawWorkflow());
// One job's lines under its `  <job>:` line.
const jobBody = (workflow, job) => new RegExp(`\\n {2}${job}:\\n((?: {4}.*\\n|\\n)*?)(?= {2}\\S|$)`).exec(workflow)[1];

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
  assert.equal(pooled.outputs.static_runner, JSON.stringify(['self-hosted', 'ci-kit-pool', 'cpus-16']));
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
const live = { LIVE_E2E: 'library-live presentations-live', CLASS1_E2E: 'default library', GATE_E2E_RUNNER: 'macos' };
const livePush = (gates, trailers = '\nLive: yes') => `ci-gate: test\n\nGates: ${gates}${trailers}`;

test('the Live: yes trailer, or the live input on a dispatch, turns live on for a set of live groups', () => {
  const on = plan({ ...live, HEAD_MESSAGE: livePush('e2e:library-live,e2e:presentations-live') });
  assert.equal(on.outputs.live, 'true');
  assert.deepEqual(JSON.parse(on.outputs.e2e).map((entry) => entry.group), ['library-live', 'presentations-live']);
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
    [livePush('e2e:library,e2e:presentations-live'), /not e2e:library:/],
    [livePush('static,unit,probes,e2e:library-live'), /not static, unit, probes:/],
    ['ci-gate: test\n\nLive: yes', /not the default set:/],
  ];
  for (const [message, named] of cases) {
    const { status, stderr } = refusal({ ...live, HEAD_MESSAGE: message });
    assert.equal(status, 1, message);
    assert.match(stderr, /^gate-plan: a live run takes only the live e2e groups \(e2e:library-live, e2e:presentations-live\), /, message);
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
    { HEAD_MESSAGE: livePush('static,e2e:library-live,e2e:presentations-live', '') },
    { HEAD_MESSAGE: livePush('static,e2e:library-live,e2e:presentations-live', '\nLive: no') },
    { EVENT: 'workflow_dispatch', INPUT_GATES: 'static,e2e:library-live,e2e:presentations-live', INPUT_RUNNER: 'macos', HEAD_MESSAGE: 'Live: yes' },
  ]) {
    const { status, stderr } = refusal({ ...live, ...scenario });
    assert.equal(status, 1, JSON.stringify(scenario));
    assert.equal(stderr, 'gate-plan: e2e:library-live, e2e:presentations-live run only in a live run, a paid one: ask with Live: yes (ci-gate.sh --live)\n');
  }
});

// P4-A2 (X34): the tool-time guard's heavy-case fixture joins every live run, whichever live groups it names, and no
// other run.
test('a live run takes the LIVE_GUARD_E2E groups beside the live groups it names', () => {
  const guarded = { ...live, LIVE_E2E: `${live.LIVE_E2E} tool-time-heavy-live`, LIVE_GUARD_E2E: 'tool-time-heavy-live' };
  const groups = (outputs) => JSON.parse(outputs.e2e).map((entry) => entry.group);
  assert.deepEqual(groups(plan({ ...guarded, HEAD_MESSAGE: livePush('e2e:library-live') }).outputs), ['library-live', 'tool-time-heavy-live']);
  assert.deepEqual(groups(plan({ ...guarded, EVENT: 'workflow_dispatch', INPUT_RUNNER: 'macos', INPUT_GATES: 'e2e:presentations-live', INPUT_LIVE: 'true' }).outputs), ['presentations-live', 'tool-time-heavy-live']);
  assert.deepEqual(groups(plan({ ...guarded, HEAD_MESSAGE: livePush('e2e:tool-time-heavy-live') }).outputs), ['tool-time-heavy-live']);
  assert.deepEqual(groups(plan({ ...guarded, HEAD_MESSAGE: livePush('e2e:library', '\nRunner: macos') }).outputs), ['library']);
});

// The flags the e2e job sets under live are the ones the LIVE_E2E groups' specs skip without; a group whose spec gates
// on another flag would build and skip under --live, as five of them did before it. A group may run one vitest file of
// the `live` project instead (P4-A2's tool-time-heavy-live), skipping its suite on the flag.
test("every LIVE_E2E group's spec skips on a flag the e2e job sets under live", () => {
  const workflow = readWorkflow();
  const groups = /^ {2}LIVE_E2E: (.*)$/m.exec(workflow)[1].split(/\s+/).filter(Boolean);
  // The e2e job's env, which e2e-vm aliases: each flag once in either job.
  const exportedBy = (job) => [...jobBody(workflow, job).matchAll(/^ {6}(MAWS_\w+): \$\{\{ needs\.plan\.outputs\.live == 'true' && '1' \|\| '' \}\}$/gm)].map((match) => match[1]).sort();
  const exported = exportedBy('e2e');
  assert.deepEqual(exported, ['MAWS_LIBRARY_LIVE', 'MAWS_LIVE', 'MAWS_LIVE_DOCUMENT']);
  assert.deepEqual(exportedBy('e2e-vm'), exported);
  const guards = /^ {2}LIVE_GUARD_E2E: (.*)$/m.exec(workflow)[1].split(/\s+/).filter(Boolean);
  assert.deepEqual(guards.filter((group) => !groups.includes(group)), [], 'every LIVE_GUARD_E2E group is a LIVE_E2E group');
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const group of groups) {
    const script = scripts[`e2e:${group}`];
    assert.ok(script, `e2e:${group} has a package script`);
    const specs = script.split(/\s+/).filter((word) => /^(e2e\/.*\.spec\.ts|test\/live\/.*\.live\.test\.ts)$/.test(word));
    assert.equal(specs.length, 1, `e2e:${group} runs one spec`);
    const flags = [...readFileSync(join(root, specs[0]), 'utf8').matchAll(/(?:test\.skip|describe\.skipIf)\(process\.env\.(MAWS_\w+) !== '1'/g)].map((match) => match[1]);
    assert.equal(flags.length, 1, `${specs[0]} skips on one flag`);
    assert.ok(exported.includes(flags[0]), `${specs[0]} skips without ${flags[0]}, which the e2e job does not set under live`);
  }
});

// A measured group's job waits first for ci-kit's measured-job guard on a Mac, and gets the guard's 15-minute bound on
// top of the usual 30 (Decision Log 75's posture go, automated); on the exclusive Mac instance, both get the 10 minutes
// its start may wait for the shared instances to stop on top (ci-kit's mac-lane concurrency spec, M2).
test('a MEASURED_E2E group is marked measured in its matrix entry, and gate.yml guards it by that mark and times it by the entry', () => {
  const { outputs } = plan({ MEASURED_E2E: 'artifacts-perf document-scale', HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:artifacts-perf,e2e:library\nRunner: macos' });
  assert.deepEqual(Object.fromEntries(JSON.parse(outputs.e2e).map((entry) => [entry.group, [entry.measured, entry.timeout]])), { 'artifacts-perf': [true, 55], library: [false, 40] });

  const workflow = readWorkflow();
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const group of /^ {2}MEASURED_E2E: (.*)$/m.exec(workflow)[1].split(/\s+/).filter(Boolean)) assert.ok(scripts[`e2e:${group}`], `e2e:${group} has a package script`);
  const job = /\n {2}e2e:\n((?: {4}.*\n|\n)*?)(?= {2}\S|$)/.exec(workflow)[1];
  assert.match(job, /\n {4}timeout-minutes: \$\{\{ matrix\.timeout \}\}\n/);
  // The guard is the job's first step, before the checkout, and only for a measured group on a Mac.
  assert.match(job, /\n {4}steps:\n(?: {6}#.*\n)* {6}- if: matrix\.measured && runner\.os == 'macOS'\n {8}uses: SSFSKIM\/ci-kit\/mac\/settle@v1\n {6}- id: checkout\n {8}uses: actions\/checkout@v7\n/);
  // A job refused before its checkout uploads nothing: the Mac's persistent workspace still holds the last job's reports.
  assert.match(job, /\n {6}- if: \(failure\(\) \|\| needs\.plan\.outputs\.evidence == 'true'\) && steps\.checkout\.outcome == 'success'\n {8}uses: actions\/upload-artifact@v7\n/);
});

// ci-kit's mac-lane concurrency spec (M2): a Mac job asks for today's labels, which only ci-kit's exclusive instance
// carries, so it runs alone, unless MAC_SHARED_E2E names it; then it asks for the shared instances' one label, which no
// `self-hosted` job reaches. Each start may wait in ci-kit's hook, and the timeout carries that wait: an exclusive job's
// 10 minutes for the shared instances to stop, a shared job's 60 while an exclusive job holds the desktop.
const sharedMac = ['ci-kit-mac-shared'];
// A list of gate.yml's env as the runner reads it: one line, a folded `>-` block, or '' (empty).
const workflowList = (workflow, name) => {
  const [, value, folded] = new RegExp(`^ {2}${name}: (.*)\\n((?: {4}\\S.*\\n)*)`, 'm').exec(workflow);
  return (value === '>-' ? folded.trim().split(/\s+/).join(' ') : value).replace(/^''$/, '');
};
const placement = (outputs) => Object.fromEntries(JSON.parse(outputs.e2e).map((entry) => [entry.group, [JSON.parse(entry.runner), entry.timeout]]));

// V4 waves 1, 2, 2b, 2c, 2d, 3 and 4: only the proven-VM groups leave today's exclusive labels (composer and layout, outside the
// class-1 set, only when a run names them); no group shares the host desktop.
test("gate.yml's proven-VM groups run on Solo Mac, or the named VM lane alone; every other Mac job keeps today's labels and waits", () => {
  const workflow = readWorkflow();
  const names = ['CLASS1_E2E', 'LINUX_E2E', 'POOL_E2E', 'LIBREOFFICE_E2E', 'LIVE_E2E', 'LIVE_GUARD_E2E', 'MEASURED_E2E', 'MAC_SHARED_E2E', 'MAC_VM_E2E'];
  const own = Object.fromEntries(names.map((name) => [name, workflowList(workflow, name)]));
  assert.equal(own.MAC_SHARED_E2E, '');
  assert.equal(own.MAC_VM_E2E, 'document-app widgets to-human transcript panel c7 code scm library document settings tools dashboard side presentations deliverables supervisor browser browser-comment browser-import agents c12 available design-systems browser-chrome composer layout delivery connectors-oauth artifacts browser-cua connectors connectors-direct');
  const proven = ['document-app', 'widgets', 'to-human', 'transcript', 'panel', 'c7', 'code', 'scm', 'library', 'document', 'settings', 'tools', 'dashboard', 'side', 'presentations',
    'deliverables', 'supervisor', 'browser', 'browser-comment', 'browser-import', 'agents', 'c12', 'available', 'design-systems', 'browser-chrome', 'composer', 'layout', 'delivery', 'connectors-oauth', 'artifacts', 'browser-cua', 'connectors', 'connectors-direct'];
  // The repository's variables as they stand, and the default set: class 1a on the pool, unit:darwin and every class-1
  // group on the Mac but desk-web.
  const { outputs, summary } = plan({ ...own, GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos', HEAD_MESSAGE: 'ci-gate: test' });
  const offMac = own.POOL_E2E.split(/\s+/);
  const groups = Object.entries(placement(outputs));
  assert.ok(groups.length > 30, `the class-1 set (${groups.length} groups)`);
  for (const [group, where] of groups) assert.deepEqual(where, offMac.includes(group) ? [box, 30] : proven.includes(group) ? [soloMac, 40] : [mac, 40], group);
  assert.equal(outputs.unit_darwin, 'true');
  assert.equal(outputs.unit_darwin_runner, JSON.stringify(mac));
  assert.deepEqual(JSON.parse(outputs.timeouts), { static: 30, unit: 30, probes: 30, unit_darwin: 40 });
  assert.doesNotMatch(summary, /Shared Mac|MAC_SHARED_E2E|MAC_VM_E2E|Lane/);
  assert.match(summary, /\. Solo Mac \(the exclusive instance or the guest, whichever is free\): e2e:artifacts, e2e:library, e2e:side, e2e:tools, e2e:to-human, e2e:deliverables, e2e:panel, e2e:supervisor, e2e:browser, e2e:browser-comment, e2e:browser-import, e2e:settings, e2e:transcript, e2e:code, e2e:agents, e2e:widgets, e2e:c7, e2e:scm, e2e:c12, e2e:available, e2e:document, e2e:document-app, e2e:presentations, e2e:design-systems, e2e:browser-cua, e2e:browser-chrome, e2e:dashboard, e2e:connectors, e2e:connectors-direct, e2e:connectors-oauth, e2e:delivery\. Out\/ built on the pool \(e2e-build\) for the guest-eligible jobs: harness, plain\.\n$/);
  for (const [lane, guest] of [['vm', vmMac], ['vm-trial', vmTrialMac]]) {
    const laned = plan({ ...own, GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos', HEAD_MESSAGE: `ci-gate: test\n\nLane: ${lane}` });
    const expected = Object.fromEntries(groups.map(([group, where]) => [group, proven.includes(group) ? [guest, 30] : where]));
    assert.deepEqual(placement(laned.outputs), expected, lane);
    assert.equal(laned.outputs.unit_darwin_runner, JSON.stringify(mac), lane);
    assert.deepEqual(JSON.parse(laned.outputs.timeouts), JSON.parse(outputs.timeouts), lane);
    for (const job of ['static', 'unit', 'probes']) assert.equal(laned.outputs[`${job}_runner`], outputs[`${job}_runner`], `${lane} ${job}`);
    assert.doesNotMatch(laned.summary, /Shared Mac|Solo Mac/);
    assert.match(laned.summary, new RegExp(`\\. Lane: ${lane}, on \\[${guest[0]}\\] alone: e2e:artifacts, e2e:library, e2e:side, e2e:tools, e2e:to-human, e2e:deliverables, e2e:panel, e2e:supervisor, e2e:browser, e2e:browser-comment, e2e:browser-import, e2e:settings, e2e:transcript, e2e:code, e2e:agents, e2e:widgets, e2e:c7, e2e:scm, e2e:c12, e2e:available, e2e:document, e2e:document-app, e2e:presentations, e2e:design-systems, e2e:browser-cua, e2e:browser-chrome, e2e:dashboard, e2e:connectors, e2e:connectors-direct, e2e:connectors-oauth, e2e:delivery\\. Out/ built on the pool \\(e2e-build\\) for the guest-eligible jobs: harness, plain\\.\\n$`), lane);
  }
  // composer and layout, outside the class-1 set, take the guest's labels when a run names them.
  const named = { ...own, GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos' };
  assert.deepEqual(placement(plan({ ...named, HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:composer,e2e:layout' }).outputs), { composer: [soloMac, 40], layout: [soloMac, 40] });
  assert.deepEqual(placement(plan({ ...named, HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:composer,e2e:layout\nLane: vm' }).outputs), { composer: [vmMac, 30], layout: [vmMac, 30] });
  // The measured groups, which only a run naming them takes; class 1a on the Mac carries the wait too.
  const measured = plan({ ...own, HEAD_MESSAGE: `ci-gate: test\n\nGates: ${own.MEASURED_E2E.split(/\s+/).filter((group) => !own.LIVE_E2E.includes(group)).map((group) => `e2e:${group}`).join(',')}\nRunner: macos\nClass1a: macos` }).outputs;
  for (const [group, where] of Object.entries(placement(measured))) assert.deepEqual(where, [mac, 55], group);
  assert.deepEqual(JSON.parse(measured.timeouts), { static: 40, unit: 40, probes: 40, unit_darwin: 40 });
});

test('MAC_SHARED_E2E sends its groups and unit:darwin to the shared instances, the shared wait on their timeout; the run\'s other Mac jobs stay exclusive', () => {
  const asked = 'ci-gate: test\n\nGates: unit:darwin,e2e:library,e2e:browser\nRunner: macos';
  const { outputs, summary } = plan({ MAC_SHARED_E2E: 'browser unit:darwin', HEAD_MESSAGE: asked });
  assert.deepEqual(placement(outputs), { library: [mac, 40], browser: [sharedMac, 90] });
  assert.equal(outputs.unit_darwin_runner, JSON.stringify(sharedMac));
  assert.deepEqual(JSON.parse(outputs.timeouts), { static: 30, unit: 30, probes: 30, unit_darwin: 90 });
  assert.match(summary, /\. Shared Mac instances: unit:darwin, e2e:browser\.\n$/);
  // The list is the workflow's, whatever started the run.
  assert.deepEqual(placement(plan({ MAC_SHARED_E2E: 'browser', EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:browser', INPUT_RUNNER: 'macos' }).outputs), { browser: [sharedMac, 90] });
  // Off the Mac a listed group keeps its runner: the Linux lane's, the pool's for a POOL_E2E group.
  const linuxRun = plan({ ...lists, MAC_SHARED_E2E: 'library desk-web', HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:library,e2e:desk-web\nRunner: linux\nClass1a: pool' });
  assert.deepEqual(placement(linuxRun.outputs), { library: [hosted, 30], 'desk-web': [box, 30] });
  assert.doesNotMatch(linuxRun.summary, /Shared Mac/);
});

// The spec's "What it must not be": a measured group's bounds were calibrated alone, and a foreground group's cases test
// the app in front, so neither shares the desktop, even on a scratch commit that lists it for a trial.
test('a MEASURED_E2E or foreground group on MAC_SHARED_E2E stays on the exclusive instance, and the summary says so', () => {
  const { outputs, summary } = plan({
    MEASURED_E2E: 'artifacts-perf',
    MAC_SHARED_E2E: 'artifacts-perf widgets default library',
    HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:artifacts-perf,e2e:widgets,e2e:default,e2e:library\nRunner: macos',
  });
  assert.deepEqual(placement(outputs), { 'artifacts-perf': [mac, 55], widgets: [mac, 40], default: [mac, 40], library: [sharedMac, 90] });
  assert.match(summary, /\. Shared Mac instances: e2e:library\. On MAC_SHARED_E2E but measured or foreground, so alone: e2e:artifacts-perf, e2e:widgets, e2e:default\.\n$/);
});

// A name joins MAC_SHARED_E2E on trial evidence (the spec's M4): it must be a job the plan can place there.
test('every MAC_SHARED_E2E name is unit:darwin or a class-1 Mac group, neither measured nor foreground', () => {
  const workflow = readWorkflow();
  const list = (name) => workflowList(workflow, name).split(/\s+/).filter(Boolean);
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const name of list('MAC_SHARED_E2E')) {
    if (name === 'unit:darwin') continue;
    assert.ok(name !== 'default' && !list('POOL_E2E').includes(name) && !list('LIVE_E2E').includes(name), `${name} is an e2e group that runs on the Mac`);
    assert.ok(!list('MEASURED_E2E').includes(name), `${name} is not measured`);
    assert.doesNotMatch(scripts[name === 'default' ? 'e2e' : `e2e:${name}`] ?? '', /MAWS_E2E_FOREGROUND=1/, `${name} is not foreground`);
  }
});

// ci-kit's VM lane (the same spec, "The VM lane", its V3): a group on MAC_VM_E2E asks for [ci-kit-mac-solo], which the
// exclusive instance and ci-kit's macOS guest both carry, so it runs on whichever desktop is free. On the exclusive
// instance its start waits the exclusive bound as any exclusive job's does; in the guest it waits nowhere. A `Lane: vm`
// trailer (ci-gate.sh --lane vm) sends the run's MAC_VM_E2E groups to the guest alone, [ci-kit-mac-vm], and `Lane: vm-trial`
// to the trial slot's label, which only a candidate image's trial clone carries.
const soloMac = ['ci-kit-mac-solo'];
const vmMac = ['ci-kit-mac-vm'];
const vmTrialMac = ['ci-kit-mac-vm-trial'];

test("MAC_VM_E2E sends its groups and unit:darwin to [ci-kit-mac-solo], the exclusive wait on their timeout; the run's other Mac jobs keep today's labels", () => {
  const asked = 'ci-gate: test\n\nGates: unit:darwin,e2e:library,e2e:document-app,e2e:widgets\nRunner: macos';
  const { outputs, summary } = plan({ MAC_VM_E2E: 'document-app widgets unit:darwin', HEAD_MESSAGE: asked });
  assert.deepEqual(placement(outputs), { library: [mac, 40], 'document-app': [soloMac, 40], widgets: [soloMac, 40] });
  assert.equal(outputs.unit_darwin_runner, JSON.stringify(soloMac));
  assert.deepEqual(JSON.parse(outputs.timeouts), { static: 30, unit: 30, probes: 30, unit_darwin: 40 });
  assert.match(summary, /\. Solo Mac \(the exclusive instance or the guest, whichever is free\): unit:darwin, e2e:document-app, e2e:widgets\. Out\/ built on the pool \(e2e-build\) for the guest-eligible jobs: harness, plain\.\n$/);
  // The list is the workflow's, whatever started the run.
  assert.deepEqual(placement(plan({ MAC_VM_E2E: 'widgets', EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:widgets', INPUT_RUNNER: 'macos' }).outputs), { widgets: [soloMac, 40] });
  // Off the Mac a listed group keeps its runner: the Linux lane's, the pool's for a POOL_E2E group.
  const linuxRun = plan({ ...lists, MAC_VM_E2E: 'library desk-web', HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:library,e2e:desk-web\nRunner: linux\nClass1a: pool' });
  assert.deepEqual(placement(linuxRun.outputs), { library: [hosted, 30], 'desk-web': [box, 30] });
  assert.doesNotMatch(linuxRun.summary, /Solo Mac|MAC_VM_E2E/);
});

// The guest runs at 1.3-1.7x the host's time on other hardware, and the measured bounds are the host's; a shared job
// leaves the exclusive instance alone, the scarcer of the two; a `Lane:` asks for the guest on purpose.
test('a MEASURED_E2E group on MAC_VM_E2E keeps today\'s labels under any Lane:; a group on both lists runs shared unless a Lane: names the guest', () => {
  const lists = { MEASURED_E2E: 'artifacts-perf', MAC_SHARED_E2E: 'library widgets', MAC_VM_E2E: 'artifacts-perf library widgets document-app' };
  const gates = 'Gates: e2e:artifacts-perf,e2e:library,e2e:widgets,e2e:document-app,e2e:side\nRunner: macos';
  const { outputs, summary } = plan({ ...lists, HEAD_MESSAGE: `ci-gate: test\n\n${gates}` });
  // widgets is foreground, so never shared: on MAC_VM_E2E it is solo.
  assert.deepEqual(placement(outputs), { 'artifacts-perf': [mac, 55], library: [sharedMac, 90], widgets: [soloMac, 40], 'document-app': [soloMac, 40], side: [mac, 40] });
  assert.match(summary, / Shared Mac instances: e2e:library\. On MAC_SHARED_E2E but measured or foreground, so alone: e2e:widgets\. Solo Mac \(the exclusive instance or the guest, whichever is free\): e2e:widgets, e2e:document-app\. On MAC_VM_E2E but measured, so on the exclusive instance: e2e:artifacts-perf\. Out\/ built on the pool \(e2e-build\) for the guest-eligible jobs: harness, plain\.\n$/);
  for (const [lane, guest] of [['vm', vmMac], ['vm-trial', vmTrialMac]]) {
    for (const scenario of [{ HEAD_MESSAGE: `ci-gate: test\n\n${gates}\nLane: ${lane.toUpperCase()}` }, { EVENT: 'workflow_dispatch', INPUT_GATES: gates.split('\n')[0].slice(7), INPUT_RUNNER: 'macos', INPUT_LANE: lane, HEAD_MESSAGE: 'Lane: vm-trial' }]) {
      const laned = plan({ ...lists, ...scenario });
      assert.deepEqual(placement(laned.outputs), { 'artifacts-perf': [mac, 55], library: [guest, 30], widgets: [guest, 30], 'document-app': [guest, 30], side: [mac, 40] }, `${lane} ${JSON.stringify(scenario)}`);
      assert.match(laned.summary, new RegExp(` Lane: ${lane}, on \\[${guest[0]}\\] alone: e2e:library, e2e:widgets, e2e:document-app\\. On MAC_VM_E2E but measured, so on the exclusive instance: e2e:artifacts-perf\\. Out/ built on the pool \\(e2e-build\\) for the guest-eligible jobs: harness, plain\\.\\n$`), lane);
    }
  }
  // unit:darwin on both lists: shared, and in the guest under a Lane:.
  assert.equal(plan({ MAC_SHARED_E2E: 'unit:darwin', MAC_VM_E2E: 'unit:darwin', HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit:darwin' }).outputs.unit_darwin_runner, JSON.stringify(sharedMac));
  const guestUnit = plan({ MAC_SHARED_E2E: 'unit:darwin', MAC_VM_E2E: 'unit:darwin', HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit:darwin\nLane: vm' }).outputs;
  assert.equal(guestUnit.unit_darwin_runner, JSON.stringify(vmMac));
  assert.equal(JSON.parse(guestUnit.timeouts).unit_darwin, 30);
});

test('a Lane: the plan does not know is refused, whether a trailer or a dispatch names it; none is the default routing', () => {
  for (const scenario of [{ HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:library\nRunner: macos\nLane: host' }, { EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:library', INPUT_RUNNER: 'macos', INPUT_LANE: 'guest' }]) {
    const { status, stderr } = refusal({ MAC_VM_E2E: 'library', ...scenario });
    assert.equal(status, 1, JSON.stringify(scenario));
    assert.match(stderr, /^gate-plan: no such lane: (host|guest) \(vm or vm-trial, through ci-gate\.sh --lane; none for the default routing\)\n$/);
  }
  // A dispatch reads its input alone, as it does for every other trailer.
  assert.deepEqual(placement(plan({ MAC_VM_E2E: 'library', EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:library', INPUT_RUNNER: 'macos', HEAD_MESSAGE: 'Lane: vm' }).outputs), { library: [soloMac, 40] });
});

// A name joins MAC_VM_E2E on trial evidence (the spec's V4): it must be a job the plan can place on a Mac, a class-1 group
// or one a run names (composer, layout).
test('every MAC_VM_E2E name is unit:darwin or an e2e group that runs on the Mac, not measured and built through e2e-build', () => {
  const workflow = readWorkflow();
  const list = (name) => workflowList(workflow, name).split(/\s+/).filter(Boolean);
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const name of list('MAC_VM_E2E')) {
    if (name === 'unit:darwin') continue;
    assert.ok(name !== 'default' && !list('POOL_E2E').includes(name) && !list('LIVE_E2E').includes(name), `${name} is an e2e group that runs on the Mac`);
    assert.ok(!list('MEASURED_E2E').includes(name), `${name} is not measured`);
    assert.match(scripts[`e2e:${name}`], /^scripts\/e2e-build\.sh (harness|plain) && /, `${name} restores an e2e-build variant in the guest`);
  }
});

// The same spec's Decision Log, "out/ is built on the pool": the guest's 4 GB cannot run `electron-vite build`, so a job on
// the guest's labels (solo, vm or vm-trial) restores the out/ the pool's e2e-build job made at the tested sha, its variant
// read from its script's leading `scripts/e2e-build.sh <variant> &&`. `e2e` stays every e2e job of the run, which
// ci-gate-alerts.mjs and default's derivation read; `e2e_host` and `e2e_vm` split it between the e2e and e2e-vm jobs.
const matrix = (output) => JSON.parse(output).map((entry) => [entry.group, entry.variant, JSON.parse(entry.runner)]);

test("a job on the guest's labels is guest-eligible: e2e_vm with its variant, e2e_host the rest, e2e both; e2e_build its variants, on a pool box", () => {
  const gates = 'Gates: unit:darwin,e2e:library,e2e:document-app,e2e:widgets,e2e:c12\nRunner: macos\nClass1a: linux';
  for (const [lane, guest] of [['', soloMac], ['\nLane: vm', vmMac], ['\nLane: vm-trial', vmTrialMac]]) {
    const { outputs, summary } = plan({ MAC_VM_E2E: 'document-app widgets c12 unit:darwin', HEAD_MESSAGE: `ci-gate: test\n\n${gates}${lane}` });
    assert.deepEqual(matrix(outputs.e2e_vm), [['document-app', 'plain', guest], ['widgets', 'harness', guest], ['c12', 'plain', guest]], lane);
    assert.deepEqual(matrix(outputs.e2e_host), [['library', undefined, mac]], lane);
    const all = JSON.parse(outputs.e2e);
    assert.deepEqual(all.filter((entry) => entry.variant === undefined), JSON.parse(outputs.e2e_host), lane);
    assert.deepEqual(all.filter((entry) => entry.variant !== undefined), JSON.parse(outputs.e2e_vm), lane);
    assert.deepEqual(JSON.parse(outputs.e2e_build), ['harness', 'plain'], lane);
    assert.deepEqual(JSON.parse(outputs.e2e_build_runner), box, lane);
    // Class 1a is on hosted Linux: the pool is up for e2e-build alone.
    assert.equal(outputs.pool, 'true', lane);
    // unit:darwin builds no out/: it keeps the label the lists give it, and needs no e2e-build.
    assert.equal(outputs.unit_darwin_runner, JSON.stringify(guest), lane);
    assert.match(summary, / Out\/ built on the pool \(e2e-build\) for the guest-eligible jobs: harness, plain\.\n$/, lane);
  }
  const one = plan({ MAC_VM_E2E: 'widgets', HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:widgets,unit:darwin\nRunner: macos\nClass1a: linux' }).outputs;
  assert.deepEqual(JSON.parse(one.e2e_build), ['harness']);
  // unit:darwin alone on the guest's labels builds nothing.
  const unitOnly = plan({ MAC_VM_E2E: 'unit:darwin', HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit:darwin\nRunner: macos\nClass1a: linux' }).outputs;
  assert.deepEqual([unitOnly.unit_darwin_runner, unitOnly.e2e_vm, unitOnly.e2e_build, unitOnly.pool], [JSON.stringify(soloMac), '[]', '[]', 'false']);
});

// default's out/ is the e2e job's own `pnpm build` (the whole build, desk-web and desk-hub with it), and a group like
// desk-web-hub builds and runs in another package: neither restores an e2e-build variant.
test("a MAC_VM_E2E group not built through scripts/e2e-build.sh stays off the guest's labels, whatever the Lane:, and the summary says so", () => {
  const gates = 'Gates: e2e:default,e2e:desk-web-hub,e2e:widgets\nRunner: macos';
  const { outputs, summary } = plan({ MAC_VM_E2E: 'default desk-web-hub widgets', HEAD_MESSAGE: `ci-gate: test\n\n${gates}` });
  assert.deepEqual(placement(outputs), { default: [mac, 40], 'desk-web-hub': [mac, 40], widgets: [soloMac, 40] });
  assert.deepEqual(matrix(outputs.e2e_vm), [['widgets', 'harness', soloMac]]);
  assert.deepEqual(JSON.parse(outputs.e2e_host).map((entry) => entry.group), ['default', 'desk-web-hub']);
  assert.match(summary, /\. Solo Mac \(the exclusive instance or the guest, whichever is free\): e2e:widgets\. On MAC_VM_E2E but not built through scripts\/e2e-build\.sh, so off the guest: e2e:default, e2e:desk-web-hub\. Out\/ built on the pool \(e2e-build\) for the guest-eligible jobs: harness\.\n$/);
  const laned = plan({ MAC_VM_E2E: 'default desk-web-hub widgets', MAC_SHARED_E2E: 'desk-web-hub', HEAD_MESSAGE: `ci-gate: test\n\n${gates}\nLane: vm` });
  // On both lists, it runs shared, as a group off MAC_VM_E2E would.
  assert.deepEqual(placement(laned.outputs), { default: [mac, 40], 'desk-web-hub': [sharedMac, 90], widgets: [vmMac, 30] });
  assert.match(laned.summary, / On MAC_VM_E2E but not built through scripts\/e2e-build\.sh, so off the guest: e2e:default, e2e:desk-web-hub\./);
  // Nothing guest-eligible, nothing built.
  const none = plan({ MAC_VM_E2E: 'default', HEAD_MESSAGE: 'ci-gate: test\n\nGates: e2e:default\nRunner: macos\nLane: vm' }).outputs;
  assert.deepEqual([none.e2e_host, none.e2e_vm, none.e2e_build, none.pool], [none.e2e, '[]', '[]', 'false']);
});

// The workflow's proven-VM groups build only the variants this run needs, even when a solo job lands on the host.
test("gate.yml's proven-VM groups split into e2e_vm with just their build variants; Linux and class 1a alone build nothing", () => {
  const workflow = readWorkflow();
  const names = ['CLASS1_E2E', 'LINUX_E2E', 'POOL_E2E', 'LIBREOFFICE_E2E', 'LIVE_E2E', 'LIVE_GUARD_E2E', 'MEASURED_E2E', 'MAC_SHARED_E2E', 'MAC_VM_E2E'];
  const own = Object.fromEntries(names.map((name) => [name, workflowList(workflow, name)]));
  assert.equal(own.MAC_VM_E2E, 'document-app widgets to-human transcript panel c7 code scm library document settings tools dashboard side presentations deliverables supervisor browser browser-comment browser-import agents c12 available design-systems browser-chrome composer layout delivery connectors-oauth artifacts browser-cua connectors connectors-direct');
  const variants = {
    'document-app': 'plain', widgets: 'harness', 'to-human': 'harness', transcript: 'harness', panel: 'harness',
    c7: 'harness', code: 'harness', scm: 'plain', library: 'plain', document: 'harness',
    settings: 'harness', tools: 'harness', dashboard: 'plain', side: 'harness', presentations: 'plain',
    deliverables: 'harness', supervisor: 'plain', browser: 'harness', 'browser-comment': 'harness', 'browser-import': 'harness',
    agents: 'harness', c12: 'plain', available: 'harness', 'design-systems': 'plain', 'browser-chrome': 'harness',
    composer: 'harness', layout: 'plain', delivery: 'plain', 'connectors-oauth': 'plain', artifacts: 'plain',
    'browser-cua': 'harness', connectors: 'plain', 'connectors-direct': 'plain',
  };
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [group, variant] of Object.entries(variants)) assert.ok(scripts[`e2e:${group}`].startsWith(`scripts/e2e-build.sh ${variant} && `), group);
  const today = { ...own, GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos' };
  const linuxGroups = own.LINUX_E2E.split(/\s+/);
  const linuxGates = `Gates: static,unit,probes,${linuxGroups.map((group) => `e2e:${group}`).join(',')}\nRunner: linux`;
  const defaultHost = own.CLASS1_E2E.split(/\s+/).filter((group) => !(group in variants) && (group === 'default' ? 'e2e' : `e2e:${group}`) in scripts).map((group) => [group, undefined, own.POOL_E2E.split(/\s+/).includes(group) ? box : mac]);
  const defaultGuests = ['artifacts', 'library', 'side', 'tools', 'to-human', 'deliverables', 'panel', 'supervisor', 'browser', 'browser-comment', 'browser-import', 'settings', 'transcript', 'code',
    'agents', 'widgets', 'c7', 'scm', 'c12', 'available', 'document', 'document-app', 'presentations', 'design-systems', 'browser-cua', 'browser-chrome', 'dashboard', 'connectors', 'connectors-direct', 'connectors-oauth', 'delivery'];
  const runs = [
    ['the default macOS set', 'ci-gate: test', defaultHost, defaultGuests, ['harness', 'plain'], 'true'],
    ['a Linux run', `ci-gate: test\n\n${linuxGates}`, linuxGroups.map((group) => [group, undefined, own.POOL_E2E.split(/\s+/).includes(group) ? box : hosted]), [], [], 'true'],
    ['a Linux run off the pool', `ci-gate: test\n\n${linuxGates}\nClass1a: linux`, linuxGroups.map((group) => [group, undefined, hosted]), [], [], 'false'],
    ['class 1a alone', 'ci-gate: test\n\nGates: static,unit,probes', [], [], [], 'true'],
    ['class 1a off the pool', 'ci-gate: test\n\nGates: static,unit,probes\nClass1a: linux', [], [], [], 'false'],
    ['both variants without class 1a', 'ci-gate: test\n\nGates: e2e:terminal,e2e:document-app,e2e:widgets\nRunner: macos\nClass1a: linux', [['terminal', undefined, mac]], ['document-app', 'widgets'], ['harness', 'plain'], 'true'],
    ['plain alone', 'ci-gate: test\n\nGates: e2e:document-app\nRunner: macos\nClass1a: linux', [], ['document-app'], ['plain'], 'true'],
    ['two groups sharing harness', 'ci-gate: test\n\nGates: e2e:widgets,e2e:to-human\nRunner: macos\nClass1a: linux', [], ['widgets', 'to-human'], ['harness'], 'true'],
    ['no listed group', 'ci-gate: test\n\nGates: e2e:terminal\nRunner: macos\nClass1a: linux', [['terminal', undefined, mac]], [], [], 'false'],
  ];
  for (const [name, message, host, guests, builds, pool] of runs) {
    for (const [lane, guest] of [['', soloMac], ['vm', vmMac], ['vm-trial', vmTrialMac]]) {
      const context = `${name}, lane=${lane || 'default'}`;
      const { outputs } = plan({ ...today, HEAD_MESSAGE: `${message}${lane ? `\n\nLane: ${lane}` : ''}` });
      assert.deepEqual(matrix(outputs.e2e_host), host, context);
      assert.deepEqual(matrix(outputs.e2e_vm), guests.map((group) => [group, variants[group], guest]), context);
      const all = JSON.parse(outputs.e2e);
      assert.deepEqual(all.filter((entry) => !guests.includes(entry.group)), JSON.parse(outputs.e2e_host), context);
      assert.deepEqual(all.filter((entry) => guests.includes(entry.group)), JSON.parse(outputs.e2e_vm), context);
      assert.ok(JSON.parse(outputs.e2e_host).every((entry) => !('variant' in entry)), context);
      assert.deepEqual(JSON.parse(outputs.e2e_build), builds, context);
      assert.deepEqual(JSON.parse(outputs.e2e_build_runner), box, context);
      assert.equal(outputs.pool, pool, context);
    }
  }
});

test("gate.yml builds out/ on the pool for the guest-eligible jobs, and runs them in e2e-vm with the e2e job's env and steps, restoring under REQUIRE", () => {
  const raw = rawWorkflow();
  const workflow = readWorkflow();
  for (const output of ['e2e_host', 'e2e_vm', 'e2e_build', 'e2e_build_runner']) assert.match(workflow, new RegExp(`\\n {6}${output}: \\$\\{\\{ steps\\.plan\\.outputs\\.${output} \\}\\}\\n`), output);
  // e2e-build: each variant at this sha, stored by the script itself, uploaded as e2e-build-<sha>-<variant> holding
  // <sha>/<variant>/{out,digest}.
  const build = jobBody(workflow, 'e2e-build');
  assert.match(build, /^ {4}needs: plan\n {4}if: needs\.plan\.outputs\.e2e_build != '\[\]'\n {4}runs-on: \$\{\{ fromJSON\(needs\.plan\.outputs\.e2e_build_runner\) \}\}\n/);
  assert.match(build, /\n {8}variant: \$\{\{ fromJSON\(needs\.plan\.outputs\.e2e_build\) \}\}\n/);
  assert.match(build, /\n {10}export MAWS_E2E_BUILD_CACHE=\$RUNNER_TEMP\/maws-e2e-build MAWS_E2E_BUILD_KEY=\$GITHUB_SHA\n {10}\S.* scripts\/e2e-build\.sh "\$VARIANT"\n/);
  assert.doesNotMatch(build, /MAWS_E2E_BUILD_REQUIRE/);
  assert.match(build, /\n {6}- uses: actions\/upload-artifact@v7\n {8}with:\n {10}name: e2e-build-\$\{\{ github\.sha \}\}-\$\{\{ matrix\.variant \}\}\n {10}path: \$\{\{ runner\.temp \}\}\/maws-e2e-build\/\n/);
  // e2e takes e2e_host; e2e-vm takes e2e_vm once e2e-build is done, under the same name, runner and timeout.
  const host = jobBody(workflow, 'e2e');
  const vm = jobBody(workflow, 'e2e-vm');
  assert.match(host, /^ {4}needs: plan\n {4}if: needs\.plan\.outputs\.e2e_host != '\[\]'\n/);
  assert.match(host, /\n {8}include: \$\{\{ fromJSON\(needs\.plan\.outputs\.e2e_host\) \}\}\n/);
  assert.match(vm, /^ {4}needs: \[plan, e2e-build\]\n {4}if: needs\.plan\.outputs\.e2e_vm != '\[\]'\n/);
  assert.match(vm, /\n {8}include: \$\{\{ fromJSON\(needs\.plan\.outputs\.e2e_vm\) \}\}\n/);
  for (const line of ['    name: e2e:${{ matrix.group }}', '    runs-on: ${{ fromJSON(matrix.runner) }}', '    timeout-minutes: ${{ matrix.timeout }}']) {
    assert.ok(host.includes(`\n${line}\n`) && vm.includes(`\n${line}\n`), line);
  }
  // The env and the steps are the e2e job's by alias, so every invariant above on the e2e job's holds for e2e-vm's.
  assert.match(jobBody(raw, 'e2e'), /\n {4}env: &e2e-env\n[^]*\n {4}steps: &e2e-steps\n/);
  assert.match(jobBody(raw, 'e2e-vm'), /\n {4}env: \*e2e-env\n {4}steps: \*e2e-steps\n?$/);
  const tail = (body) => body.slice(body.indexOf('\n    env:\n')).replace(/^ {4}#.*\n/gm, '').trimEnd();
  assert.equal(tail(vm), tail(host));
  // In those steps an entry with a variant downloads its build and restores it under REQUIRE; one without builds as before.
  assert.match(host, /\n {6}- if: matrix\.variant\n {8}uses: actions\/download-artifact@v8\n {8}with:\n {10}name: e2e-build-\$\{\{ github\.sha \}\}-\$\{\{ matrix\.variant \}\}\n {10}path: \$\{\{ runner\.temp \}\}\/maws-e2e-build\n/);
  assert.match(host, /\n {10}VARIANT: \$\{\{ matrix\.variant \}\}\n/);
  assert.match(host, /\n {10}if \[\[ -n \$VARIANT \]\]; then\n {12}export MAWS_E2E_BUILD_CACHE=\$RUNNER_TEMP\/maws-e2e-build MAWS_E2E_BUILD_KEY=\$GITHUB_SHA MAWS_E2E_BUILD_REQUIRE=1\n {10}elif \[\[ \$RUNNER_OS == macOS \]\]; then export MAWS_E2E_BUILD_CACHE=\$HOME\/Library\/Caches\/maws-e2e-build\/\$RUNNER_NAME /);
  // An alias with no anchor throws: the regexes and the walk never read a job whose steps they cannot see.
  assert.throws(() => expandAliases(raw.replace('    steps: &e2e-steps\n', '    steps:\n')), /the alias \*e2e-steps has no anchor before it/);
});

// ci-kit's exclusive hook, on a Mac with the VM lane, lets a job run beside a guest only when the workflow it runs under
// carries `# ci-kit-vm-contract: <n>` at the n ci-kit knows (1); any other job holds the guest off until it ends. The
// line promises that the guest can be kept off every job whose results it could change: every group with a timing bound
// is on MEASURED_E2E, and every MEASURED_E2E job on a Mac runs ci-kit's settle first, which holds the guest off for it.
// This test is that promise: the number moves only when what it pins does, and ci-kit then learns the new number.
const VM_CONTRACT = 1;
// A group's measurement switch, which turns its timing-bound cases on (each such spec skips without it, or asserts its
// bounds only under it): MAWS_<name>_PERF or MAWS_<name>_SCALE set to 1 in its package script.
const switches = (script = '') => [...script.matchAll(/(?:^|\s)(MAWS_\w+_(?:PERF|SCALE))=1(?=\s)/g)].map((match) => match[1]);

test("gate.yml carries ci-kit's VM contract line, and keeps its promise: every timing-bound group on MEASURED_E2E, each settling first on a Mac, on the exclusive instance whatever the lists and the Lane: say", () => {
  const workflow = readWorkflow();
  assert.deepEqual(workflow.match(/^.*ci-kit-vm-contract.*$/gm), [`# ci-kit-vm-contract: ${VM_CONTRACT}`]);
  const list = (name) => workflowList(workflow, name).split(/\s+/).filter(Boolean);
  const measured = list('MEASURED_E2E');
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  // Every group that turns a measurement switch on is measured; and the switch is how the list's groups are known, but
  // for tool-time-heavy-live, the tool-time guard's vitest fixture, whose per-call bounds run under MAWS_LIVE.
  const switched = Object.entries(scripts).filter(([name, script]) => /^e2e(:|$)/.test(name) && switches(script).length > 0).map(([name]) => name.slice(4));
  assert.ok(switched.length >= 6, `the switched groups (${switched.join(', ')})`);
  for (const group of switched) assert.ok(measured.includes(group), `e2e:${group} turns on ${switches(scripts[`e2e:${group}`]).join(', ')}, so it is on MEASURED_E2E`);
  for (const group of measured) {
    assert.ok(scripts[`e2e:${group}`], `e2e:${group} has a package script`);
    assert.ok(switches(scripts[`e2e:${group}`]).length > 0 || group === 'tool-time-heavy-live', `e2e:${group} turns a measurement switch on`);
  }
  // Each spec a switch gates runs its bounds under it alone, so no other group runs them (`default` collects it): it
  // skips without the switch, or reads the switch into a const its bounds sit behind, as presentations-drag's class-1
  // trial in e2e:presentations does. The const form is only as strong as the walk below, which finds a raw bound in
  // both of its forms (a number against a time, and a verdict on a bound) and fails any that sits off the switch: drop
  // the `if (MEASURED)` from a bound and the walk, not this test, catches it.
  for (const group of switched) {
    for (const spec of scripts[`e2e:${group}`].split(/\s+/).filter((word) => /^e2e\/.*\.spec\.ts$/.test(word))) {
      const text = readFileSync(join(root, spec), 'utf8');
      const gated = [...text.matchAll(/test\.skip\(process\.env\.(MAWS_\w+) !== '1'/g), ...text.matchAll(/^const \w+ = process\.env\.(MAWS_\w+) === '1'/gm)].map((match) => match[1]);
      assert.ok(gated.some((flag) => switches(scripts[`e2e:${group}`]).includes(flag)), `${spec} skips without e2e:${group}'s switch, or reads it for its bounds`);
    }
  }

  // Settle is the e2e job's first step for a measured group on a Mac, and the plan marks every MEASURED_E2E group so.
  const job = /\n {2}e2e:\n((?: {4}.*\n|\n)*?)(?= {2}\S|$)/.exec(workflow)[1];
  assert.match(job, /\n {4}steps:\n(?: {6}#.*\n)* {6}- if: matrix\.measured && runner\.os == 'macOS'\n {8}uses: SSFSKIM\/ci-kit\/mac\/settle@v1\n {6}- /);
  const live = list('LIVE_E2E');
  const runs = [
    `Gates: ${measured.filter((group) => !live.includes(group)).map((group) => `e2e:${group}`).join(',')}`,
    `Gates: ${measured.filter((group) => live.includes(group)).map((group) => `e2e:${group}`).join(',')}\nLive: yes`,
  ];
  for (const lane of ['', '\nLane: vm', '\nLane: vm-trial']) {
    for (const run of runs) {
      const { outputs } = plan({ MEASURED_E2E: measured.join(' '), LIVE_E2E: live.join(' '), MAC_SHARED_E2E: measured.join(' '), MAC_VM_E2E: measured.join(' '), HEAD_MESSAGE: `ci-gate: test\n\n${run}\nRunner: macos${lane}` });
      const entries = JSON.parse(outputs.e2e);
      assert.ok(entries.length > 0, run);
      // None of them is e2e-vm's, whose steps are the e2e job's, settle first, by alias.
      assert.equal(outputs.e2e_host, outputs.e2e, `${run}${lane}`);
      for (const entry of entries) assert.deepEqual([entry.group, entry.measured, JSON.parse(entry.runner), entry.timeout], [entry.group, true, mac, 55], `${run}${lane}`);
    }
  }
});

// The contract's other half: outside a measured job no raw time bound can break beside a busy guest. A spec's upper bound
// on a time is asserted in one of two forms: by number (`expect(<a time>).toBeLessThan(<a number>)`, the time read from
// its own text or, for a bare name, from its declaration), or by verdict (`expect(summary.bound.verdict).not.toBe('failed')`,
// or a list of rows built from `r.verdict`: a helper has judged the time against its bound, and the spec asserts the
// judgement). Either holds only behind a measurement switch (a skip, or an `if (<const>)` whose const reads a MAWS_*_PERF or
// MAWS_*_SCALE switch), so it runs in a measured job alone; through the load-aware budget (e2e/support/latency.ts,
// which a guest or ci-kit's VM lane holds to its loaded ceiling); or as one of the bounds below, each on a timer of the
// product's own with seconds of margin, or in a spec no gate job runs, which a neighbour's load cannot reach. A new raw
// bound fails here until it takes one of those forms, or joins this list with its reason. A time window that only halts
// or skips a case is no bound: presentations-ime-live's L4 retries a press-to-first-key window of 100 ms and halts the
// case when no try lands in it, in a spec that skips without MAWS_IME_LIVE=1, which no gate job sets.
const LIVENESS_BOUNDS = {
  'e2e/browser-cua.spec.ts': {
    'expect(Date.now() - refusedAt).toBeLessThan(2_000);': 'the refusal of an acting command while a person holds the tab is immediate; 2 s against the command\'s own 3 s timeout tells it from a timeout',
  },
  'e2e/c12-quit.spec.ts': {
    'expect(exitAt - ended).toBeLessThan(10_000);': 'the quit\'s own 2 s re-read after the last busy thing ends, then the hosts\' stop',
    'expect(reportMs).toBeLessThan(PROBE_BOUND_MS);': 'the quit probe\'s own 2 s bound (C12 acceptance 8), a timer of the product\'s',
    'expect(exitAt - started).toBeLessThan(PROBE_BOUND_MS + 8_000); // the report, then the existing quit path (the hosts stop)': 'that probe and the existing quit path, with 8 s of margin',
  },
  'e2e/connectors-direct.spec.ts': {
    'expect(closedMs).toBeLessThan(5_000);': 'the transport\'s close of its process group: a signal, against 5 s',
    'expect(goneMs).toBeLessThan(10_000);': 'the transport\'s own 5 s idle bound, read between 5 s and 10 s',
    'expect(goneMs).toBeLessThan(5_000);': 'the lifeline\'s end when its host is killed: a signal, against 5 s',
    "expect(elapsedMs, 'from main’s kill until every member is gone').toBeLessThan(5_000);": 'the detached host\'s client-gone cleanup after main\'s kill: signals, against 5 s',
  },
  'e2e/document-provisional.spec.ts': {
    "expect(Date.now() - composingAt, 'the batch landed inside the hold’s cap').toBeLessThan(4_500);": 'the hold\'s own cap, a timer of the product\'s',
  },
  'e2e/engine-replay.spec.ts': {
    'expect(ms).toBeLessThan(10_000);': 'the host\'s own 8 s deadline, read before the router\'s 10 s',
  },
  'e2e/presentations-provisional.spec.ts': {
    "expect(Date.now() - downAt, 'the commit reached the tab inside the hold’s cap').toBeLessThan(4_500);": 'the gesture hold\'s own 5 s cap (P4-B2 D17), a timer of the product\'s',
  },
  'e2e/sessions.spec.ts': {
    'expect(failedAfterMs).toBeLessThan(110_000);': 'two of the product\'s first-output bounds (58 s or more), read before the long class\'s 120 s',
  },
  'e2e/smoke.spec.ts': {
    "expect(Date.now() - launchedAt, 'the window shows its regions within ten seconds').toBeLessThan(10_000);": 'a launch\'s liveness: the regions visible within 10 s',
  },
  'e2e/dashboard-live-data.spec.ts': {
    "expect(Date.parse(scheduled.at) - Date.parse(last.at), 'the scheduled call within the schedule (and a margin)').toBeLessThanOrEqual(35_000);": 'the product\'s own 30 s schedule; and no gate job runs it (MAWS_DASHBOARD_LIVE_DATA, outside every list)',
  },
  'e2e/agent-tools-live.spec.ts': {
    "for (const l of latency) expect(l.rowShownAfterMs, `row of ${l.agentId} shown within a second of its start`).toBeLessThan(1_000);": 'no gate job runs it: no group\'s script names it, and the bare set skips it without its live flags',
  },
  'e2e/p1-live-keep-quit.spec.ts': {
    "expect(relaunchMs, 'relaunched within 10 s').toBeLessThan(RELAUNCH_WITHIN_MS);": 'no gate job runs it: MAWS_P1_LIVE over a packaged build, which no group sets',
  },
};
const TIME_WORD = /Date\.now\(\)|Date\.parse\(|performance\.now\(\)|\b\w*(?:Ms|MS|_MS)\b|\bms\b|\btimings?\b|\btimes\b|\belapsed\w*|\blatency\b|\bduration\b|\b[a-z]\w*At\b/;
// A number: digits, or a constant in capitals (a property of one too), joined by arithmetic.
const NUMBER = /^(?:[\d_]+(?:\.\d+)?|[A-Z][A-Z0-9_]*(?:\.\w+)*)(?:\s*[-+*/]\s*(?:[\d_]+(?:\.\d+)?|[A-Z][A-Z0-9_]*(?:\.\w+)*))*$/;
// The text of a call's first argument from the index after its opening parenthesis: up to its top-level comma or close.
const firstArgument = (text, from) => {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if ('([{'.includes(text[i])) depth++;
    else if (')]}'.includes(text[i])) {
      if (depth === 0) return text.slice(from, i);
      depth--;
    } else if (text[i] === ',' && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
};
// A verdict read in an expect's subject: the bound's judgement, which a helper made from a time and the bound.
const VERDICT_READ = /\.verdict\b/;
const EXPECT_OPEN = /\bexpect(?:\.soft|\.poll)?\(/g;
const indentOf = (line) => /^ */.exec(line)[0].length;
// The lines (0-based) a measurement switch covers in one file: a skip on it covers its block (the whole file at the top
// level); an `if (<const>)` on a const that reads it covers its statement or its block.
const switchedLines = (lines) => {
  const covered = new Set();
  const guards = new Set(lines.map((line) => /^\s*const (\w+) = process\.env\.MAWS_\w+_(?:PERF|SCALE) === '1'/.exec(line)?.[1]).filter(Boolean));
  lines.forEach((line, i) => {
    const k = indentOf(line);
    if (/(?:test|describe)\.skip(?:If)?\(process\.env\.MAWS_\w+_(?:PERF|SCALE) !== '1'/.test(line)) {
      let start = i;
      let end = i;
      if (k > 0) {
        while (start > 0 && (indentOf(lines[start]) >= k || !lines[start].trim())) start--;
        while (end < lines.length - 1 && (indentOf(lines[end + 1]) >= k || !lines[end + 1].trim())) end++;
      } else [start, end] = [0, lines.length - 1];
      for (let j = start; j <= end; j++) covered.add(j);
    }
    const guard = /^\s*if \((\w+)\)\s*(\{)?\s*(.*)$/.exec(line);
    if (guard && guards.has(guard[1])) {
      covered.add(i);
      if (guard[2]) for (let j = i + 1; j < lines.length && !(indentOf(lines[j]) === k && lines[j].trim().startsWith('}')); j++) covered.add(j);
    }
  });
  return covered;
};
// Every raw upper bound on a time in a file, outside its switched lines: the statement's text, trimmed. A bound by verdict
// is the line of the expect whose subject reads one; a bound by number is the line of its matcher.
const rawTimeBounds = (text) => {
  const lines = text.split('\n');
  const switched = switchedLines(lines);
  const found = [];
  lines.forEach((line, i) => {
    if (switched.has(i)) return;
    const rest = lines.slice(i).join('\n');
    if ([...line.matchAll(EXPECT_OPEN)].some((open) => VERDICT_READ.test(firstArgument(rest, open.index + open[0].length)))) {
      found.push(line.trim());
      return;
    }
    const bound = /\.toBeLessThan(?:OrEqual)?\(/.exec(line);
    if (!bound) return;
    let k = i;
    while (k > 0 && !/\bexpect\b/.test(lines[k])) k--;
    const statement = lines.slice(k, i + 1).join('\n');
    const open = /\bexpect(?:\.soft|\.poll)?\(/.exec(statement);
    if (!open) return;
    if (!NUMBER.test(firstArgument(line, bound.index + bound[0].length).trim())) return; // an order between two times
    const subject = firstArgument(statement, open.index + open[0].length).trim();
    const declaration = /^[A-Za-z_$][\w$]*$/.test(subject) ? (lines.slice(0, i).reverse().find((before) => new RegExp(`\\b(?:const|let)\\s+${subject}\\s*=`).test(before)) ?? '') : '';
    if (TIME_WORD.test(subject) || TIME_WORD.test(declaration)) found.push(line.trim());
  });
  return found;
};

test("outside a measured job no raw time bound runs: each is behind a measurement switch, through the load-aware budget, or a listed liveness bound", () => {
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const workflow = readWorkflow();
  const measured = workflowList(workflow, 'MEASURED_E2E').split(/\s+/);
  // Every e2e file (the bare `pnpm e2e` collects every spec), and the vitest files a group outside MEASURED_E2E runs.
  const files = execFileSync('git', ['ls-files', 'e2e/*.ts', 'e2e/**/*.ts'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const [name, script] of Object.entries(scripts)) {
    if (/^e2e:/.test(name) && !measured.includes(name.slice(4))) files.push(...script.split(/\s+/).filter((word) => /^test\/.*\.test\.ts$/.test(word)));
  }
  const found = {};
  for (const file of [...new Set(files)].sort()) {
    const bounds = rawTimeBounds(readFileSync(join(root, file), 'utf8'));
    if (bounds.length > 0) found[file] = bounds;
  }
  const listed = Object.fromEntries(Object.entries(LIVENESS_BOUNDS).map(([file, bounds]) => [file, Object.keys(bounds)]).sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(Object.fromEntries(Object.entries(found).map(([file, bounds]) => [file, [...new Set(bounds)]])), listed);
});

test('the time-bound walk finds what it must: a raw bound by its subject or the subject\'s declaration, not one behind a switch, an order, or a distance; and a bound by verdict, unless behind a switch', () => {
  const spec = [
    "test('open', async () => {",
    '  const open = timings.drawnAt - timings.openedAt;',
    '  expect(open).toBeLessThanOrEqual(1_000);',
    '  expect(drag.inputToFrameMs.p95).toBeLessThanOrEqual(16);',
    '  expect(Date.now() - startedAt).toBeLessThan(BOUND_MS + 500);',
    '  expect(firstPresence.at).toBeLessThanOrEqual(call.answeredAt);',
    '  expect(box.x + box.width).toBeLessThanOrEqual(1920);',
    "  expect(summary.bound.verdict, 'the drag within its bound').not.toBe('failed');",
    "  expect(rows.filter((r) => r.verdict !== 'met').map((r) => r.row)).toEqual([]);",
    "  expect(judged).toMatchObject({ verdict: 'met' });",
    '  if (MEASURED) expect(summary.bound.verdict).not.toBe(\'failed\');',
    '  if (MEASURED) expect(loaded.ms).toBeLessThan(3000);',
    '  if (MEASURED) {',
    '    expect(framesP95Ms).toBeLessThanOrEqual(17);',
    '  }',
    '});',
    "test('perf', async () => {",
    "  test.skip(process.env.MAWS_ARTIFACTS_PERF !== '1', 'measured only');",
    '  expect(firstSyncMs).toBeLessThan(PERF_BOUNDS.firstSyncMs);',
    '});',
    '  expect(',
    '    elapsedMs,',
    "    'over two lines',",
    '  ).toBeLessThan(5_000);',
  ];
  const guarded = ["const MEASURED = process.env.MAWS_TRANSCRIPT_PERF === '1';", ...spec].join('\n');
  assert.deepEqual(rawTimeBounds(guarded), [
    'expect(open).toBeLessThanOrEqual(1_000);',
    'expect(drag.inputToFrameMs.p95).toBeLessThanOrEqual(16);',
    'expect(Date.now() - startedAt).toBeLessThan(BOUND_MS + 500);',
    "expect(summary.bound.verdict, 'the drag within its bound').not.toBe('failed');",
    "expect(rows.filter((r) => r.verdict !== 'met').map((r) => r.row)).toEqual([]);",
    ').toBeLessThan(5_000);',
  ]);
  // A guard on a const that reads no measurement switch covers nothing.
  assert.deepEqual(rawTimeBounds(["const MEASURED = process.env.MAWS_LIVE === '1';", ...spec].join('\n')).length, 9);
});

test("gate.yml times every job that can take the exclusive Mac instance by the plan, and runs unit:darwin where the plan says", () => {
  const workflow = readWorkflow();
  const body = (job) => new RegExp(`\\n {2}${job}:\\n((?: {4}.*\\n|\\n)*?)(?= {2}\\S|$)`).exec(workflow)[1];
  for (const [job, key] of [['static', 'static'], ['unit', 'unit'], ['probes', 'probes'], ['unit-darwin', 'unit_darwin']]) {
    assert.match(body(job), new RegExp(`\\n {4}timeout-minutes: \\$\\{\\{ fromJSON\\(needs\\.plan\\.outputs\\.timeouts\\)\\.${key} \\}\\}\\n`), job);
  }
  assert.match(body('unit-darwin'), /\n {4}runs-on: \$\{\{ fromJSON\(needs\.plan\.outputs\.unit_darwin_runner\) \}\}\n/);
  assert.match(body('packaged'), /\n {4}runs-on: \[self-hosted, macOS, ARM64\]\n {4}timeout-minutes: 40 /);
  assert.match(body('plan'), /\n {4}timeout-minutes: \$\{\{ vars\.GATE_RUNNER == 'macos' && 40 \|\| 30 \}\}\n/);
  assert.match(workflow, /\n {6}unit_darwin_runner: \$\{\{ steps\.plan\.outputs\.unit_darwin_runner \}\}\n {6}timeouts: \$\{\{ steps\.plan\.outputs\.timeouts \}\}\n/);
  // H1 of the spec's audit: each runner instance restores and stores its builds in a directory of its own.
  assert.match(body('e2e'), /export MAWS_E2E_BUILD_CACHE=\$HOME\/Library\/Caches\/maws-e2e-build\/\$RUNNER_NAME /);
});

// ci-kit's job-started hook refuses a job by failing its start, which does not abort it: a later step whose condition
// can hold after a failure still runs, beside whatever the hook would not admit it beside. ci-kit's contract (its
// mac-lane concurrency spec): such a step of a Mac job leaves the desktop alone. Here that means an artifact upload, or a
// step that waits on the outcome of a step only an admitted job runs. The walk reads the workflow's text as gate.yml
// writes it, and fails closed: a job, a step, a condition or a runs-on it cannot read counts against the workflow.
let macPlans;
// The plans a runs-on is read from, run once: every gate on a Mac, exclusive, shared, solo and in the guest.
const everyMacPlan = () => {
  const message = 'ci-gate: test\n\nGates: static,unit,unit:darwin,probes,e2e:library\nRunner: macos\nClass1a: macos';
  macPlans ??= [{}, { MAC_SHARED_E2E: 'library unit:darwin' }, { MAC_VM_E2E: 'library unit:darwin' }, { MAC_VM_E2E: 'library unit:darwin', lane: 'vm' }, { MAC_VM_E2E: 'library unit:darwin', lane: 'vm-trial' }].map(({ lane, ...listed }) =>
    plan({ CLASS1_E2E: 'library', ...listed, HEAD_MESSAGE: `${message}${lane ? `\nLane: ${lane}` : ''}` }).outputs,
  );
  return macPlans;
};
// The label sets a runs-on can resolve to: a literal list or label, or fromJSON over a plan output or the e2e matrix's
// runner. null for any other form (an expression over a variable, a block sequence), which counts as a Mac.
const labelSets = (spec) => {
  if (/^\[[^\]$]*\]$/.test(spec)) return [spec.slice(1, -1).split(',').map((label) => label.trim().replace(/^(['"])(.*)\1$/, '$2'))];
  if (/^[\w.-]+$/.test(spec)) return [[spec]];
  const [, output, matrix] = /^\$\{\{\s*fromJSON\((?:needs\.plan\.outputs\.(\w+)|(matrix\.runner))\)\s*\}\}$/.exec(spec) ?? [];
  if (output) return everyMacPlan().map((outputs) => [JSON.parse(outputs[output])].flat());
  if (matrix) return everyMacPlan().flatMap((outputs) => JSON.parse(outputs.e2e).map((entry) => [JSON.parse(entry.runner)].flat()));
  return null;
};
// A runner takes a job when it carries every label the job asks for, case aside; the Mac's instances are known by the
// labels the plan asks for: today's three for the exclusive one, theirs for the shared ones, and the VM lane's (solo, the
// guest, its trial slot).
const onMac = (labels) => [mac, sharedMac, soloMac, vmMac, vmTrialMac].some((carried) => labels.every((label) => carried.some((own) => own.toLowerCase() === label.toLowerCase())));
// A step's keys, each with the lines of its value: the rest of the key's line, then the lines indented under it. null
// when a line at the keys' indent is no plain `key:` (a flow mapping, a merge key, a quoted key) or a key repeats.
const stepKeys = (step) => {
  const keys = new Map();
  let key = null;
  for (const line of step.replace(/^ {6}- /, ' '.repeat(8)).split('\n')) {
    if (/^\s*$/.test(line)) continue;
    if (key && /^ {9}/.test(line)) keys.get(key).push(line.trim());
    else if (/^ {0,8}#/.test(line)) key = null;
    else {
      [, key] = /^ {8}([\w-]+):(?: |$)/.exec(line) ?? [];
      if (!key || keys.has(key)) return null;
      keys.set(key, [line.slice(line.indexOf(':') + 1).trim()]);
    }
  }
  return keys;
};
// A value as YAML reads it, line breaks as spaces: a block scalar's lines under its indicator, a plain one's all.
const scalar = ([first, ...rest]) => (/^[|>][1-9+-]*$/.test(first) ? rest : [first, ...rest]).filter(Boolean).join(' ');
// A step's condition, its `${{ }}` dropped: '' when it has none, null when the walk cannot read it (a quoted, tagged or
// interpolated value, or an unreadable step).
const condition = (keys) => {
  if (!keys?.has('if')) return keys ? '' : null;
  const value = scalar(keys.get('if'));
  const text = value.replace(/^\$\{\{(.*)\}\}$/, '$1').trim();
  return /^[!&*'"[{%@`]/.test(value) || /\$\{\{|\}\}/.test(text) || !text ? null : text;
};
// Any status check drops GitHub's implicit `success() &&`, so the step can run after a failed start: success() too
// (`!success()`), which a step that means `success() && x` can leave out.
const afterFailure = (cond) => cond === null || /\b(?:success|failure|always|cancelled)\s*\(/i.test(cond);
// An expression's operands of `op` (&& or ||) outside its parentheses and string literals; null when those do not
// balance.
const operands = (text, op) => {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (depth === 0 && text.startsWith(op, i)) {
      parts.push(text.slice(start, i).trim());
      start = i + op.length;
    }
    if (depth < 0) return null;
  }
  return depth === 0 && !quoted ? [...parts, text.slice(start).trim()] : null;
};
// An expression wholly in parentheses, the opening one closing at its very end, without them.
const unwrap = (text) => (/^\(.*\)$/.test(text) && operands(text.slice(1, -1), '||') ? unwrap(text.slice(1, -1).trim()) : text);
// A guard: an admitted-only step's outcome compared with success or failure, or a parenthesized || of such alone.
const guard = (conjunct, admitted) =>
  operands(unwrap(conjunct), '||')?.every((comparison) => admitted.includes(/^steps\.([\w-]+)\.outcome\s*==\s*'(?:success|failure)'$/.exec(unwrap(comparison))?.[1])) === true;
// Every top-level || alternative of the condition has a top-level && conjunct that is a guard (&& binds tighter).
const waits = (cond, admitted) => operands(unwrap(cond), '||')?.every((alternative) => operands(unwrap(alternative), '&&')?.some((conjunct) => guard(conjunct, admitted))) === true;

// The workflow's Mac jobs, and each of their steps that can run after a refused start yet is no upload and waits on no
// admitted step.
const refusedStartWalk = (text) => {
  const workflow = expandAliases(text);
  const macJobs = [];
  const unsafe = [];
  const jobs = /^jobs:\n((?:[ #].*\n|\n)*)/m.exec(workflow)[1];
  const jobPattern = /^ {2}([\w-]+):\n((?: {4}.*\n| *#.*\n|\n)*)/gm;
  // A line no job takes in starts a job the walk cannot read.
  const unread = jobs.replace(jobPattern, '').split('\n').find((line) => !/^\s*(?:#|$)/.test(line));
  if (unread) unsafe.push({ job: null, step: unread.trim(), condition: null });
  for (const [, job, body] of jobs.matchAll(jobPattern)) {
    if (labelSets(/^ {4}runs-on:(.*)$/m.exec(body)?.[1].trim() ?? '')?.some(onMac) === false) continue;
    macJobs.push(job);
    const [head, ...chunks] = body.slice(body.indexOf('    steps:\n')).split(/\n(?= {6}- )/);
    if (!/^ {4}steps:(?:\n *(?:#.*)?)*$/.test(head)) unsafe.push({ job, step: 'steps:', condition: null });
    const steps = chunks.map((chunk) => ({ chunk, keys: stepKeys(chunk) }));
    // The steps that run only after a start that succeeded: their outcome is success or failure only in an admitted job.
    const admitted = steps.filter(({ keys }) => !afterFailure(condition(keys))).map(({ keys }) => scalar(keys.get('id') ?? [''])).filter(Boolean);
    for (const { chunk, keys } of steps) {
      const cond = condition(keys);
      if (!afterFailure(cond) || scalar(keys?.get('uses') ?? ['']).startsWith('actions/upload-artifact@') || (cond !== null && waits(cond, admitted))) continue;
      unsafe.push({ job, step: keys ? scalar(keys.get('run') ?? keys.get('uses') ?? ['']) : chunk.trim().split('\n')[0], condition: cond });
    }
  }
  return { macJobs: macJobs.sort(), unsafe };
};
const gateMacJobs = ['e2e', 'e2e-vm', 'packaged', 'plan', 'probes', 'static', 'unit', 'unit-darwin'];

test('a step of a Mac job that can run after its start was refused is an upload, or waits on a step only an admitted job runs', () => {
  assert.deepEqual(refusedStartWalk(readWorkflow()), { macJobs: gateMacJobs, unsafe: [] });
});

// Each mutation rewrites a few of today's lines, matched once, into a form the walk must not pass.
test('the walk fails closed: a rewrite that lets a step run after a refused start comes back unsafe, and a runs-on it cannot read counts as a Mac', () => {
  const workflow = rawWorkflow();
  // static's wait steps (gate-bg.sh), each `- name:` first, then its condition.
  const waitStep = (check, name) => [`      - name: ${name}\n`, "        if: ${{ !cancelled() && steps.checkout.outcome == 'success' }}\n", `        run: .github/scripts/gate-bg.sh wait ${check}\n`];
  const [lintName, lintIf, lint] = waitStep('lint', 'pnpm lint');
  const [typecheckName, typecheckIf, typecheck] = waitStep('typecheck', 'pnpm typecheck');
  const fuses = "        run: .github/scripts/gate-run.sh 'RunAsNode|verify:fuses' pnpm verify:fuses\n";
  const mutations = [
    // The guard dropped: a bare !cancelled() runs the step after a refused start.
    [typecheckName + typecheckIf + typecheck, typecheckName + '        if: ${{ !cancelled() }}\n' + typecheck, ['static: typecheck']],
    // A folded condition is the lines under its indicator.
    [lintName + lintIf + lint, lintName + '        if: >-\n          ${{ always() }}\n' + lint, ['static: lint']],
    // success() is a status check too: the implicit `success() &&` is gone.
    [lintName + lintIf + lint, lintName + '        if: ${{ !success() }}\n' + lint, ['static: lint']],
    // && binds tighter than ||: the outcome guards one alternative, and failure() alone runs the step.
    [lintName + lintIf + lint, lintName + "        if: ${{ failure() || needs.plan.outputs.evidence == 'true' && steps.checkout.outcome == 'success' }}\n" + lint, ['static: lint']],
    // A step a refused start skips has the outcome skipped.
    [
      "      - if: ${{ !cancelled() && steps.build.outcome == 'success' }}\n" + fuses,
      "      - if: ${{ !cancelled() && (steps.build.outcome == 'success' || steps.build.outcome == 'skipped') }}\n" + fuses,
      ['packaged: verify:fuses'],
    ],
    // e2e-vm aliases the e2e job's steps: a rewrite of one is a rewrite of both.
    ['      - if: matrix.build\n', '      - if: always() && matrix.build\n', ['e2e: build', 'e2e-vm: build']],
    ['      - if: matrix.variant\n', '      - if: always() && matrix.variant\n', ['e2e: actions/download-artifact@v8', 'e2e-vm: actions/download-artifact@v8']],
    // A checkout that can run after a refused start guards nothing.
    ['    steps:\n      - id: checkout\n', '    steps:\n      - id: checkout\n        if: always()\n', ['static: actions/checkout@v7', 'static: typecheck', 'static: lint', 'static: build', 'static: gate-scripts']],
    // An expression over a variable can name the Mac.
    ['    runs-on: [self-hosted, macOS, ARM64]\n', "    runs-on: ${{ vars.PACKAGED_RUNNER || 'ubuntu-24.04' }}\n", []],
  ];
  for (const [before, after, expected] of mutations) {
    const parts = workflow.split(before);
    assert.equal(parts.length, 2, before);
    const { macJobs, unsafe } = refusedStartWalk(parts.join(after));
    assert.deepEqual(macJobs, gateMacJobs, after);
    assert.deepEqual(unsafe.map(({ job, step }) => `${job}: ${step.split(' ').at(-1)}`), expected, after);
  }
});

// Selection for iteration runs (ci-kit's test-history spec, M4; gate-affected.mjs): a push whose commit says
// `Selection: affected` lists its change, and the plan narrows unit and unit:darwin to vitest's related mode over it, or
// says why it runs the full suite.
const selected = (lines, count = lines.length) => `ci-gate: 0123abcd affected\n\nNonce: 1-2\nGates: unit\nClass1a: pool\nSelection: affected\nAffected-Count: ${count}${lines.map((line) => `\nAffected: ${line}`).join('')}`;
const decide = (lines, count) => affected(selected(lines, count));

test('a run without the Selection: trailer writes the outputs and the summary it always wrote, byte for byte', () => {
  const pushed = plan({ HEAD_MESSAGE: 'ci-gate: 0123abcd\n\nNonce: 1-2\nGates: static,unit,probes\nClass1a: pool' });
  const outputs = [
    'static=true', 'unit=true', 'unit_darwin=false', 'probes=true', 'e2e=[]',
    `static_runner=${JSON.stringify(['self-hosted', 'ci-kit-pool', 'cpus-16'])}`, `unit_runner=${JSON.stringify(['self-hosted', 'ci-kit-pool', 'cpus-8'])}`, `probes_runner=${JSON.stringify(['self-hosted', 'ci-kit-pool', 'cpus-2'])}`, 'pool=true',
    'packaged=false', 'evidence=false', 'live=false', 'default_beside=[]',
    `unit_shards=${JSON.stringify([{ shard: '1/4', slug: '-1of4' }, { shard: '2/4', slug: '-2of4' }, { shard: '3/4', slug: '-3of4' }, { shard: '4/4', slug: '-4of4' }])}`,
    `unit_darwin_runner=${JSON.stringify(['self-hosted', 'macOS', 'ARM64'])}`, 'timeouts={"static":30,"unit":30,"probes":30,"unit_darwin":40}',
    // The VM lane's (ci-kit's mac-lane concurrency spec, "out/ is built on the pool"): no e2e job, so none on the guest.
    'e2e_host=[]', 'e2e_vm=[]', 'e2e_build=[]', `e2e_build_runner=${JSON.stringify(['self-hosted', 'ci-kit-pool', 'cpus-4'])}`,
  ];
  assert.equal(pushed.raw, `${outputs.join('\n')}\n`);
  assert.equal(pushed.summary, '### Gates\n\n- `static`\n- `unit`\n- `probes`\n\nFrom: the `Gates:` trailer. Class 1a: pool. E2e lane: linux.\n');
  // A dispatch never reads the trailer, whatever the pushed commit says.
  const dispatched = plan({ EVENT: 'workflow_dispatch', INPUT_GATES: 'unit', HEAD_MESSAGE: selected(['M\tsrc/shared/a.ts']) });
  assert.equal(dispatched.outputs.selection, undefined);
  assert.equal(dispatched.outputs.related, undefined);
  assert.doesNotMatch(dispatched.summary, /Selection/);
});

test('a source-only change runs vitest related over its paths, and the summary gives their count', () => {
  const { outputs, summary } = plan({ HEAD_MESSAGE: selected(['M\tapps/desk-web/src/views/org/OrgView.tsx', 'A\tapps/desk-web/src/views/org/badge.ts']) });
  assert.equal(outputs.selection, 'affected');
  assert.deepEqual(JSON.parse(outputs.related), ['apps/desk-web/src/views/org/OrgView.tsx', 'apps/desk-web/src/views/org/badge.ts']);
  assert.match(summary, /\nSelection: affected — 2 paths, unit runs vitest related\n$/);
  // The gate set is what the trailers ask, as without selection.
  assert.equal(outputs.unit, 'true');
  assert.equal(outputs.static, 'false');
});

test('every fallback runs the full suite and names the path that sent it there', () => {
  const cases = [
    ['M\tpnpm-lock.yaml', /^the lockfile or a package.json \(pnpm-lock.yaml\)$/],
    ['M\tpackage.json', /^the lockfile or a package.json \(package.json\)$/],
    ['M\tapps/desk-web/package.json', /^the lockfile or a package.json/],
    ['M\tvitest.config.ts', /^a vitest or vite config \(vitest.config.ts\)$/],
    ['M\tapps/desk-hub/vitest.config.ts', /^a vitest or vite config/],
    ['M\tapps/desk-web/vite.config.ts', /^a vitest or vite config/],
    ['M\telectron.vite.config.ts', /^a vitest or vite config/],
    ['M\ttest/support/compiled-suites.ts', /^test support \(test\/support\/compiled-suites.ts\)$/],
    ['M\ttest/support/artifacts-dom-setup.ts', /^test support/],
    ['A\tapps/desk-hub/test/support/bundle.ts', /^test support/],
    ['M\ttest/live/support/live.ts', /^test support/],
    ['M\t.github/workflows/gate.yml', /^a gate file \(\.github\/workflows\/gate.yml\)$/],
    ['M\tscripts/darwin-unit-files.sh', /^a gate file/],
    ['M\tdocs/doperpowers/evidence/p1-e8/g0-cli-probe.txt', /^read through fs, a glob or a query import \(docs\/doperpowers\/evidence\/p1-e8\/g0-cli-probe.txt\)$/],
    ['A\tdocs/doperpowers/evidence/p1-e8/note.ts', /^read through fs, a glob or a query import/],
    ['R100\tdocs/doperpowers/plans/a.md\tdocs/doperpowers/evidence/p1-e8/a.md', /^read through fs, a glob or a query import \(docs\/doperpowers\/evidence\/p1-e8\/a.md\)$/],
    ['R100\tdocs/a.ts\tsrc/shared/a.ts', /^a renamed non-test file \(docs\/a.ts → src\/shared\/a.ts\)$/],
    ['R100\tsrc/shared/a.ts\tdocs/a.ts', /^a renamed non-test file/],
    ['M\te2e/library.spec.ts', /^outside the source and test trees/],
    ['M\tspikes/protocol-probe/fixtures/pass3/x.jsonl', /^outside the source and test trees/],
    ['M\tapps/desk-hub/wrangler.jsonc', /^outside the source and test trees/],
    ['M\tapps/desk-hub/fake-machine/machine.ts', /^outside the source and test trees/],
    ['D\tsrc/shared/sessions/models.ts', /^a deleted non-test file \(src\/shared\/sessions\/models.ts\)$/],
    ['R100\tsrc/shared/a.ts\tsrc/shared/b.ts', /^a renamed non-test file \(src\/shared\/a.ts → src\/shared\/b.ts\)$/],
    ['R090\tsrc/shared/a.ts\tsrc/shared/a.test.ts', /^a renamed non-test file/],
    ['M\tsrc/renderer/src/styles/tokens.css', /^read through fs, a glob or a query import \(src\/renderer\/src\/styles\/tokens.css\)$/],
    ['M\tsrc/artifacts/types/document/SKILL.md', /^read through fs, a glob or a query import/],
    ['A\ttest/fixtures/settings/new.json', /^read through fs, a glob or a query import/],
    ['A\ttest/snapshots/transcript/helper.ts', /^read through fs, a glob or a query import \(test\/snapshots\/transcript\/helper.ts\)$/],
    ['C080\tsrc/shared/a.ts\tsrc/shared/c.ts', /^a change git calls C080 \(src\/shared\/c.ts\)$/],
  ];
  for (const [line, reason] of cases) {
    const decision = decide(['M\tsrc/shared/sessions/model-label.ts', line]);
    assert.equal(decision.related, undefined, line);
    assert.equal(decision.paths, 2, line);
    assert.match(decision.reason, reason, line);
  }
  const { outputs, summary } = plan({ HEAD_MESSAGE: selected(['M\tsrc/shared/a.ts', 'M\tpackage.json']) });
  assert.equal(outputs.selection, 'affected');
  assert.equal(outputs.related, '');
  assert.match(summary, /\nSelection: affected — full suite: the lockfile or a package.json \(package.json\)\n$/);
});

test("a test file's rename or delete keeps the selection, the renamed file related and the deleted one not", () => {
  assert.deepEqual(decide(['R100\tsrc/shared/a.test.ts\tsrc/shared/b.test.ts', 'D\tsrc/shared/c.test.ts', 'M\tsrc/shared/d.ts', 'D\tsrc/renderer/src/x.test.tsx']), {
    paths: 4,
    related: [
      'src/shared/b.test.ts', 'src/shared/d.ts',
      // the readers of src/renderer (the deleted suite) and of src/shared, in SOURCE_READERS' order
      'test/support/tokens-guard.test.ts', 'test/support/compiled-suites.test.ts', 'test/artifacts/one-schema.test.ts', 'src/engine-host/bundle-guard.test.ts', 'src/preload/bundle.test.ts',
      'src/preload/bridge.test.ts', 'src/engine-host/documents/sigkill.test.ts', 'src/engine-host/documents/retention-crash.test.ts',
    ],
  });
  // A test file under a support directory is a suite, not support.
  assert.deepEqual(decide(['M\ttest/support/tokens-guard.test.ts']).related, ['test/support/tokens-guard.test.ts']);
  // A deleted suite leaves nothing to run where no suite reads its tree; a type test is a test file too.
  assert.deepEqual(decide(['D\tapps/desk-web/src/views/org/OrgView.test.tsx']), { paths: 1, related: [] });
  assert.equal(decide(['D\tsrc/shared/sessions/intent.test-d.ts']).related.includes('src/shared/sessions/intent.test-d.ts'), false);
});

test("a change above ci-gate's bound, or a list that does not add up, runs the full suite", () => {
  assert.deepEqual(decide([], 250), { paths: 250, reason: 'too many paths (250)' });
  const { outputs, summary } = plan({ HEAD_MESSAGE: selected([], 250) });
  assert.equal(outputs.related, '');
  assert.match(summary, /\nSelection: affected — full suite: too many paths \(250\)\n$/);
  assert.deepEqual(decide(['M\tsrc/shared/a.ts'], 2), { paths: 2, reason: 'the path list is incomplete (1 of 2 read)' });
  assert.deepEqual(decide(['M src/shared/a.ts']), { paths: 1, reason: 'the path list is incomplete (1 of 1 read)' });
  assert.deepEqual(decide(['R100\tsrc/shared/a.test.ts']), { paths: 1, reason: 'the path list is incomplete (1 of 1 read)' });
  assert.deepEqual(affected('ci-gate: 0123abcd affected\n\nSelection: affected'), { paths: null, reason: 'no Affected-Count: trailer' });
  // A change of no paths (the tested commit is the merge base) runs no suite.
  assert.deepEqual(decide([]), { paths: 0, related: [] });
  assert.match(plan({ HEAD_MESSAGE: selected([]) }).summary, /\nSelection: affected — 0 paths, unit runs vitest related\n$/);
});

test('a change under a tree a suite reads without importing adds that suite to the related list', () => {
  assert.deepEqual(decide(['M\tsrc/engine-host/fs/watcher.ts']).related, [
    'src/engine-host/fs/watcher.ts', 'test/support/read-only-guard.test.ts', 'test/artifacts/one-schema.test.ts', 'src/engine-host/bundle-guard.test.ts', 'src/preload/bundle.test.ts',
    'src/engine-host/documents/sigkill.test.ts', 'src/engine-host/documents/retention-crash.test.ts',
  ]);
  assert.deepEqual(decide(['M\tapps/desk-hub/src/objects/machine.ts']).related, [
    'apps/desk-hub/src/objects/machine.ts', 'apps/desk-hub/test/support/local.ts', 'apps/desk-hub/test/support/hub.ts', 'apps/desk-hub/test/fake-machine/command.test.ts', 'apps/desk-hub/test/stream-close.test.ts',
  ]);
  assert.ok(decide(['M\tsrc/artifacts/design/editor/BoardList.tsx']).related.includes('test/react-compiler.test.ts'));
  assert.ok(!decide(['M\tsrc/artifacts/design/editor/Board.tsx']).related.includes('test/react-compiler.test.ts'));
  assert.deepEqual(decide(['M\tapps/desk-web/src/sw/handlers.ts']).related, ['apps/desk-web/src/sw/handlers.ts', 'apps/desk-web/src/sw/sw-imports.test.ts']);
});

// The lists name files and directories of this tree: a reader moved or renamed must move here with it.
test('every source reader, reader tree and data directory the selection names exists', () => {
  for (const { trees, suites } of SOURCE_READERS) for (const path of [...trees, ...suites]) assert.ok(existsSync(join(root, path)), path);
  for (const dir of READ_AS_DATA) assert.ok(existsSync(join(root, dir)), dir);
});

test('a Selection: trailer other than affected is refused', () => {
  const { status, stderr } = refusal({ HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit\nSelection: all' });
  assert.equal(status, 1);
  assert.equal(stderr, 'gate-plan: no such selection: all (affected, through ci-gate.sh --affected)\n');
});

// The plan's two outputs reach both unit jobs' test steps, which run unit-related.mjs only when given a list.
test("gate.yml passes the plan's selection to the unit and unit:darwin test steps", () => {
  const workflow = readWorkflow();
  assert.match(workflow, /\n {6}selection: \$\{\{ steps\.plan\.outputs\.selection \}\}\n {6}related: \$\{\{ steps\.plan\.outputs\.related \}\}\n/);
  for (const job of ['unit', 'unit-darwin']) {
    const body = new RegExp(`\\n {2}${job}:\\n((?: {4}.*\\n|\\n)*?)(?= {2}\\S|$)`).exec(workflow)[1];
    assert.match(body, /\n {10}UNIT_RELATED: \$\{\{ needs\.plan\.outputs\.related \}\}\n/, job);
    assert.match(body, /\n {10}if \[\[ -n \$UNIT_RELATED \]\]; then\n {12}.*node \.github\/scripts\/unit-related\.mjs /, job);
  }
});

// No suite reads docs/ but evidence/p1-e8 (gate-affected.mjs, UNREAD): a docs path counts for nothing, so a docs-only
// change runs no suite, and docs beside source select as the source alone would.
test("a path under docs/ but evidence/p1-e8 counts for nothing: docs alone run no suite, docs beside source don't widen it", () => {
  // The rest of evidence too: r3-labelled-set writes p4-b4 and reads none of it.
  const docs = [
    'M\tdocs/charter.md', 'A\tdocs/doperpowers/plans/2026-10-21-x.md', 'D\tdocs/doperpowers/ledgers/old.md', 'R100\tdocs/a.md\tdocs/doperpowers/b.md', 'M\tdocs/tech-debt-tracker.md',
    'M\tdocs/doperpowers/evidence/p4-b4/r3-misses.json', 'A\tdocs/doperpowers/evidence/p4-x/shot.png',
  ];
  assert.deepEqual(decide(docs), { paths: 7, related: [] });
  const { outputs, summary } = plan({ HEAD_MESSAGE: selected(docs) });
  assert.equal(outputs.related, '[]');
  assert.match(summary, /\nSelection: affected — 7 paths, unit runs vitest related\n$/);
  assert.deepEqual(decide([...docs, 'M\tapps/desk-web/src/views/org/OrgView.tsx']), { paths: 8, related: ['apps/desk-web/src/views/org/OrgView.tsx'] });
  assert.deepEqual(decide(['M\tdocs/charter.md', 'M\tsrc/shared/sessions/model-label.ts']), { ...decide(['M\tsrc/shared/sessions/model-label.ts']), paths: 2 });
  // The evidence cli.test.ts reads is data: a path under p1-e8 runs the full suite, beside docs or alone.
  const evidence = plan({ HEAD_MESSAGE: selected([...docs, 'M\tdocs/doperpowers/evidence/p1-e8/g0-cli-probe.txt']) });
  assert.equal(evidence.outputs.related, '');
  assert.match(evidence.summary, /\nSelection: affected — full suite: read through fs, a glob or a query import \(docs\/doperpowers\/evidence\/p1-e8\/g0-cli-probe.txt\)\n$/);
});

// The pool runs the whole unit suite as UNIT_SHARDS jobs, each with its --shard and its JUnit artifact's suffix, which
// ci-kit's collector reads as one `unit` report; vitest's related mode, and a runner off the pool, keep the one job.
test('on the pool the whole unit suite runs in shards; related mode and the other runners keep one unit job', () => {
  const shards = (env) => JSON.parse(plan(env).outputs.unit_shards);
  const sharded = shards({ HEAD_MESSAGE: 'ci-gate: 0123abcd\n\nGates: static,unit,probes\nClass1a: pool' });
  const n = sharded.length;
  assert.ok(n > 1);
  assert.deepEqual(sharded, Array.from({ length: n }, (_, i) => ({ shard: `${i + 1}/${n}`, slug: `-${i + 1}of${n}` })));
  const one = [{ shard: '', slug: '' }];
  for (const class1a of ['linux', 'macos']) assert.deepEqual(shards({ HEAD_MESSAGE: `ci-gate: 0123abcd\n\nGates: unit\nClass1a: ${class1a}` }), one, class1a);
  assert.deepEqual(shards({ HEAD_MESSAGE: selected(['M\tsrc/shared/a.ts']) }), one);
  // A selected run that falls back to the whole suite runs it in shards, as any whole-suite run on the pool does.
  assert.deepEqual(shards({ HEAD_MESSAGE: selected(['M\tpnpm-lock.yaml']) }), sharded);
});

test("gate.yml runs the unit job over the plan's shards: its name, its --shard (beside the module cache) and its artifact's name", () => {
  const workflow = readWorkflow();
  assert.match(workflow, /\n {6}unit_shards: \$\{\{ steps\.plan\.outputs\.unit_shards \}\}\n/);
  const body = /\n {2}unit:\n((?: {4}.*\n|\n)*?)(?= {2}\S|$)/.exec(workflow)[1];
  assert.match(body, /^ {4}name: \$\{\{ matrix\.shard && format\('unit \{0\}', matrix\.shard\) \|\| 'unit' \}\}\n/);
  assert.match(body, /\n {8}include: \$\{\{ fromJSON\(needs\.plan\.outputs\.unit_shards\) \}\}\n/);
  assert.match(body, /\n {10}SHARD: \$\{\{ matrix\.shard \}\}\n/);
  assert.match(body, /pnpm test --maxWorkers="\$cores" --fsModuleCache \$\{SHARD:\+--shard="\$SHARD"\}\n/);
  assert.match(body, /\n {10}name: test-results-unit\$\{\{ matrix\.slug \}\}-\$\{\{ github\.run_attempt \}\}\n/);
});
