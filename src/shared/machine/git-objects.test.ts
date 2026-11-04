// HEAD's top-level files read from the object store directly (P5 O7 M9, round 2): each answer is held against
// `git ls-tree -z HEAD` over real repositories, loose and packed (offset and reference deltas), SHA-1 and SHA-256, refs
// loose and packed, a detached and an unborn HEAD, and objects borrowed through alternates.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isolatedGitEnv } from '../../../test/support/git-env';
import { headTreeFiles } from './git-objects';
import { discoverRepo, guardedFiles, SetupReadRefused, type GitFiles } from './git-reads';

let home: string;
let files: GitFiles;

const git = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], { env: isolatedGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
/** What `ls-tree` lists of HEAD's regular top-level files. */
const lsTree = (directory: string) =>
  git(directory, 'ls-tree', '-z', 'HEAD')
    .split('\0')
    .map((entry) => /^(?:100644|100755) blob ([0-9a-f]+)\t(.+)$/s.exec(entry))
    .filter((match) => match !== null)
    .map((match) => ({ name: match[2], id: match[1] }));
/** How many trees the checkout's one pack stores as deltas (`verify-pack` gives a delta's depth and base). */
const deltaTrees = (path: string) => {
  const pack = join(path, '.git/objects/pack');
  const idx = readdirSync(pack).find((name) => name.endsWith('.idx'))!;
  return git(path, 'verify-pack', '-v', join(pack, idx)).split('\n').filter((line) => / tree /.test(line) && line.trim().split(/\s+/).length === 7).length;
};
const headOf = async (directory: string) => headTreeFiles((await discoverRepo(directory, files))!, files);

/** A checkout with history enough that its trees are stored as deltas once packed. */
function checkout(path: string, init: string[] = []): string {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main', ...init);
  for (let i = 0; i < 40; i++) writeFileSync(join(path, `file-${String(i).padStart(2, '0')}.txt`), `file ${i}\n`);
  mkdirSync(join(path, 'dir'));
  writeFileSync(join(path, 'dir/inner.txt'), 'inner\n');
  writeFileSync(join(path, 'run.sh'), '#!/bin/sh\n');
  chmodSync(join(path, 'run.sh'), 0o755);
  symlinkSync('README.md', join(path, 'link'));
  writeFileSync(join(path, 'README.md'), 'v0\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'v0');
  for (let i = 1; i <= 12; i++) {
    writeFileSync(join(path, 'README.md'), `v${i}\n`);
    git(path, 'commit', '-q', '-am', `v${i}`);
  }
  return path;
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'git-objects-')));
  files = guardedFiles({ home, platform: 'darwin' }, () => false);
  for (const dir of ['Documents', 'Developer']) mkdirSync(join(home, dir));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('HEAD’s top-level files, read from the object store', () => {
  it('as `ls-tree` lists them, loose, packed with offset deltas and packed with reference deltas', async () => {
    const path = checkout(join(home, 'Developer/repo'));
    const expected = lsTree(path);
    expect(expected.map((file) => file.name)).toContain('run.sh');
    expect(await headOf(path)).toEqual(expected);
    git(path, 'repack', '-adq', '--depth=50', '--window=50');
    git(path, 'pack-refs', '--all');
    expect(deltaTrees(path)).toBeGreaterThan(0);
    expect(await headOf(path)).toEqual(expected);
    git(path, '-c', 'repack.useDeltaBaseOffset=false', 'repack', '-adfq', '--depth=50', '--window=50');
    expect(deltaTrees(path)).toBeGreaterThan(0);
    expect(await headOf(path)).toEqual(expected);
  });

  it('as `ls-tree` lists them in a SHA-256 repository, at a detached HEAD, and none at an unborn one', async () => {
    const sha256 = checkout(join(home, 'Developer/sha256'), ['--object-format=sha256']);
    expect(await headOf(sha256)).toEqual(lsTree(sha256));
    git(sha256, 'repack', '-adq');
    expect(await headOf(sha256)).toEqual(lsTree(sha256));
    const path = checkout(join(home, 'Developer/detached'));
    git(path, 'checkout', '-q', '--detach', 'HEAD~3');
    expect(await headOf(path)).toEqual(lsTree(path));
    mkdirSync(join(home, 'Developer/unborn'));
    git(join(home, 'Developer/unborn'), 'init', '-q');
    expect(await headOf(join(home, 'Developer/unborn'))).toBeNull();
  });

  it('through alternates, each followed by the walk', async () => {
    const source = checkout(join(home, 'Developer/source'));
    git(source, 'repack', '-adq');
    git(home, 'clone', '-q', '--shared', source, join(home, 'Developer/borrower'));
    expect(await headOf(join(home, 'Developer/borrower'))).toEqual(lsTree(join(home, 'Developer/borrower')));
    const hidden = checkout(join(home, 'Documents/hidden'));
    git(home, 'clone', '-q', '--shared', hidden, join(home, 'Developer/hidden-borrower'));
    await expect(headOf(join(home, 'Developer/hidden-borrower'))).rejects.toBeInstanceOf(SetupReadRefused);
  });
});
