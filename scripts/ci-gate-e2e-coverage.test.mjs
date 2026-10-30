import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { advisoryTrailers, checkCoverage, discoverGroups, importGraph } from './ci-gate-e2e-coverage.mjs';
import { planOf } from '../.github/scripts/gate-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(import.meta.url)('typescript');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-e2e-coverage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), typeof text === 'string' ? text : JSON.stringify(text)); };
  put('package.json', { scripts: { e2e: 'playwright test', 'e2e:one': 'playwright test e2e/one.spec.ts' } });
  put('playwright.config.ts', "export default { testDir: 'e2e' }");
  put('tsconfig.json', { compilerOptions: { paths: { '@shared/*': ['./src/shared/*'] } } });
  return { dir, put };
}

test('walker follows runtime relative imports, aliases, dynamic literals and runnerImport; skips type-only edges', (t) => {
  const { dir, put } = fixture(t);
  put('e2e/one.spec.ts', `import './support'; import { value, type T } from '@shared/value';
    import('./dynamic.js'); runnerImport(resolve(import.meta.dirname, '../test/local.ts'));
    import type { T } from '../src/type'; import { type U } from '../src/inline-type';
    export type { T } from '../src/export-type'; export { type U } from '../src/export-inline-type';
    const comment = "import('../src/not-an-import')"; // import('../src/not-an-import')
  `);
  put('e2e/support.ts', "export * from '../src/relative';");
  put('src/relative.ts', "import '../e2e/support';");
  put('src/shared/value.ts', 'export const value = 1;');
  put('e2e/dynamic.ts', 'export const dynamic = 1;');
  put('test/local.ts', "export { endpoint } from '../src/endpoint';");
  put('src/endpoint/index.ts', 'export const endpoint = 1;');
  for (const name of ['type', 'inline-type', 'export-type', 'export-inline-type', 'not-an-import']) put(`src/${name}.ts`, 'export type T = string;');
  const graph = importGraph(dir, ts);
  assert.deepEqual([...graph.reachable(['e2e/one.spec.ts'])].sort(), ['e2e/dynamic.ts', 'e2e/one.spec.ts', 'e2e/support.ts', 'src/endpoint/index.ts', 'src/relative.ts', 'src/shared/value.ts', 'test/local.ts']);
});

test('workspace exports, subpaths and main resolve to repository sources without node_modules', (t) => {
  const { dir, put } = fixture(t);
  put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  put('e2e/one.spec.ts', "import 'protocol'; import 'hub/fake'; import '@local/legacy'; import 'protocol/private';");
  put('packages/protocol/package.json', { name: 'protocol', exports: { '.': { types: './types.d.ts', import: './src/index.ts' } } });
  put('packages/protocol/src/index.ts', "export * from './pairing';"); put('packages/protocol/src/pairing.ts', '');
  put('packages/protocol/types.d.ts', ''); put('packages/protocol/private.ts', '');
  put('packages/hub/package.json', { name: 'hub', exports: { './*': './src/*.ts' } }); put('packages/hub/src/fake.ts', '');
  put('packages/legacy/package.json', { name: '@local/legacy', main: './src/index.js' }); put('packages/legacy/src/index.ts', '');
  const reached = [...importGraph(dir, ts).reachable(['e2e/one.spec.ts'])].sort();
  assert.deepEqual(reached, ['e2e/one.spec.ts', 'packages/hub/src/fake.ts', 'packages/legacy/src/index.ts', 'packages/protocol/src/index.ts', 'packages/protocol/src/pairing.ts']);
});

test('URL href and fileURLToPath wrappers preserve literal loader edges', (t) => {
  const { dir, put } = fixture(t);
  put('e2e/one.spec.ts', `import(new URL('../src/href.ts', import.meta.url).href);
    runnerImport(fileURLToPath(new URL('../src/file-url.ts', import.meta.url)));
    runnerImport(url.fileURLToPath(new URL('../src/qualified.ts', import.meta.url)));
    import(new URL('../src/not-local.ts', remoteBase).href);`);
  for (const name of ['href', 'file-url', 'qualified', 'not-local']) put(`src/${name}.ts`, '');
  assert.deepEqual([...importGraph(dir, ts).reachable(['e2e/one.spec.ts'])].sort(), ['e2e/one.spec.ts', 'src/file-url.ts', 'src/href.ts', 'src/qualified.ts']);
});

