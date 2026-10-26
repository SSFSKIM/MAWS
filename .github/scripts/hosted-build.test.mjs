// Real helper and e2e-build subprocesses; only GitHub and electron-vite are replaced at their executable boundaries.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./hosted-build.mjs', import.meta.url));
const builder = fileURLToPath(new URL('../../scripts/e2e-build.sh', import.meta.url));
const recorded = JSON.parse(readFileSync(new URL('./fixtures/hosted-build/api.json', import.meta.url), 'utf8'));
const values = (file) => existsSync(file) ? Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])) : {};
const ok = (run) => assert.equal(run.status, 0, run.stderr + run.stdout);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-hosted-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ['scripts', 'bin', 'node_modules/.bin', 'temp']) mkdirSync(join(dir, path), { recursive: true });
  cpSync(builder, join(dir, 'scripts/e2e-build.sh'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'e2e:plain': 'scripts/e2e-build.sh plain && playwright test e2e/a.spec.ts', 'e2e:harness': 'scripts/e2e-build.sh harness && MAWS_HARNESS=1 playwright test e2e/b.spec.ts', 'e2e:unknown': 'pnpm build && playwright test' } }));
  writeFileSync(join(dir, 'node_modules/.bin/electron-vite'), '#!/bin/sh\necho "$MAWS_HARNESS $NODE_ENV $MAWS_BUILD_RENDERER" >>calls\nif [ "$FAIL_BUILD" = 1 ]; then exit 7; fi\nrm -rf out\nmkdir -p out/main out/renderer\necho "variant=$MAWS_HARNESS" >out/main/index.js\necho renderer >out/renderer/index.html\n', { mode: 0o755 });
  const git = (...args) => {
    const run = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    ok(run);
    return run.stdout.trim();
  };
  git('init', '-q'); git('add', 'package.json', 'scripts/e2e-build.sh'); git('commit', '-qm', 'source');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const state = join(dir, 'api.json');
  writeFileSync(join(dir, 'bin/gh'), `#!${process.execPath}
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.FAKE_API));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_API + '.calls', JSON.stringify(args) + '\\n');
const endpoint = args.find(s => s.startsWith('repos/'));
if (state.fail && endpoint.includes(state.fail)) { console.error('simulated API failure'); process.exit(1); }
const result = endpoint.includes('/actions/artifacts') ? state.pages : endpoint.includes('/actions/runs/') ? state.run : state.commit;
process.stdout.write(JSON.stringify(result));
`, { mode: 0o755 });
  const { run: runData, commit: commitData } = JSON.parse(JSON.stringify(recorded));
  commitData.tree.sha = tree;
  const artifact = (id = 31, extra = {}) => ({ ...recorded.artifact, id, name: `e2e-build-${tree}-plain`, expired: false, created_at: '2030-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', workflow_run: { ...recorded.artifact.workflow_run, id: runData.id, head_sha: runData.head_sha, head_branch: runData.head_branch }, ...extra });
  const setAPI = (extra = {}) => writeFileSync(state, JSON.stringify({ pages: [{ total_count: 0, artifacts: [] }], run: runData, commit: commitData, ...extra }));
  setAPI();
  const envFile = join(dir, 'github-env');
  const output = join(dir, 'github-output');
  const env = { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, FAKE_API: state, RUNNER_TEMP: join(dir, 'temp'), GITHUB_REPOSITORY: 'SSFSKIM/maws-app', GITHUB_ENV: envFile, GITHUB_OUTPUT: output, SCRIPT: 'e2e:plain' };
  return {
    dir, tree, git, artifact, setAPI, runData, commitData,
    command(mode, extra = {}) {
      writeFileSync(output, '');
      const run = spawnSync(process.execPath, [helper, mode], { cwd: dir, env: { ...env, ...values(envFile), ...extra }, encoding: 'utf8' });
      return { ...run, outputs: values(output), env: values(envFile) };
    },
    calls: () => existsSync(state + '.calls') ? readFileSync(state + '.calls', 'utf8').trim().split('\n').map(JSON.parse) : [],
    builds: () => existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : [],
  };
}

