// node --test .github/scripts/hosted-mac.test.mjs (from anywhere; needs git, jq, curl, tar, python3 and the network to
// github.com for the pinned gitleaks). hosted-mac.sh, the waiter of one hosted e2e group (ci-kit's
// docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, The flow of one hosted group), against a local bare
// repository as SSFSKIM/maws-app (MAWS_APP_REMOTE, a file:// URL so that git honours --depth and --filter) and a small
// MAWS repository as the private run's checkout. This file plays the hosted run: it answers a request with the result
// commit maws-app's workflow writes, or with nothing.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const waiterScript = join(root, '.github/scripts/hosted-mac.sh');
const filter = join(root, '.github/scripts/maws-app-tree.sh');

// One download of the pinned gitleaks for the whole file.
const cache = mkdtempSync(join(tmpdir(), 'hosted-mac-gitleaks-'));
test.after(() => rmSync(cache, { recursive: true, force: true }));

const identity = Object.fromEntries(['AUTHOR', 'COMMITTER'].flatMap((role) => [[`GIT_${role}_NAME`, 'hosted test'], [`GIT_${role}_EMAIL`, 'hosted@test.invalid']]));
// The environment without the caller's git identity or git dir, so the waiter's own settings are what it runs on.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const gitIn = (cwd, env = {}) => (...args) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...cleanEnv(), ...identity, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const RUN = '7701';
const entry = (group = 'document-app') => JSON.stringify({ group, script: `e2e:${group}`, slug: group, build: false, libreoffice: false, measured: false, hosted: true, runner: '["self-hosted","ci-kit-pool","cpus-2"]', timeout: 100 });
const alnum = (n) => [...randomBytes(n)].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');

// maws-app (a bare repository with `main`) and a MAWS checkout whose HEAD is ci-gate's nonce commit over `requested`.
function fixture(t, { mainAge = 0, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hosted-mac-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'app.git');
  const appGit = gitIn(dir);
  appGit('init', '-q', '--bare', '-b', 'main', app);
  appGit('--git-dir', app, 'config', 'uploadpack.allowFilter', 'true');
  appGit('--git-dir', app, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  // main: a tree of its own, as the last landed tree published.
  const seed = join(dir, 'seed');
  mkdirSync(seed);
  writeFileSync(join(seed, 'README.md'), '# maws-app\n');
  writeFileSync(join(seed, 'kept.txt'), 'the same on both sides\n');
  const seedGit = gitIn(seed, mainAge ? { GIT_COMMITTER_DATE: `${Math.floor(Date.now() / 1000) - mainAge} +0000` } : {});
  seedGit('init', '-q', '-b', 'main');
  seedGit('add', '-A');
  seedGit('commit', '-q', '-m', 'main');
  seedGit('push', '-q', app, 'HEAD:refs/heads/main');
  // MAWS: the overlay the filter needs, a path it removes, an address it redacts, and a file main already holds.
  const maws = join(dir, 'maws');
  const put = (path, text) => {
    mkdirSync(dirname(join(maws, path)), { recursive: true });
    writeFileSync(join(maws, path), text);
  };
  put('.github/maws-app/README.md', '# maws-app\n\nThe public tree of MAWS, for its CI.\n');
  put('.github/maws-app/hosted-mac.yml', 'name: hosted-mac\non:\n  push:\n    branches: [ci/hosted/**]\njobs: {}\n');
  put('.github/workflows/gate.yml', 'name: gate\n');
  put('research/notes.md', 'not published\n');
  put('docs/owner.md', 'mail supremekim17@gmail.com\n');
  put('src/app.ts', 'export const app = 1;\n');
  put('kept.txt', 'the same on both sides\n');
  for (const [path, text] of Object.entries(files)) put(path, text);
  const mawsGit = gitIn(maws);
  mawsGit('init', '-q', '-b', 'work');
  mawsGit('add', '-A');
  mawsGit('commit', '-q', '-m', 'work');
  const requested = mawsGit('rev-parse', 'HEAD');
  const nonce = mawsGit('commit-tree', `${requested}^{tree}`, '-p', requested, '-m', `ci-gate: ${requested.slice(0, 8)}`, '-m', 'Nonce: 1-2\nGates: e2e:document-app\nRunner: macos\nLane: hosted');
  mawsGit('checkout', '-q', '--detach', nonce);
  const api = join(dir, 'api');
  return { dir, app, maws, requested, nonce, api, appGit: (...args) => appGit('--git-dir', app, ...args), mawsGit, runnerTemp: join(dir, 'runner-temp') };
}

const refsOf = (fx) => fx.appGit('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter(Boolean).map((line) => line.split(' ')).reduce((refs, [ref, sha]) => ({ ...refs, [ref]: sha }), {});
const trailersOf = (fx, sha) => {
  const message = fx.appGit('log', '-1', '--format=%B', sha);
  return Object.fromEntries(execFileSync('git', ['interpret-trailers', '--parse'], { input: message, encoding: 'utf8' }).trim().split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]));
};
const parentsOf = (fx, sha) => fx.appGit('log', '-1', '--format=%P', sha).split(' ').filter(Boolean);