test('real workspace pairing and fake-machine changes reach desk-web-hub', () => {
  const changed = ['apps/desk-hub/fake-machine/machine.ts', 'apps/org-protocol/src/pairing.ts'];
  const result = checkCoverage({ root, ts, gates: 'static', changed });
  assert.deepEqual(result.missing.find(({ group }) => group === 'e2e:desk-web-hub'), { group: 'e2e:desk-web-hub', paths: changed });
});

test('discovery derives default from other groups and workspace configs without executing them', (t) => {
  const { dir, put } = fixture(t);
  put('package.json', { scripts: { e2e: 'playwright test', 'e2e:one': 'playwright test e2e/one.spec.ts', 'e2e:web': 'pnpm --filter web e2e', 'e2e:unknown': 'custom-runner' } });
  put('e2e/one.spec.ts', ''); put('e2e/own.spec.ts', '');
  put('apps/web/package.json', { name: 'web', scripts: { e2e: 'pnpm build && playwright test --config playwright.hub.config.ts' } });
  put('apps/web/playwright.hub.config.ts', "throw new Error('never execute'); export default defineConfig({testDir: 'e2e-hub', testMatch: '**/cards.spec.ts'});");
  put('apps/web/e2e-hub/cards.spec.ts', ''); put('apps/web/e2e-hub/other.spec.ts', '');
  const { groups, notes } = discoverGroups(dir, ts);
  assert.deepEqual(Object.fromEntries(groups), { 'e2e:one': ['e2e/one.spec.ts'], 'e2e:web': ['apps/web/e2e-hub/cards.spec.ts'], 'e2e:default': ['e2e/own.spec.ts'] });
  assert.equal(notes.length, 1); assert.match(notes[0], /e2e:unknown/);
});

test('coverage warns once per omitted group with reaching paths and does not change the requested gates', (t) => {
  const { dir, put } = fixture(t);
  put('e2e/one.spec.ts', "import '../src/endpoint';"); put('src/endpoint.ts', '');
  const result = checkCoverage({ root: dir, ts, gates: 'static', changed: ['src/endpoint.ts', 'unrelated.ts'] });
  assert.deepEqual(result.missing, [{ group: 'e2e:one', paths: ['src/endpoint.ts'] }]);
  assert.deepEqual(checkCoverage({ root: dir, ts, gates: 'static,e2e:one', changed: ['src/endpoint.ts'] }).missing, []);
  assert.deepEqual(checkCoverage({ root: '/not/a/tree', ts: null, gates: 'all', changed: [] }).missing, []);
  assert.deepEqual(checkCoverage({ root: '/not/a/tree', ts: null, gates: '', changed: [] }).missing, []);
});

test('missing TypeScript produces a note, not a failed coverage check', () => {
  const result = checkCoverage({ root: '/not/a/tree', ts: null, gates: 'static', changed: ['src/a.ts'] });
  assert.deepEqual(result.missing, []);
  assert.match(result.notes[0], /TypeScript unavailable/);
});

test('an unavailable git diff warns but the dry CLI still exits successfully', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts/ci-gate-e2e-coverage.mjs'), '--git-dir', root, '--sha', 'not-a-commit', '--gates', 'static'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /coverage unavailable.*going ahead/);
  assert.match(result.stdout, /^E2E-Coverage: note:/);
});

test('the whole-set CLI needs neither a checkout nor dependencies and prints nothing', () => {
  for (const gates of ['all', '']) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/ci-gate-e2e-coverage.mjs'), '--git-dir', '/not/a/tree', '--sha', 'not-a-commit', '--gates', gates], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout + result.stderr, '');
  }
});

test('config selection applies testMatch, testIgnore and script environment without executing config code', (t) => {
  const { dir, put } = fixture(t);
  put('package.json', { scripts: { e2e: 'playwright test', 'e2e:harness': 'MAWS_HARNESS=1 playwright test' } });
  put('playwright.config.ts', `export default defineConfig({ testDir: 'e2e',
    testMatch: /\\.spec\\.ts$/, testIgnore: process.env.MAWS_HARNESS === '1' ? [] : ['harness.spec.ts'] });`);
  put('e2e/harness.spec.ts', ''); put('e2e/normal.spec.ts', ''); put('e2e/support.ts', '');
  const { groups, notes } = discoverGroups(dir, ts);
  assert.deepEqual(notes, []);
  assert.deepEqual(groups.get('e2e:harness'), ['e2e/harness.spec.ts', 'e2e/normal.spec.ts']);
  assert.deepEqual(groups.get('e2e:default'), []);
});

