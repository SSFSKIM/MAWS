// node --test .github/scripts/maws-app-tree.test.mjs (from anywhere; needs git, tar and python3). maws-app-tree.sh, the
// filter that turns one MAWS commit into the tree SSFSKIM/maws-app runs CI on (docs/doperpowers/specs in ci-kit,
// 2026-10-26-maws-hosted-mac-design.md, What the filter leaves out): first on a small repository built here, which
// carries one of each kind of path the filter removes, keeps or rewrites; then on this checkout's own HEAD, the tree a
// request of this commit would publish.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const filter = join(root, '.github/scripts/maws-app-tree.sh');

const ADDRESSES = ['supremekim17@gmail.com', 'supremekim17@icloud.com', 'makeworth17@gmail.com', 'haegi236@gmail.com'];

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const run = (gitDir, sha, out) => spawnSync('bash', [filter, gitDir, sha, out], { encoding: 'utf8' });

function exported(gitDir, sha, out) {
  const r = run(gitDir, sha, out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'v2\n');
  return out;
}

// Every file under dir, relative and sorted.
function files(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (lstatSync(p).isDirectory()) walk(p);
      else found.push(relative(dir, p));
    }
  };
  walk(dir);
  return found.sort();
}

// The tree id a request of dir would carry: the whole directory, ignored paths included (MAWS tracks files its own
// .gitignore matches, and the filter keeps them), as the waiter and the architect's recompute add it.
function treeId(t, dir) {
  const gitDir = scratch(t, 'maws-app-tree-git-');
  const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: dir };
  const r = (...args) => spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { env, encoding: 'utf8' });
  assert.equal(r('init', '-q').status, 0);
  const add = r('add', '-A', '--force', '.');
  assert.equal(add.status, 0, add.stderr);
  const tree = r('write-tree');
  assert.equal(tree.status, 0, tree.stderr);
  return tree.stdout.trim();
}

// A repository with one of each kind of path: what the filter removes, the one evidence file it keeps, the overlay, the
// addresses in text with CRLF endings and in a binary file, an ignored file MAWS tracks, an executable.
function fixtureRepo(t) {
  const dir = scratch(t, 'maws-app-tree-src-');
  const put = (path, content, mode) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    if (mode) chmodSync(join(dir, path), mode);
  };
  put('README.md', '# MAWS\n');
  put('.gitignore', 'out/\n');
  put('.smns', '{"project":"x"}\n');
  put('.github/workflows/gate.yml', 'name: gate\n');
  put('.github/workflows/branch-added.yml', 'name: added\n');
  put('.github/maws-app/README.md', '# maws-app\n\nThe overlay.\n');
  put('.github/maws-app/hosted-mac.yml', 'name: hosted-mac\n');
  put('.github/maws-app/gitleaks.toml', 'title = "x"\n');
  put('.github/ci-kit.yml', 'version: 1\n');
  put('.github/ci-setup.sh', '#!/usr/bin/env bash\n', 0o755);
  put('research/p3-bundle.md', 'quoted\n');
  put('docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt', 'probe\n');
  put('docs/doperpowers/evidence/p1-e8/other.txt', 'other\n');
  put('docs/doperpowers/evidence/c12/shot.png', 'png');
  put('spikes/p4-parity-bench/record-1/sitting.json', '{}\n');
  put('spikes/p4-parity-bench/recorder.ts', 'export {};\n');
  put('mockups/shots/a.png', 'png');
  put('mockups/desk/a.png', 'png');
  put('mockups/desk/deep/b.png', 'png');
  put('mockups/desk/index.html', '<p>desk</p>\n');
  put('docs/charter.md', `owner ${ADDRESSES[0]}\r\nicloud ${ADDRESSES[1]}\r\ntests ${ADDRESSES[2]}, ${ADDRESSES[3]}\r\n`);
  put('fixtures/blob.bin', Buffer.concat([Buffer.from([0, 0xff, 0xfe]), Buffer.from(` ${ADDRESSES[0]} `), Buffer.from([0])]));
  put('scripts/run.sh', '#!/usr/bin/env bash\necho run\n', 0o755);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  put('out/kept.txt', 'tracked though ignored\n');
  git(dir, 'add', '--force', 'out/kept.txt');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'fixture');
  return { dir, gitDir: join(dir, '.git'), sha: git(dir, 'rev-parse', 'HEAD') };
}

