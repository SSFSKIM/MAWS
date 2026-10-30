import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findExecutable, ghProgram, gitProgram } from './which';

let root: string;
const dir = (name: string) => {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  return path;
};
const program = (directory: string, name: string, mode = 0o755) => {
  const path = join(directory, name);
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, mode);
  return path;
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-which-')));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scm program resolution on the remote environment PATH', () => {
  it('answers the first executable regular file across the entries, as the entry spells it', async () => {
    const first = dir('first');
    const second = dir('second');
    program(second, 'gh');
    program(dir('third'), 'gh');
    expect(await findExecutable('gh', `${first}:${second}:${join(root, 'third')}`)).toBe(join(second, 'gh'));
  });

  it('skips a file without the execute bit, a directory and a dangling link', async () => {
    const plain = dir('plain');
    program(plain, 'gh', 0o644);
    const directories = dir('dirs');
    mkdirSync(join(directories, 'gh'));
    const dangling = dir('dangling');
    symlinkSync(join(root, 'nowhere'), join(dangling, 'gh'));
    const last = dir('last');
    program(last, 'gh');
    expect(await findExecutable('gh', [plain, directories, dangling, last].join(':'))).toBe(join(last, 'gh'));
  });

  it('follows a symlink to an executable and answers the link (Homebrew installs links)', async () => {
    const cellar = dir('cellar');
    const target = program(cellar, 'gh-2.97.0');
    const bin = dir('bin');
    symlinkSync(target, join(bin, 'gh'));
    expect(await findExecutable('gh', bin)).toBe(join(bin, 'gh'));
  });

  it('never resolves through an empty or relative entry (the checkout must not choose the program)', async () => {
    const rel = relative(process.cwd(), dir('rel')); // resolvable from the process's cwd, as a shell would resolve it
    program(join(root, 'rel'), 'gh');
    expect(await findExecutable('gh', `:${rel}:./${rel}:.`)).toBeNull();
  });

  it('answers null without a PATH or without a match', async () => {
    expect(await findExecutable('gh', undefined)).toBeNull();
    expect(await findExecutable('gh', '')).toBeNull();
    expect(await findExecutable('gh', dir('empty'))).toBeNull();
  });

  it('git: MAWS_GIT overrides, else the PATH git, else Apple’s /usr/bin/git', async () => {
    const bin = dir('bin');
    const git = program(bin, 'git');
    expect(await gitProgram({ PATH: bin }, { MAWS_GIT: '/opt/test/git' })).toBe('/opt/test/git');
    expect(await gitProgram({ PATH: bin }, {})).toBe(git);
    expect(await gitProgram({ PATH: dir('empty') }, {})).toBe('/usr/bin/git');
    expect(await gitProgram({}, { MAWS_GIT: '' })).toBe('/usr/bin/git');
  });

  it('gh: MAWS_GH overrides, else the PATH gh, else missing (no fallback)', async () => {
    const bin = dir('bin');
    const gh = program(bin, 'gh');
    expect(await ghProgram({ PATH: bin }, { MAWS_GH: '/opt/test/gh' })).toBe('/opt/test/gh');
    expect(await ghProgram({ PATH: bin }, {})).toBe(gh);
    expect(await ghProgram({ PATH: dir('empty') }, {})).toBeNull();
    expect(await ghProgram({}, { MAWS_GH: '' })).toBeNull();
  });
});
