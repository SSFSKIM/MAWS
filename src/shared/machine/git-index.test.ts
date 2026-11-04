// A checkout's top-level files read from its index (P5 O7 M9, round 3): each answer held against git's own over real
// repositories (index versions 2, 3 and 4, SHA-1 and SHA-256, a skipped hash), the entries git keeps out of a work
// tree left out, a split index and every malformed or oversized index answered null.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isolatedGitEnv } from '../../../test/support/git-env';
import { indexTopLevelFiles, parseIndex } from './git-index';
import { discoverRepo, guardedFiles, type GitFiles } from './git-reads';

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
const indexOf = async (directory: string) => indexTopLevelFiles((await discoverRepo(directory, files))!, files);
const blob = (directory: string, path: string) => git(directory, 'rev-parse', `:${path}`).trim();

/** A checkout with top-level files of each kind: plain, executable, a link, a folder, a name past ASCII, a long name. */
function checkout(path: string, init: string[] = []): string {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main', ...init);
  for (let i = 0; i < 12; i++) writeFileSync(join(path, `file-${String(i).padStart(2, '0')}.txt`), `file ${i}\n`);
  mkdirSync(join(path, 'dir'));
  writeFileSync(join(path, 'dir/inner.txt'), 'inner\n');
  writeFileSync(join(path, 'run.sh'), '#!/bin/sh\n');
  chmodSync(join(path, 'run.sh'), 0o755);
  symlinkSync('README.md', join(path, 'link'));
  writeFileSync(join(path, 'README.md'), 'v0\n');
  writeFileSync(join(path, 'café.md'), 'accent\n');
  writeFileSync(join(path, `${'a'.repeat(200)}.txt`), 'long\n'); // the next name strips over 127 bytes of it (v4's varint)
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'v0');
  return path;
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'git-index-')));
  files = guardedFiles({ home, platform: 'darwin' }, () => false);
  mkdirSync(join(home, 'Developer'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('a checkout’s top-level files, read from its index', () => {
  it('are HEAD’s for a clean checkout, in index versions 2, 3 and 4, SHA-1 and SHA-256, with a skipped hash', async () => {
    const path = checkout(join(home, 'Developer/repo'));
    expect(await indexOf(path)).toEqual(lsTree(path));
    for (const version of ['3', '4', '2']) {
      git(path, 'update-index', '--index-version', version);
      expect([version, await indexOf(path)]).toEqual([version, lsTree(path)]);
    }
    git(path, '-c', 'index.skipHash=true', 'update-index', '--index-version', '4');
    expect(readFileSync(join(path, '.git/index')).subarray(-20).every((byte) => byte === 0)).toBe(true);
    expect(await indexOf(path)).toEqual(lsTree(path));
    const sha256 = checkout(join(home, 'Developer/sha256'), ['--object-format=sha256']);
    expect(await indexOf(sha256)).toEqual(lsTree(sha256));
  });

  it('leave out what git keeps out of the work tree (skip-worktree, intent-to-add), and take a staged change', async () => {
    const path = checkout(join(home, 'Developer/repo'));
    git(path, 'update-index', '--skip-worktree', 'run.sh');
    writeFileSync(join(path, 'new.txt'), 'new\n');
    git(path, 'add', '-N', 'new.txt'); // an extended entry: the index is version 3 now
    expect(readFileSync(join(path, '.git/index')).readUInt32BE(4)).toBe(3);
    writeFileSync(join(path, 'README.md'), 'staged\n');
    git(path, 'add', 'README.md');
    const found = await indexOf(path);
    expect(found?.map((file) => file.name)).toEqual(lsTree(path).map((file) => file.name).filter((name) => name !== 'run.sh'));
    expect(found?.find((file) => file.name === 'README.md')?.id).toBe(blob(path, 'README.md')); // the staged blob, not HEAD's
  });

  it('answer only plain top-level names: an entry named `..` or `.` is none', () => {
    const entry = (name: string) => {
      const fixed = Buffer.alloc(62);
      fixed.writeUInt32BE(0o100644, 24);
      Buffer.from('ab'.repeat(20), 'hex').copy(fixed, 40);
      fixed.writeUInt16BE(name.length, 60);
      const length = (62 + name.length + 8) & ~7;
      return Buffer.concat([fixed, Buffer.from(name, 'latin1'), Buffer.alloc(length - 62 - name.length)]);
    };
    const index = (names: string[]) => {
      const header = Buffer.alloc(12);
      header.write('DIRC', 0, 'latin1');
      header.writeUInt32BE(2, 4);
      header.writeUInt32BE(names.length, 8);
      return Buffer.concat([header, ...names.map(entry), Buffer.alloc(20)]); // a skipped hash
    };
    expect(parseIndex(index(['..', '.', 'ok.txt']), 20)).toEqual([{ name: 'ok.txt', id: 'ab'.repeat(20) }]);
  });

  // round 4: v4's prefix compression can make names far longer than the file; a name past git's PATH_MAX, or all names
  // decoded past their budget, is null, counted before any is built or copied
  it('answer null for v4 names past a path’s bound or past the decoded budget, however small the file', () => {
    const v4 = (entries: { strip: number; suffix: string }[]) => {
      const parts = entries.map(({ strip, suffix }) => {
        const fixed = Buffer.alloc(62);
        fixed.writeUInt32BE(0o100644, 24);
        fixed.writeUInt16BE(Math.min(suffix.length, 0xfff), 60);
        return Buffer.concat([fixed, Buffer.from([strip]), Buffer.from(suffix, 'latin1'), Buffer.alloc(1)]); // a strip under 128: one byte
      });
      const header = Buffer.alloc(12);
      header.write('DIRC', 0, 'latin1');
      header.writeUInt32BE(4, 4);
      header.writeUInt32BE(entries.length, 8);
      return Buffer.concat([header, ...parts, Buffer.alloc(20)]); // a skipped hash
    };
    expect(parseIndex(v4([{ strip: 0, suffix: 'a' }, { strip: 0, suffix: 'b' }]), 20)).toEqual([{ name: 'a', id: '0'.repeat(40) }, { name: 'ab', id: '0'.repeat(40) }]);
    const growing = Array.from({ length: 5000 }, () => ({ strip: 0, suffix: 'x' })); // each name one byte longer: 5,000 bytes
    expect(v4(growing).length).toBeLessThan(400_000);
    expect(parseIndex(v4(growing), 20)).toBeNull();
    const repeated = [{ strip: 0, suffix: 'y'.repeat(4000) }, ...Array.from({ length: 4300 }, () => ({ strip: 0, suffix: '' }))]; // 17 MB decoded
    expect(v4(repeated).length).toBeLessThan(400_000);
    expect(parseIndex(v4(repeated), 20)).toBeNull();
  });

  it('skip an optional extension (upper case first) and answer null for a mandatory one git would not understand', () => {
    const empty = (signature: string) => {
      const header = Buffer.alloc(12);
      header.write('DIRC', 0, 'latin1');
      header.writeUInt32BE(2, 4);
      const extension = Buffer.alloc(8);
      extension.write(signature, 0, 'latin1');
      const body = Buffer.concat([header, extension]);
      return Buffer.concat([body, createHash('sha1').update(body).digest()]); // hashed correctly
    };
    expect(parseIndex(empty('ZZZZ'), 20)).toEqual([]);
    expect(parseIndex(empty('zzzz'), 20)).toBeNull();
    expect(parseIndex(empty('sdir'), 20)).toBeNull();
  });

  it('answer null for a split index, and for an index malformed or past its bounds', async () => {
    const path = checkout(join(home, 'Developer/repo'));
    const good = readFileSync(join(path, '.git/index'));
    git(path, 'update-index', '--split-index');
    expect(await indexOf(path)).toBeNull();
    expect(parseIndex(good, 20)).toEqual(lsTree(path));
    const rehashed = (bytes: Buffer) => Buffer.concat([bytes.subarray(0, -20), Buffer.alloc(20)]); // a skipped hash: no check
    const with32 = (offset: number, value: number) => {
      const bytes = Buffer.from(good);
      bytes.writeUInt32BE(value, offset);
      return rehashed(bytes);
    };
    expect(parseIndex(Buffer.concat([Buffer.from('DIRX'), good.subarray(4)]), 20)).toBeNull(); // the signature
    expect(parseIndex(with32(4, 5), 20)).toBeNull(); // an unknown version
    expect(parseIndex(with32(8, 1_000_001), 20)).toBeNull(); // a count past ENTRIES_MAX
    expect(parseIndex(with32(8, good.readUInt32BE(8) + 1), 20)).toBeNull(); // an entry the file does not hold
    const corrupt = Buffer.from(good);
    corrupt[20] ^= 1;
    expect(parseIndex(corrupt, 20)).toBeNull(); // the hash
    expect(parseIndex(rehashed(good.subarray(0, 100)), 20)).toBeNull(); // truncated
    expect(parseIndex(good.subarray(0, 8), 20)).toBeNull();
  });
});