test('real endpoint diff reaches desk-web-hub through its Vite-loaded local endpoint harness', () => {
  const changed = ['src/endpoint/index.ts'];
  assert.match(readFileSync(join(root, 'apps/desk-web/test/local/endpoint.ts'), 'utf8'), /from '\.\.\/\.\.\/\.\.\/\.\.\/src\/endpoint'/);
  const missing = checkCoverage({ root, ts, gates: 'static', changed }).missing;
  assert.deepEqual(missing.find(({ group }) => group === 'e2e:desk-web-hub'), { group: 'e2e:desk-web-hub', paths: changed });
  assert.equal(checkCoverage({ root, ts, gates: 'static,e2e:desk-web-hub', changed }).missing.some(({ group }) => group === 'e2e:desk-web-hub'), false);
});

test('advisory budgets count UTF-8 bytes, cap long notes and many groups, and preserve ordinary lines', () => {
  assert.equal(advisoryTrailers(['missing e2e:one; specs reach src/one.ts']), 'E2E-Coverage: missing e2e:one; specs reach src/one.ts\n');
  for (const lines of [Array.from({ length: 100 }, (_, i) => `missing e2e:g${i}; specs reach a.ts`), Array(100).fill(`note: ${'한글'.repeat(1000)}`)]) {
    const rendered = advisoryTrailers(lines);
    assert.ok(Buffer.byteLength(rendered) <= 4096);
    assert.ok(rendered.trimEnd().split('\n').length <= 13);
    for (const line of rendered.trimEnd().split('\n')) assert.ok(Buffer.byteLength(line) <= 512);
    assert.doesNotMatch(rendered, /�/);
    assert.match(rendered, /advice truncated; see pre-push stderr for the full list\n$/);
  }
});

test('advisory trailers appear in the plan summary and log without altering jobs', () => {
  const env = { HEAD_MESSAGE: 'Gates: static' };
  const ordinary = planOf(env, {});
  const warning = 'missing e2e:desk-web-hub; specs reach src/endpoint/index.ts';
  const noted = planOf({ HEAD_MESSAGE: `Gates: static\nE2E-Coverage: ${warning}\nE2E-Coverage: note: skipped e2e:unknown` }, {});
  assert.deepEqual(noted.outputs, ordinary.outputs);
  assert.match(noted.summary, /missing e2e:desk-web-hub.*src\/endpoint\/index.ts/);
  assert.match(noted.stdout, /missing e2e:desk-web-hub/);
  assert.match(noted.summary, /skipped e2e:unknown/);
});

test('CLI uses the committed merge-base diff, not dirty files, and returns advisory trailers', (t) => {
  const { dir, put } = fixture(t);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'master'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
  put('e2e/one.spec.ts', "import '../src/endpoint'; import 'workspace-protocol';"); put('src/endpoint.ts', 'export const endpoint = 1;');
  put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  put('packages/protocol/package.json', { name: 'workspace-protocol', exports: './src/index.ts' });
  put('packages/protocol/src/index.ts', 'export const protocol = 1;');
  git('add', '.'); git('commit', '-m', 'base'); git('update-ref', 'refs/remotes/origin/master', 'HEAD');
  put('src/endpoint.ts', 'export const endpoint = 2;'); put('packages/protocol/src/index.ts', 'export const protocol = 2;');
  git('add', '.'); git('commit', '-m', 'endpoint and protocol');
  put('e2e/one.spec.ts', '');
  const result = spawnSync(process.execPath, [join(root, 'scripts/ci-gate-e2e-coverage.mjs'), '--git-dir', dir, '--sha', 'HEAD', '--gates', 'static'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /missing e2e:one.*src\/endpoint.ts/);
  assert.match(result.stdout, /^E2E-Coverage: missing e2e:one/m);
  assert.match(result.stderr, /missing e2e:one.*packages\/protocol\/src\/index.ts/);
});