test('the fixture: removes the denied paths, keeps the probe, writes the overlay to its places and nothing else', (t) => {
  const { gitDir, sha } = fixtureRepo(t);
  const out = exported(gitDir, sha, scratch(t, 'maws-app-tree-out-'));
  assert.deepEqual(files(out), [
    '.github/ci-kit.yml',
    '.github/ci-setup.sh',
    '.github/workflows/hosted-mac.yml',
    '.gitignore',
    'README.md',
    'docs/charter.md',
    'docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt',
    'fixtures/blob.bin',
    'mockups/desk/index.html',
    'out/kept.txt',
    'scripts/run.sh',
    'spikes/p4-parity-bench/recorder.ts',
  ]);
  assert.equal(readFileSync(join(out, 'README.md'), 'utf8'), '# maws-app\n\nThe overlay.\n');
  assert.equal(readFileSync(join(out, '.github/workflows/hosted-mac.yml'), 'utf8'), 'name: hosted-mac\n');
  assert.equal(readFileSync(join(out, 'docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt'), 'utf8'), 'probe\n');
  assert.ok(statSync(join(out, 'scripts/run.sh')).mode & 0o100, 'the executable bit is kept');
  assert.ok(!existsSync(join(out, '.github/maws-app')));
});

test('the fixture: the four addresses become placeholders, in text with its CRLF endings kept and in a binary file', (t) => {
  const { gitDir, sha } = fixtureRepo(t);
  const out = exported(gitDir, sha, scratch(t, 'maws-app-tree-out-'));
  assert.equal(
    readFileSync(join(out, 'docs/charter.md'), 'utf8'),
    'owner owner@example.com\r\nicloud owner@example.com\r\ntests test-account-1@example.com, test-account-2@example.com\r\n',
  );
  assert.deepEqual(readFileSync(join(out, 'fixtures/blob.bin')), Buffer.concat([Buffer.from([0, 0xff, 0xfe]), Buffer.from(' owner@example.com '), Buffer.from([0])]));
});

test('the fixture: two exports of one sha are byte-identical, the same tree id', (t) => {
  const { gitDir, sha } = fixtureRepo(t);
  const a = exported(gitDir, sha, scratch(t, 'maws-app-tree-a-'));
  const b = exported(gitDir, sha, join(scratch(t, 'maws-app-tree-b-'), 'not-yet-made'));
  assert.equal(treeId(t, a), treeId(t, b));
});

test('refuses an output directory that is not empty, and a commit without the overlay', (t) => {
  const { dir, gitDir, sha } = fixtureRepo(t);
  const full = scratch(t, 'maws-app-tree-full-');
  writeFileSync(join(full, 'x'), '');
  const refused = run(gitDir, sha, full);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /must be an empty directory/);

  git(dir, 'rm', '-q', '-r', '.github/maws-app');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'no overlay');
  const bare = run(gitDir, 'HEAD', scratch(t, 'maws-app-tree-out-'));
  assert.notEqual(bare.status, 0);
  assert.match(bare.stderr, /no overlay/);
});

// This checkout's HEAD: the tree its requests would publish (acceptance 6).
test("HEAD: what a request of this commit publishes", (t) => {
  const gitDir = git(root, 'rev-parse', '--absolute-git-dir');
  const sha = git(root, 'rev-parse', 'HEAD');
  const out = exported(gitDir, sha, scratch(t, 'maws-app-tree-head-'));
  const all = files(out);

  for (const denied of ['research/', '.smns', 'mockups/shots/', 'spikes/p4-parity-bench/record-', '.github/maws-app/']) {
    assert.deepEqual(all.filter((f) => f.startsWith(denied)), [], denied);
  }
  assert.deepEqual(all.filter((f) => f.startsWith('docs/doperpowers/evidence/')), ['docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt']);
  assert.deepEqual(all.filter((f) => f.startsWith('mockups/desk/') && /\.png$/i.test(f)), []);
  assert.deepEqual(all.filter((f) => f.startsWith('.github/workflows/')), ['.github/workflows/hosted-mac.yml']);

  assert.equal(readFileSync(join(out, 'README.md'), 'utf8'), git(root, 'show', `${sha}:.github/maws-app/README.md`) + '\n');
  const workflow = readFileSync(join(out, '.github/workflows/hosted-mac.yml'), 'utf8');
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /pull_request/);

  const needles = ADDRESSES.map((a) => Buffer.from(a));
  const leaks = all.filter((f) => {
    const bytes = readFileSync(join(out, f));
    return needles.some((n) => bytes.includes(n));
  });
  assert.deepEqual(leaks, []);

  const again = exported(gitDir, sha, scratch(t, 'maws-app-tree-head-'));
  assert.equal(treeId(t, out), treeId(t, again), 'two exports of HEAD are byte-identical');
});