test('a miss builds once; same-tree re-requests and both variants have stable separate artifact identities', (t) => {
  const f = fixture(t);
  const first = f.command('prepare'); ok(first);
  assert.equal(first.outputs.name, `e2e-build-${f.tree}-plain`);
  assert.equal(first.outputs.variant, 'plain');
  assert.equal(first.outputs['artifact-id'], '');
  assert.equal(first.env.MAWS_E2E_BUILD_KEY, f.tree);
  const built = f.command('build'); ok(built);
  assert.equal(built.outputs.built, 'true');
  assert.deepEqual(f.builds(), ['0 production 1']);
  const restored = f.command('build'); ok(restored);
  assert.equal(restored.outputs.built, 'false');
  assert.match(restored.stdout, /e2e-build: out\/ \(plain\) restored from/);
  assert.equal(f.builds().length, 1);
  const oldSha = f.git('rev-parse', 'HEAD');
  f.git('commit', '--allow-empty', '-qm', 'different request trailers');
  assert.notEqual(f.git('rev-parse', 'HEAD'), oldSha);
  const again = f.command('prepare'); ok(again);
  assert.equal(again.outputs.name, first.outputs.name);
  const harness = f.command('prepare', { SCRIPT: 'e2e:harness' }); ok(harness);
  assert.equal(harness.outputs.name, `e2e-build-${f.tree}-harness`);
});

test('the newest unexpired exact-name artifact is admitted only after workflow, branch and commit-tree provenance', (t) => {
  const f = fixture(t);
  f.setAPI({ pages: [
    { total_count: 5, artifacts: [f.artifact(1), f.artifact(2, { name: 'wrong-name' }), f.artifact(3, { expired: true })] },
    { total_count: 5, artifacts: [f.artifact(4, { expires_at: '2020-01-01T00:00:00Z' }), f.artifact(5, { created_at: '2030-01-02T00:00:00Z' })] },
  ] });
  const result = f.command('prepare'); ok(result);
  assert.equal(result.outputs['artifact-id'], '5');
  assert.equal(result.outputs['run-id'], String(f.runData.id));
  assert.deepEqual(f.calls().map((args) => args.find((s) => s.startsWith('repos/'))), [
    'repos/SSFSKIM/maws-app/actions/artifacts', `repos/SSFSKIM/maws-app/actions/runs/${f.runData.id}`, `repos/SSFSKIM/maws-app/git/commits/${f.runData.head_sha}`,
  ]);
  assert.ok(f.calls()[0].includes('--paginate'));
  assert.ok(f.calls()[0].includes(`name=e2e-build-${f.tree}-plain`));
  assert.match(result.stdout, /provenance verified/);
});

for (const mismatch of ['workflow', 'branch', 'tree', 'missing-run']) {
  test(`a ${mismatch} provenance mismatch ignores the artifact and builds`, (t) => {
    const f = fixture(t);
    const artifact = f.artifact();
    if (mismatch === 'workflow') f.runData.path = '.github/workflows/another.yml';
    if (mismatch === 'branch') f.runData.head_branch = 'ci/untrusted/1';
    if (mismatch === 'tree') f.commitData.tree.sha = 'f'.repeat(40);
    if (mismatch === 'missing-run') artifact.workflow_run = null;
    f.setAPI({ pages: [{ total_count: 1, artifacts: [artifact] }] });
    const prepared = f.command('prepare'); ok(prepared);
    assert.equal(prepared.outputs['artifact-id'], '');
    assert.match(prepared.stdout, /ignored.*building/);
    const built = f.command('build'); ok(built);
    assert.equal(built.outputs.built, 'true');
  });
}

for (const endpoint of ['/artifacts', '/runs/', '/git/commits/']) {
  test(`an API failure at ${endpoint} is a cache miss, not a job failure`, (t) => {
    const f = fixture(t);
    f.setAPI({ pages: [{ total_count: 1, artifacts: [f.artifact()] }], fail: endpoint });
    const result = f.command('prepare'); ok(result);
    assert.equal(result.outputs['artifact-id'], '');
    assert.match(result.stdout, /lookup failed.*building/);
    ok(f.command('build'));
    assert.equal(f.builds().length, 1);
  });
}