// The result commit maws-app's `result` job writes: the request's tree, the request as its only parent.
function answer(fx, suffix, request, conclusion, body = '', parent = request) {
  const tree = fx.appGit('rev-parse', `${request}^{tree}`);
  const message = [`hosted: ${conclusion} e2e:document-app`, ...(body ? [body] : []), `Hosted-Conclusion: ${conclusion}\nHosted-Run: https://github.com/SSFSKIM/maws-app/actions/runs/4242/attempts/1`];
  const result = fx.appGit('commit-tree', tree, '-p', parent, ...message.flatMap((part) => ['-m', part]));
  fx.appGit('update-ref', `refs/heads/ci/result/${suffix}`, result);
  return result;
}

// The waiter (or its cleanup, `args`), run as the e2e-hosted job runs it. `onRequest(request, child)` runs once, when the
// request reaches maws-app.
async function waiter(fx, { attempt = 1, args = [], env = {}, onRequest, group = 'document-app' } = {}) {
  const suffix = `${RUN}-${attempt}-${group}`;
  const child = spawn('bash', [waiterScript, ...args], {
    cwd: fx.maws,
    env: {
      ...cleanEnv(),
      ENTRY: entry(group),
      EVIDENCE: 'false',
      MAWS_APP_DEPLOY_KEY: 'not a key: the remote is a file:// URL',
      MAWS_APP_REMOTE: `file://${fx.app}`,
      MAWS_APP_GITLEAKS_CACHE: cache,
      MAWS_HOSTED_POLL_SECONDS: '0.2',
      GITHUB_SHA: fx.nonce,
      GITHUB_RUN_ID: RUN,
      GITHUB_RUN_ATTEMPT: String(attempt),
      GITHUB_REPOSITORY: 'SSFSKIM/MAWS',
      GITHUB_API_URL: `file://${fx.api}`,
      GITHUB_TOKEN: 'a token the file:// API ignores',
      RUNNER_TEMP: fx.runnerTemp,
      ...env,
    },
  });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (out += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  let request;
  if (onRequest) {
    const ref = `refs/heads/ci/hosted/${suffix}`;
    for (let i = 0; i < 600 && child.exitCode === null; i++) {
      request = refsOf(fx)[ref];
      if (request) break;
      await sleep(100);
    }
    if (request) await onRequest(request, child);
  }
  const { code, signal } = await exited;
  return { code, signal, out, suffix, request };
}

const REQUEST_LINE = new RegExp(`^hosted: request ci/hosted/${RUN}-1-document-app ([0-9a-f]{40})$`, 'm');

test('success: the request is the filtered tree on main with the provenance trailers, the verdict is the result, and both refs go', async (t) => {
  const fx = fixture(t);
  const main = refsOf(fx)['refs/heads/main'];
  const started = Math.floor(Date.now() / 1000);
  const run = await waiter(fx, { onRequest: (request) => answer(fx, `${RUN}-1-document-app`, request, 'success', '  20 passed (2.2m)') });
  assert.equal(run.code, 0, run.out);
  const request = REQUEST_LINE.exec(run.out)?.[1];
  assert.equal(request, run.request, run.out);
  assert.match(run.out, new RegExp(`^hosted: https://github\\.com/SSFSKIM/maws-app/actions\\?query=branch%3Aci%2Fhosted%2F${RUN}-1-document-app$`, 'm'));
  assert.match(run.out, /^hosted: success https:\/\/github\.com\/SSFSKIM\/maws-app\/actions\/runs\/4242\/attempts\/1\n {2}20 passed \(2\.2m\)$/m);
  // The tree the architect recomputes: the filter's output, added with --force in a fresh repository.
  const out = join(fx.dir, 'recompute');
  execFileSync('bash', [filter, fx.mawsGit('rev-parse', '--absolute-git-dir'), fx.nonce, out], { stdio: 'pipe' });
  const fresh = join(fx.dir, 'fresh.git');
  const freshGit = gitIn(fx.dir, { GIT_DIR: fresh, GIT_WORK_TREE: out });
  freshGit('init', '-q');
  freshGit('add', '-A', '--force');
  assert.equal(fx.appGit('rev-parse', `${request}^{tree}`), freshGit('write-tree'));
  assert.equal(fx.appGit('cat-file', '-p', `${request}:docs/owner.md`), 'mail owner@example.com');
  assert.throws(() => fx.appGit('cat-file', '-e', `${request}:research/notes.md`));
  assert.deepEqual(parentsOf(fx, request), [main]);
  assert.equal(fx.appGit('log', '-1', '--format=%s', request), `MAWS ${fx.requested.slice(0, 12)} e2e:document-app`);
  const trailers = trailersOf(fx, request);
  const deadline = Number(trailers['Hosted-Deadline']);
  assert.ok(deadline >= started + 95 * 60 && deadline <= started + 95 * 60 + 60, `deadline ${deadline}`);
  assert.deepEqual(trailers, {
    'MAWS-Source': fx.nonce,
    'MAWS-Source-Tree': fx.mawsGit('rev-parse', `${fx.nonce}^{tree}`),
    'MAWS-Filter': 'v2',
    'MAWS-Run': `${RUN}/1`,
    'Hosted-Group': 'document-app',
    'Hosted-Script': 'e2e:document-app',
    'Hosted-Slug': 'document-app',
    'Hosted-LibreOffice': 'false',
    'Hosted-Evidence': 'false',
    'Hosted-Deadline': trailers['Hosted-Deadline'],
  });
  // Only what main lacks was scanned; both refs are gone and main is where it was (it is fresh).
  assert.match(run.out, /^hosted: secret scan of the 4 files this push adds$/m);
  assert.match(run.out, /^maws-app-scan: clean$/m);
  assert.deepEqual(refsOf(fx), { 'refs/heads/main': main });
  // The cleanup after a read result has nothing to do.
  const cleanup = await waiter(fx, { args: ['--cleanup'] });
  assert.deepEqual([cleanup.code, cleanup.out], [0, '']);
  assert.deepEqual(refsOf(fx), { 'refs/heads/main': main });
});

test('failure exits 1 with the failed tests in its log, and both refs go', async (t) => {
  const fx = fixture(t);
  const body = '  1) [electron] › e2e/document.spec.ts:119:3 › a broken assertion\n  1 failed\n  19 passed (2.4m)';
  const run = await waiter(fx, { onRequest: (request) => answer(fx, `${RUN}-1-document-app`, request, 'failure', body) });
  assert.equal(run.code, 1, run.out);
  assert.ok(run.out.includes(`hosted: failure https://github.com/SSFSKIM/maws-app/actions/runs/4242/attempts/1\n${body}\n`), run.out);
  assert.deepEqual(Object.keys(refsOf(fx)), ['refs/heads/main']);
});

test('a result whose parent is not the request is ignored; the waiter reads the one that is', async (t) => {
  const fx = fixture(t);
  const main = refsOf(fx)['refs/heads/main'];
  const run = await waiter(fx, {
    onRequest: async (request) => {
      answer(fx, `${RUN}-1-document-app`, request, 'success', '', main);
      await sleep(1000);
      answer(fx, `${RUN}-1-document-app`, request, 'failure', '  1 failed');
    },
  });
  assert.equal(run.code, 1, run.out);
  assert.match(run.out, new RegExp(`^hosted: ignoring ci/result/${RUN}-1-document-app at [0-9a-f]{12}: its parent is not this request$`, 'm'));
  assert.doesNotMatch(run.out, /^hosted: success/m);
  assert.match(run.out, /^hosted: failure /m);
});

test('past the deadline the waiter says so, pushes a cancel over its request and exits 1', async (t) => {
  const fx = fixture(t);
  const run = await waiter(fx, { env: { MAWS_HOSTED_DEADLINE_SECONDS: '3' } });
  assert.equal(run.code, 1, run.out);
  assert.match(run.out, /^hosted: no result by \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ: the hosted job was still queued or running at GitHub$/m);
  const request = REQUEST_LINE.exec(run.out)[1];
  const cancel = refsOf(fx)[`refs/heads/ci/hosted/${RUN}-1-document-app`];
  assert.notEqual(cancel, request);
  assert.deepEqual(parentsOf(fx, cancel), [request]);
  assert.equal(fx.appGit('rev-parse', `${cancel}^{tree}`), fx.appGit('rev-parse', `${request}^{tree}`));
  assert.ok(trailersOf(fx, cancel)['Hosted-Cancel'], 'a Hosted-Cancel trailer');
  // The cleanup after it does not cancel again; it takes the result the cancelled run writes, if it is there.
  answer(fx, `${RUN}-1-document-app`, request, 'cancelled');
  const cleanup = await waiter(fx, { args: ['--cleanup'] });
  assert.equal(cleanup.code, 0, cleanup.out);
  assert.equal(refsOf(fx)[`refs/heads/ci/hosted/${RUN}-1-document-app`], cancel);
  assert.equal(refsOf(fx)[`refs/heads/ci/result/${RUN}-1-document-app`], undefined);
});

test('--cleanup after a push with no result read pushes a cancel and deletes a result that is there; with nothing pushed it does nothing', async (t) => {
  const fx = fixture(t);
  const empty = await waiter(fx, { args: ['--cleanup'] });
  assert.deepEqual([empty.code, empty.out], [0, '']);
  // The private run is cancelled while the waiter waits: the runner stops its step, then runs the cleanup.
  const run = await waiter(fx, { onRequest: (request, child) => child.kill('SIGTERM') });
  assert.equal(run.signal, 'SIGTERM', run.out);
  answer(fx, `${RUN}-1-document-app`, run.request, 'cancelled');
  const cleanup = await waiter(fx, { args: ['--cleanup'] });
  assert.equal(cleanup.code, 0, cleanup.out);
  const refs = refsOf(fx);
  const cancel = refs[`refs/heads/ci/hosted/${RUN}-1-document-app`];
  assert.deepEqual(parentsOf(fx, cancel), [run.request]);
  assert.ok(trailersOf(fx, cancel)['Hosted-Cancel']);
  assert.equal(refs[`refs/heads/ci/result/${RUN}-1-document-app`], undefined);
  assert.match(cleanup.out, new RegExp(`^hosted: cancelled ci/hosted/${RUN}-1-document-app \\(`, 'm'));
});

test("an attempt-2 waiter cancels attempt 1's request, and no other run's or group's", async (t) => {
  const fx = fixture(t);
  const first = await waiter(fx, { onRequest: (request, child) => child.kill('SIGTERM') });
  // Requests of another group of this run and of another run, which attempt 2 of document-app must leave alone.
  for (const ref of [`ci/hosted/${RUN}-1-transcript`, `ci/hosted/${Number(RUN) + 1}-1-document-app`]) fx.appGit('update-ref', `refs/heads/${ref}`, first.request);
  const second = await waiter(fx, { attempt: 2, onRequest: (request) => answer(fx, `${RUN}-2-document-app`, request, 'success') });
  assert.equal(second.code, 0, second.out);
  const refs = refsOf(fx);
  const cancel = refs[`refs/heads/ci/hosted/${RUN}-1-document-app`];
  assert.deepEqual(parentsOf(fx, cancel), [first.request]);
  assert.match(trailersOf(fx, cancel)['Hosted-Cancel'], /attempt 2/);
  assert.equal(refs[`refs/heads/ci/hosted/${RUN}-1-transcript`], first.request);
  assert.equal(refs[`refs/heads/ci/hosted/${Number(RUN) + 1}-1-document-app`], first.request);
  assert.equal(refs[`refs/heads/ci/hosted/${RUN}-2-document-app`], undefined);
  // A third attempt finds attempt 1 already cancelled and pushes no second cancel.
  const third = await waiter(fx, { attempt: 3, onRequest: (request) => answer(fx, `${RUN}-3-document-app`, request, 'success') });
  assert.equal(third.code, 0, third.out);
  assert.equal(refsOf(fx)[`refs/heads/ci/hosted/${RUN}-1-document-app`], cancel);
});

test('a secret scan finding pushes nothing and exits 1, naming the file and rule but not the value', async (t) => {
  const token = ['gh', 'p_', alnum(36)].join('');
  const fx = fixture(t, { files: { 'src/config.ts': `export const config = {\n  token: '${token}',\n};\n` } });
  const before = refsOf(fx);
  const run = await waiter(fx);
  assert.equal(run.code, 1, run.out);
  assert.match(run.out, /^maws-app-scan: src\/config\.ts:2 github-pat$/m);
  assert.match(run.out, /^hosted: secret scan refused the push$/m);
  assert.ok(!run.out.includes(token), 'the value was printed');
  assert.doesNotMatch(run.out, /^hosted: request /m);
  assert.deepEqual(refsOf(fx), before);
  const cleanup = await waiter(fx, { args: ['--cleanup'] });
  assert.deepEqual([cleanup.code, cleanup.out], [0, '']);
  assert.deepEqual(refsOf(fx), before);
});

// MAWS's compare API answers whether the requested commit is on master, and the tree it has.
function compareAnswer(fx, status, tree = fx.mawsGit('rev-parse', `${fx.requested}^{tree}`)) {
  const path = join(fx.api, `repos/SSFSKIM/MAWS/compare/${fx.requested}...master`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ status, base_commit: { sha: fx.requested, commit: { tree: { sha: tree } } } }));
}

