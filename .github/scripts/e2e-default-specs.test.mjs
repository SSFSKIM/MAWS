// node --test .github/scripts/e2e-default-specs.test.mjs (from the checkout's root, after pnpm install). The first case
// runs the derivation on this tree, its package.json and both Playwright configs, for the macOS lane's default set; when
// a spec or a group changes, its list is the one to update, after reading the derivation's notes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, '.github/scripts/e2e-default-specs.mjs');
const { defaultSpecs, readScript } = await import(script);
const { name: rootName, scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// The plan job's e2e matrix for a push on the macOS lane with no Gates: trailer, CLASS1_E2E read from the workflow.
function macosPlan() {
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  const class1 = /^ {2}CLASS1_E2E: >-\n((?: {4}.*\n)+)/m.exec(workflow)[1].replace(/\s+/g, ' ').trim();
  const dir = mkdtempSync(join(tmpdir(), 'maws-default-specs-'));
  try {
    const output = join(dir, 'output');
    execFileSync(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], {
      cwd: root,
      env: { ...process.env, EVENT: 'push', HEAD_MESSAGE: '', GATE_RUNNER: '', GATE_E2E_RUNNER: 'macos', CLASS1_E2E: class1, LINUX_E2E: '', LIBREOFFICE_E2E: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, 'summary') },
    });
    return /^e2e=(.*)$/m.exec(readFileSync(output, 'utf8'))[1];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("this tree: beside the macOS lane's other groups, default runs its own specs, read from the job's output", () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-default-specs-'));
  try {
    const stdout = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...process.env, E2E_PLAN: macosPlan(), GITHUB_STEP_SUMMARY: join(dir, 'summary') }, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(stdout.trim().split('\n'), [
      'e2e/agent-tools-live.spec.ts',
      'e2e/c11-live.spec.ts',
      'e2e/c11-shots.spec.ts',
      'e2e/c12-live.spec.ts',
      'e2e/c12-prerun.spec.ts',
      'e2e/c3-stall.spec.ts',
      'e2e/c7-shots.spec.ts',
      'e2e/code-tools-live.spec.ts',
      'e2e/composer-live.spec.ts',
      'e2e/connectors-soak.spec.ts',
      'e2e/dashboard-live.spec.ts',
      'e2e/dashboard-scale.spec.ts',
      'e2e/design-live.spec.ts',
      'e2e/design-scale.spec.ts',
      'e2e/design-systems-live.spec.ts',
      'e2e/document-live.spec.ts',
      'e2e/document-scale.spec.ts',
      'e2e/engine-replay.spec.ts',
      'e2e/fixture-safety.spec.ts',
      'e2e/library-live.spec.ts',
      'e2e/maws-tools-live.spec.ts',
      'e2e/p1-live-keep-quit.spec.ts',
      'e2e/p1-live.spec.ts',
      'e2e/palette.spec.ts',
      'e2e/plugins-library-live.spec.ts',
      'e2e/plugins-live.spec.ts',
      'e2e/presentations-live.spec.ts',
      'e2e/presentations-scale.spec.ts',
      'e2e/resume-picker.spec.ts',
      'e2e/send-to-live.spec.ts',
      'e2e/sessions-available-live.spec.ts',
      'e2e/sessions.spec.ts',
      'e2e/shell.spec.ts',
      'e2e/sigusr1.spec.ts',
      'e2e/smoke.spec.ts',
      'e2e/statusline.spec.ts',
      'e2e/supervisor-packaged.spec.ts',
      'e2e/to-human-live.spec.ts',
      'e2e/voice.spec.ts',
    ]);
    assert.match(readFileSync(join(dir, 'summary'), 'utf8'), /its own 39 of the bare set's 74 specs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every class-1 group's script on this tree has a shape the derivation reads", () => {
  for (const { group } of JSON.parse(macosPlan())) {
    assert.notEqual(readScript(scripts[group === 'default' ? 'e2e' : `e2e:${group}`], rootName), null, group);
  }
  assert.deepEqual(readScript(scripts['e2e:desk-web'], rootName), { elsewhere: 'desk-web' });
  assert.deepEqual(readScript(scripts['e2e:dashboard'], rootName), { env: { MAWS_HARNESS: '0' }, args: ['--config', 'playwright.dashboard.config.ts'] });
  assert.deepEqual(readScript(scripts['e2e:design'], rootName).args, ['e2e/design.spec.ts', 'e2e/design-comments.spec.ts', 'e2e/design-history.spec.ts', 'e2e/design-export.spec.ts']);
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