for (const downloaded of ['valid', 'bad-digest', 'incomplete', 'failure']) {
  test(`${downloaded} downloads restore only intact builds and otherwise build locally`, (t) => {
    const f = fixture(t);
    const first = f.command('prepare'); ok(first); ok(f.command('build'));
    const saved = join(f.dir, 'saved');
    cpSync(first.outputs.entry, saved, { recursive: true });
    rmSync(first.outputs.entry, { recursive: true });
    rmSync(join(f.dir, 'out'), { recursive: true });
    const prepared = f.command('prepare'); ok(prepared);
    cpSync(saved, prepared.outputs.staging, { recursive: true });
    if (downloaded === 'bad-digest') writeFileSync(join(prepared.outputs.staging, 'digest'), 'bad\n');
    if (downloaded === 'incomplete') rmSync(join(prepared.outputs.staging, 'out'), { recursive: true });
    const result = f.command('build', { DOWNLOAD_OUTCOME: downloaded === 'failure' ? 'failure' : 'success' }); ok(result);
    assert.equal(result.outputs.built, String(downloaded !== 'valid'));
    assert.equal(f.builds().length, downloaded === 'valid' ? 1 : 2);
    assert.equal(readFileSync(join(f.dir, 'out/main/index.js'), 'utf8'), 'variant=0\n');
    assert.equal(existsSync(prepared.outputs.staging), false);
  });
}

test('an unreadable group variant fails before lookup, and a real build failure remains fatal', (t) => {
  const f = fixture(t);
  const unknown = f.command('prepare', { SCRIPT: 'e2e:unknown' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /variant.*e2e:unknown/);
  assert.deepEqual(f.calls(), []);
  ok(f.command('prepare'));
  const failed = f.command('build', { FAIL_BUILD: '1' });
  assert.equal(failed.status, 1);
  assert.equal(failed.outputs.built, undefined);
});

test('the workflow downloads only verified IDs, builds before uploading, and keeps artifact failures nonfatal', () => {
  const workflow = readFileSync(new URL('../maws-app/hosted-mac.yml', import.meta.url), 'utf8');
  const job = /\n {2}e2e:\n([\s\S]*?)\n {2}result:/.exec(workflow)[1];
  const steps = job.split(/\n {6}- /).slice(1);
  const download = steps.findIndex((step) => step.startsWith('id: build-download\n'));
  const build = steps.findIndex((step) => step.startsWith('id: build\n'));
  const upload = steps.findIndex((step) => step.startsWith('id: build-upload\n'));
  const tests = steps.findIndex((step) => step.startsWith('name: pnpm '));
  assert.ok(download >= 0 && download < build && build < upload && upload < tests);
  assert.match(job, /\n {4}permissions:\n {6}contents: read\n {6}actions: read\n/);
  for (const step of [steps[download], steps[upload]]) assert.match(step, /\n {8}continue-on-error: true\n/);
  assert.match(steps[download], /artifact-ids: \$\{\{ steps\.build-cache\.outputs\.artifact-id \}\}/);
  assert.match(steps[download], /run-id: \$\{\{ steps\.build-cache\.outputs\.run-id \}\}/);
  assert.match(steps[upload], /retention-days: 1$/m);
  assert.match(steps[upload], /include-hidden-files: true\n/);
  assert.doesNotMatch(steps[tests], /MAWS_E2E_BUILD_KEY=/, 'the test script must inherit the tree key, not overwrite it with its request SHA');
  const condition = /\n {8}if: (.*)/.exec(steps[upload])[1];
  const shouldUpload = Function('steps', `return (${condition});`);
  assert.equal(shouldUpload({ build: { outputs: { built: 'true' } } }), true);
  assert.equal(shouldUpload({ build: { outputs: { built: 'false' } } }), false);
  const notice = steps.find((step) => step.startsWith("if: steps.build-upload.outcome == 'failure'"));
  assert.match(notice ?? '', /upload failed/);
});

test('public builds reject inherited Vite injection and untracked dotenv inputs without printing their values', (t) => {
  const f = fixture(t);
  ok(f.command('prepare'));
  for (const name of ['VITE_TOKEN', 'MAIN_VITE_TOKEN', 'PRELOAD_VITE_TOKEN', 'RENDERER_VITE_TOKEN']) {
    const run = f.command('build', { [name]: 'private-value' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /public build.*environment/);
    assert.doesNotMatch(run.stderr + run.stdout, /private-value/);
  }
  writeFileSync(join(f.dir, '.env.production.local'), 'VITE_TOKEN=private-value\n');
  const run = f.command('build');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /untracked.*\.env.production.local/);
  assert.deepEqual(f.builds(), []);
});
