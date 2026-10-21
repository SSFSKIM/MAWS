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
        GATE_RUNNER: '',
        GATE_E2E_RUNNER: '',
        CLASS1_E2E: '',
        LINUX_E2E: '',
        POOL_E2E: '',
        LIBREOFFICE_E2E: '',
        LIVE_E2E: '',
        LIVE_GUARD_E2E: '',
        MEASURED_E2E: '',
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
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  const groups = /^ {2}LIVE_E2E: (.*)$/m.exec(workflow)[1].split(/\s+/).filter(Boolean);
  const exported = [...workflow.matchAll(/^ {6}(MAWS_\w+): \$\{\{ needs\.plan\.outputs\.live == 'true' && '1' \|\| '' \}\}$/gm)].map((match) => match[1]);
  assert.deepEqual(exported.sort(), ['MAWS_LIBRARY_LIVE', 'MAWS_LIVE', 'MAWS_LIVE_DOCUMENT']);
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
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
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
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  assert.match(workflow, /\n {6}unit_shards: \$\{\{ steps\.plan\.outputs\.unit_shards \}\}\n/);
  const body = /\n {2}unit:\n((?: {4}.*\n|\n)*?)(?= {2}\S|$)/.exec(workflow)[1];
  assert.match(body, /^ {4}name: \$\{\{ matrix\.shard && format\('unit \{0\}', matrix\.shard\) \|\| 'unit' \}\}\n/);
  assert.match(body, /\n {8}include: \$\{\{ fromJSON\(needs\.plan\.outputs\.unit_shards\) \}\}\n/);
  assert.match(body, /\n {10}SHARD: \$\{\{ matrix\.shard \}\}\n/);
  assert.match(body, /pnpm test --maxWorkers="\$cores" --fsModuleCache \$\{SHARD:\+--shard="\$SHARD"\}\n/);
  assert.match(body, /\n {10}name: test-results-unit\$\{\{ matrix\.slug \}\}-\$\{\{ github\.run_attempt \}\}\n/);
});
