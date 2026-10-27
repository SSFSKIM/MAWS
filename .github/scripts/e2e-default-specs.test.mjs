// node --test .github/scripts/e2e-default-specs.test.mjs (from the checkout's root, after pnpm install). The first case
// runs the derivation on this tree, its package.json and both Playwright configs, for the macOS lane's default set; when
// a spec or a group changes, its list is the one to update, after reading the derivation's notes. The relaunch cases
// compare against that same derivation, so they need no list of their own.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, '.github/scripts/e2e-default-specs.mjs');
const { collected, defaultSpecs, listSelection, readScript } = await import(script);
const { name: rootName, scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
const class1 = /^ {2}CLASS1_E2E: >-\n((?: {4}.*\n)+)/m.exec(workflow)[1].replace(/\s+/g, ' ').trim();

// The plan job's outputs for a push on the macOS lane, CLASS1_E2E read from the workflow: the e2e matrix and the
// DefaultBeside groups, for a commit carrying `trailers` (none: the default set).
function plan(trailers = '') {
  const dir = mkdtempSync(join(tmpdir(), 'maws-default-specs-'));
  try {
    const output = join(dir, 'output');
    execFileSync(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], {
      cwd: root,
      env: { ...process.env, EVENT: 'push', HEAD_MESSAGE: trailers && `ci-gate: test\n\n${trailers}`, GATE_RUNNER: '', GATE_E2E_RUNNER: 'macos', CLASS1_E2E: class1, LINUX_E2E: '', LIBREOFFICE_E2E: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, 'summary') },
    });
    const outputs = readFileSync(output, 'utf8');
    return { e2e: /^e2e=(.*)$/m.exec(outputs)[1], defaultBeside: /^default_beside=(.*)$/m.exec(outputs)[1] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const macosPlan = () => plan().e2e;

// default's derivation step on a plan's outputs, as gate.yml runs it: the specs it prints and the summary it writes.
async function deriveStep({ e2e, defaultBeside }) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-default-specs-'));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...process.env, E2E_PLAN: e2e, DEFAULT_BESIDE: defaultBeside, GITHUB_STEP_SUMMARY: join(dir, 'summary') } });
    return { specs: stdout.trim().split('\n').filter(Boolean), summary: readFileSync(join(dir, 'summary'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The same derivation in this process, the plan's two outputs read as the step reads them, each selection listed once
// across the derivations that share it: what is compared is the groups each derivation subtracts, not two listings.
const listings = new Map();
const listOnce = (selection) => {
  const key = JSON.stringify(selection);
  if (!listings.has(key)) listings.set(key, listSelection(root, selection));
  return listings.get(key);
};
const derive = ({ e2e, defaultBeside }) => defaultSpecs({ scripts, rootName, groups: JSON.parse(e2e).map((entry) => entry.group), beside: JSON.parse(defaultBeside), list: listOnce, width: Math.max(2, Math.min(8, availableParallelism())) });

// Started together. The relaunch of default and two groups that ci-gate.sh's refused summary prints, with DefaultBeside
// naming the whole set, and without it (a hand-written relaunch), the latter through the step itself.
const relaunchGates = 'Gates: e2e:default,e2e:side,e2e:library\nRunner: macos';
const whole = derive(plan());
const relaunch = derive(plan(`${relaunchGates}\nDefaultBeside: ${class1}`));
const widened = deriveStep(plan(relaunchGates));
for (const derivation of [whole, relaunch, widened]) derivation.catch(() => {}); // a failure is the awaiting test's

test("this tree: beside the macOS lane's other groups, default runs its own specs", async () => {
  const { specs, total } = await whole;
  assert.equal(total, 95); // P5 OX1: e2e/cross-build.spec.ts, default's own (the two-build check, skipped without MAWS_CROSS_BUILD_E2E=1; the plan adds its group beside a peer a minor apart). P5 O1 M1: e2e/local-latency.spec.ts, default's own (the measured bench, skipped without MAWS_LOCAL_LATENCY_PERF=1). P4-AGG M5: e2e/discover-live.spec.ts, default's own (the opt-in live smoke, skipped without MAWS_LIVE_SMOKE=1). P4-AGG M1: e2e/discover.spec.ts and discover-connectors.spec.ts in e2e:discover. UX2-L: ux2-shell.spec.ts is part of default as well as the focused layout group. // P4-A2 G2.7: e2e/presentations-provisional-live.spec.ts, default's own (a live group); P4-A2 G2.6: presentations-provisional.spec.ts, design-provisional.spec.ts and dashboard-provisional.spec.ts in e2e:presentations, e2e:design and e2e:dashboard; P4-B1: e2e/document-margin.spec.ts in e2e:document-app; P4-B3: e2e/layout-transfer.spec.ts, default's own; P4-B2: e2e/presentations-ime.spec.ts, presentations-ime-live.spec.ts and (M0) presentations-drag.spec.ts in e2e:presentations
  assert.deepEqual(specs, [
    'e2e/agent-tools-live.spec.ts',
    'e2e/bench-edit-live.spec.ts',
    'e2e/c11-live.spec.ts',
    'e2e/c11-shots.spec.ts',
    'e2e/c12-live.spec.ts',
    'e2e/c12-prerun.spec.ts',
    'e2e/c3-stall.spec.ts',
    'e2e/c7-shots.spec.ts',
    'e2e/code-tools-live.spec.ts',
    'e2e/composer-live.spec.ts',
    'e2e/connectors-soak.spec.ts',
    'e2e/cross-build.spec.ts', // P5 OX1, the two-build check (e2e:cross-build, beside a peer)
    'e2e/dashboard-live-data.spec.ts',
    'e2e/dashboard-live.spec.ts',
    'e2e/dashboard-scale.spec.ts',
    'e2e/design-live.spec.ts',
    'e2e/design-scale.spec.ts',
    'e2e/design-systems-live.spec.ts',
    'e2e/discover-live.spec.ts', // P4-AGG M5, the opt-in live smoke
    'e2e/document-live.spec.ts',
    'e2e/document-provisional-live.spec.ts',
    'e2e/document-scale.spec.ts',
    'e2e/engine-replay.spec.ts',
    'e2e/fixture-safety.spec.ts',
    'e2e/layout-transfer.spec.ts', // P4-B3
    'e2e/library-live.spec.ts',
    'e2e/local-latency.spec.ts', // P5 O1 M1, the measured bench
    'e2e/maws-tools-live.spec.ts',
    'e2e/p1-live-keep-quit.spec.ts',
    'e2e/p1-live.spec.ts',
    'e2e/palette.spec.ts',
    'e2e/plugins-library-live.spec.ts',
    'e2e/plugins-live.spec.ts',
    'e2e/presentations-live.spec.ts',
    'e2e/presentations-provisional-live.spec.ts', // P4-A2 G2.7: its own live group
    'e2e/presentations-scale.spec.ts',
    'e2e/resume-picker.spec.ts',
    'e2e/sessions-available-live.spec.ts',
    'e2e/sessions.spec.ts',
    'e2e/shell.spec.ts',
    'e2e/sigusr1.spec.ts',
    'e2e/smoke.spec.ts',
    'e2e/statusline.spec.ts',
    'e2e/supervisor-packaged.spec.ts',
    'e2e/to-human-live.spec.ts',
    'e2e/ux1-sidebar.spec.ts',
    'e2e/ux2-shell.spec.ts',
    'e2e/voice.spec.ts',
  ]);
});

test("this tree: a relaunch of default and two groups, DefaultBeside naming the whole class-1 set, runs exactly the whole set's own specs", async () => {
  const [all, part] = await Promise.all([whole, relaunch]);
  assert.deepEqual([part.specs, part.total], [all.specs, all.total]);
  assert.ok(part.notes.some((note) => / \(named by DefaultBeside\) collects e2e\//.test(note)));
});

test("this tree: the same relaunch without DefaultBeside still widens default by the specs of the groups it leaves out, read from the job's output", async () => {
  const [all, part] = await Promise.all([whole, widened]);
  assert.match(part.summary, /^#### e2e:default: its own \d+ of the bare set's 95 specs, beside 2 other e2e groups \(/);
  assert.deepEqual(all.specs.filter((spec) => !part.specs.includes(spec)), []);
  assert.ok(part.specs.includes('e2e/artifacts-store.spec.ts'), 'e2e:artifacts, absent from the relaunch, leaves its spec to default');
  assert.ok(!part.specs.includes('e2e/side.spec.ts') && !part.specs.includes('e2e/library.spec.ts'));
});

test("gate.yml hands the plan's DefaultBeside groups to default's derivation", () => {
  assert.match(workflow, /\n {6}default_beside: \$\{\{ steps\.plan\.outputs\.default_beside \}\}\n/);
  assert.match(workflow, /\n {6}- if: matrix\.group == 'default'\n {8}env:\n {10}E2E_PLAN: \$\{\{ needs\.plan\.outputs\.e2e \}\}\n {10}DEFAULT_BESIDE: \$\{\{ needs\.plan\.outputs\.default_beside \}\}\n/);
});

test('this tree: a DefaultBeside name with no script makes default the bare set, with the warning', () => {
  const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...process.env, E2E_PLAN: '[{"group":"default"},{"group":"side"}]', DEFAULT_BESIDE: '["library","nope"]', GITHUB_STEP_SUMMARY: '' } });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^::warning title=e2e:default runs the bare set::no package\.json script e2e:nope \(named by DefaultBeside\)$/m);
});

test("every class-1 group's script on this tree has a shape the derivation reads", () => {
  for (const { group } of JSON.parse(macosPlan())) {
    assert.notEqual(readScript(scripts[group === 'default' ? 'e2e' : `e2e:${group}`], rootName), null, group);
  }
  assert.deepEqual(readScript(scripts['e2e:desk-web'], rootName), { elsewhere: 'desk-web' });
  assert.deepEqual(readScript(scripts['e2e:dashboard'], rootName), { env: { MAWS_HARNESS: '0' }, args: ['--config', 'playwright.dashboard.config.ts'] });
  assert.deepEqual(readScript(scripts['e2e:design'], rootName).args, ['e2e/design.spec.ts', 'e2e/design-comments.spec.ts', 'e2e/design-history.spec.ts', 'e2e/design-export.spec.ts', 'e2e/design-provisional.spec.ts']); // P4-A2 G2.6
});

test('this tree: default alone, or beside a group whose script it cannot read, runs the bare set', async () => {
  const alone = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...process.env, E2E_PLAN: '[{"group":"default"}]', GITHUB_STEP_SUMMARY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(alone, '');
  const grepped = { ...scripts, 'e2e:side': `${scripts['e2e:side']} --grep comment` };
  const result = await defaultSpecs({ scripts: grepped, rootName, groups: ['library', 'side'], list: () => assert.fail('nothing is listed once a script is unreadable') });
  assert.equal(result.doubt, true);
  assert.match(result.bare, /cannot read e2e:side's script shape/);
});

test('shapes it cannot read', () => {
  for (const shape of [
    'scripts/e2e-build.sh harness && MAWS_HARNESS=1 playwright test e2e/a.spec.ts --grep packaged:',
    'MAWS_E2E_EXECUTABLE=${MAWS_E2E_EXECUTABLE:-dist/MAWS} playwright test e2e/a.spec.ts',
    'cd apps/x && playwright test',
    'scripts/e2e-build.sh harness && playwright test e2e/a.spec.ts && playwright test e2e/b.spec.ts',
    "playwright test 'e2e/a.spec.ts'",
    'vitest run',
    `pnpm --filter ${rootName} e2e`,
    'playwright test --config',
  ]) {
    assert.equal(readScript(shape, rootName), null, shape);
  }
});

// A stand-in for Playwright's listing: each selection's specs by their argument or config, two tests each.
const listing = (collects) => async ({ env, args }) => new Map(collects({ env, args }).map((file) => [file, new Set([`${file} one`, `${file} two`])]));
const bareSet = ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts'];
const stub = listing(({ args }) => (args.length === 0 ? bareSet : bareSet.filter((file) => args.includes(file))));
const fixture = { e2e: 'playwright test', 'e2e:a': 'scripts/e2e-build.sh plain && playwright test e2e/a.spec.ts', 'e2e:b': 'scripts/e2e-build.sh harness && MAWS_HARNESS=1 playwright test e2e/b.spec.ts', 'e2e:web': 'pnpm --filter web e2e' };

test('beside other groups, default runs the specs none of them collects; a spec no group claims stays', async () => {
  assert.deepEqual((await defaultSpecs({ scripts: fixture, rootName, groups: ['a', 'web'], list: stub })).specs, ['e2e/b.spec.ts', 'e2e/c.spec.ts']);
  assert.deepEqual((await defaultSpecs({ scripts: fixture, rootName, groups: ['a', 'b'], list: stub })).specs, ['e2e/c.spec.ts']);
});

test('alone, or beside groups that claim nothing, default is the bare set', async () => {
  assert.match((await defaultSpecs({ scripts: fixture, rootName, groups: [], list: stub })).bare, /no other e2e group/);
  const besideWeb = await defaultSpecs({ scripts: fixture, rootName, groups: ['web'], list: stub });
  assert.match(besideWeb.bare, /collect none of its specs/);
  assert.equal(besideWeb.doubt, undefined);
});

test('every doubt falls back to the bare set, as a doubt', async () => {
  const unreadable = { ...fixture, 'e2e:b': 'scripts/e2e-build.sh harness && playwright test e2e/b.spec.ts --grep fast' };
  assert.match((await defaultSpecs({ scripts: unreadable, rootName, groups: ['a', 'b'], list: stub })).bare, /cannot read e2e:b's script shape/);
  assert.match((await defaultSpecs({ scripts: { ...fixture, e2e: 'playwright test e2e/a.spec.ts' }, rootName, groups: ['b'], list: stub })).bare, /cannot read the e2e script's shape/);
  const failing = async (selection) => {
    if (selection.args.includes('e2e/b.spec.ts')) throw new Error('playwright test --list e2e/b.spec.ts failed: boom');
    return stub(selection);
  };
  assert.match((await defaultSpecs({ scripts: fixture, rootName, groups: ['a', 'b'], list: failing })).bare, /failed: boom/);
  assert.match((await defaultSpecs({ scripts: { ...fixture, 'e2e:c': 'playwright test e2e/c.spec.ts' }, rootName, groups: ['a', 'b', 'c'], list: stub })).bare, /collect every spec/);
  // The narrowed run must collect exactly the own specs: here a filter that also catches a claimed spec.
  const loose = listing(({ args }) => (args.length === 1 ? bareSet.filter((file) => args.includes(file)) : bareSet));
  assert.match((await defaultSpecs({ scripts: fixture, rootName, groups: ['a'], list: loose })).bare, /does not collect exactly them/);
});

test("a test is its whole title array: ' › same' at the top and 'same' in an anonymous describe stay two", () => {
  // Playwright's duplicate-title check drops empty describe titles before joining, so it passes this pair.
  const report = {
    config: { rootDir: '/repo/e2e' },
    suites: [
      {
        title: 'a.spec.ts',
        file: 'a.spec.ts',
        specs: [{ title: ' › same' }],
        suites: [{ title: '', specs: [{ title: 'same' }] }],
      },
    ],
  };
  const files = collected(report, '/repo');
  assert.deepEqual([...files.keys()], ['e2e/a.spec.ts']);
  assert.equal(files.get('e2e/a.spec.ts').size, 2);
});

test('a spec its group lists only part of stays in default', async () => {
  const partial = async ({ env, args }) => {
    const specs = await stub({ env, args });
    if (env.MAWS_HARNESS === '1') specs.set('e2e/b.spec.ts', new Set(['e2e/b.spec.ts one']));
    return specs;
  };
  const result = await defaultSpecs({ scripts: fixture, rootName, groups: ['a', 'b'], list: partial });
  assert.deepEqual(result.specs, ['e2e/b.spec.ts', 'e2e/c.spec.ts']);
  assert.ok(result.notes.some((note) => /e2e\/b\.spec\.ts stays: the groups that collect it list 1 of its 2 tests/.test(note)));
});

test("DefaultBeside's groups count exactly as the run's own; default alone with them narrows too", async () => {
  const inRun = await defaultSpecs({ scripts: fixture, rootName, groups: ['a', 'b'], list: stub });
  assert.deepEqual(inRun.specs, ['e2e/c.spec.ts']);
  for (const [groups, beside] of [
    [['a'], ['b']],
    [['a'], ['a', 'b', 'web']],
    [[], ['b', 'default', 'a']],
  ]) {
    const result = await defaultSpecs({ scripts: fixture, rootName, groups, beside, list: stub });
    assert.deepEqual([result.specs, result.total], [inRun.specs, inRun.total], `${groups} beside ${beside}`);
  }
  assert.ok((await defaultSpecs({ scripts: fixture, rootName, groups: ['a'], beside: ['b'], list: stub })).notes.includes('e2e:b (named by DefaultBeside) collects e2e/b.spec.ts'));
  assert.match((await defaultSpecs({ scripts: fixture, rootName, groups: ['default'], beside: ['default'], list: stub })).bare, /no other e2e group/);
});

test('a DefaultBeside group with no script, or a script it cannot read, makes default the bare set, as a doubt', async () => {
  const unlisted = () => assert.fail('nothing is listed once a named group is unusable');
  const missing = await defaultSpecs({ scripts: fixture, rootName, groups: ['a'], beside: ['nope'], list: unlisted });
  assert.equal(missing.doubt, true);
  assert.match(missing.bare, /^no package\.json script e2e:nope \(named by DefaultBeside\)$/);
  const grepped = { ...fixture, 'e2e:b': `${fixture['e2e:b']} --grep fast` };
  const unreadable = await defaultSpecs({ scripts: grepped, rootName, groups: [], beside: ['b'], list: unlisted });
  assert.equal(unreadable.doubt, true);
  assert.match(unreadable.bare, /^cannot read e2e:b's script shape \(.*--grep fast\) \(named by DefaultBeside\)$/);
});