test("main moves to the request, by a fast-forward, only when it is a day old and the requested commit is on MAWS master", async (t) => {
  const day = 25 * 3600;
  const cases = [
    ['a day old, on master (ahead)', { mainAge: day }, 'ahead', undefined, true],
    ['a day old, master is the commit (identical)', { mainAge: day }, 'identical', undefined, true],
    ['a day old, the commit not on master', { mainAge: day }, 'behind', undefined, false],
    ['a day old, a commit of another tree', { mainAge: day }, 'ahead', '0'.repeat(40), false],
    ['a day old, no answer from the API', { mainAge: day }, null, undefined, false],
    ['fresh, on master', {}, 'ahead', undefined, false],
  ];
  for (const [name, options, status, tree, moves] of cases) {
    const fx = fixture(t, options);
    const main = refsOf(fx)['refs/heads/main'];
    if (status) compareAnswer(fx, status, tree);
    const run = await waiter(fx, { onRequest: (request) => answer(fx, `${RUN}-1-document-app`, request, 'success') });
    assert.equal(run.code, 0, `${name}: ${run.out}`);
    assert.equal(refsOf(fx)['refs/heads/main'], moves ? run.request : main, `${name}: ${run.out}`);
    if (moves) assert.deepEqual(parentsOf(fx, run.request), [main], name);
  }
  // A refused push (here a hook; on GitHub another waiter's fast-forward first, under main's ruleset) leaves main and the
  // run as they were.
  const fx = fixture(t, { mainAge: day });
  compareAnswer(fx, 'ahead');
  const hook = join(fx.app, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\nwhile read -r old new ref; do [ "$ref" != refs/heads/main ] || exit 1; done\n');
  chmodSync(hook, 0o755);
  const main = refsOf(fx)['refs/heads/main'];
  const run = await waiter(fx, { onRequest: (request) => answer(fx, `${RUN}-1-document-app`, request, 'success') });
  assert.equal(run.code, 0, run.out);
  assert.equal(refsOf(fx)['refs/heads/main'], main);
  assert.match(run.out, /^hosted: main not moved: /m);
});

test('an entry or a run the waiter cannot trust is refused before anything is pushed', async (t) => {
  const fx = fixture(t);
  const before = refsOf(fx);
  for (const [name, env] of [
    ['a group with a space', { ENTRY: JSON.stringify({ ...JSON.parse(entry()), group: 'a b' }) }],
    ['a script outside e2e', { ENTRY: JSON.stringify({ ...JSON.parse(entry()), script: 'build' }) }],
    ['no deploy key', { MAWS_APP_DEPLOY_KEY: '' }],
    ['an evidence flag that is no boolean', { EVIDENCE: 'yes' }],
  ]) {
    const run = await waiter(fx, { env });
    assert.equal(run.code, 1, `${name}: ${run.out}`);
    assert.match(run.out, /^hosted: /m, name);
    assert.deepEqual(refsOf(fx), before, name);
  }
  // The waiter's deadline is inside the job's timeout, which the plan sets at 100 minutes.
  assert.match(readFileSync(waiterScript, 'utf8'), /^DEADLINE_SECONDS=\$\{MAWS_HOSTED_DEADLINE_SECONDS:-\$\(\(95 \* 60\)\)\}$/m);
});
