// What a remote setup reads beyond its folder (P5 O7 M9, the task review's finding 3): git's pointers (a linked
// worktree's `gitdir`, the common dir, the main checkout, the common dir's other worktrees) and the trust read's files,
// each held to the protected rule before anything reads through it. Real git over a fake macOS home under a temp
// directory: no test reads a real protected folder.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Home } from './home-folders';
import { readable, setupReadsRefusal } from './setup-reads';

let home: string;
let mac: Home;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
const repo = (path: string) => {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  writeFileSync(join(path, 'README.md'), 'hello\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'one');
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'setup-reads-')));
  mac = { home, platform: 'darwin' };
  for (const dir of ['Documents', 'Developer']) mkdirSync(join(home, dir));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const none = () => false;
const documents = (folder: string) => folder === join(home, 'Documents');
const trust = { trustFiles: true };

describe('a setup’s reads past its folder', () => {
  it('are none to refuse for a plain folder and for a checkout whose git lives in it', async () => {
    mkdirSync(join(home, 'Developer/plain'));
    expect(await setupReadsRefusal(join(home, 'Developer/plain'), mac, none, trust)).toBeNull();
    repo(join(home, 'Developer/repo'));
    mkdirSync(join(home, 'Developer/repo/src'));
    expect(await setupReadsRefusal(join(home, 'Developer/repo'), mac, none, trust)).toBeNull();
    expect(await setupReadsRefusal(join(home, 'Developer/repo/src'), mac, none, trust)).toBeNull(); // its `.git` above it
  });

  it('refuse a linked worktree whose git dir and main checkout are in an unopened protected folder, until it is opened', async () => {
    repo(join(home, 'Documents/main'));
    git(join(home, 'Documents/main'), 'worktree', 'add', '-q', join(home, 'Developer/wt'));
    expect(await setupReadsRefusal(join(home, 'Developer/wt'), mac, none, trust)).toBe('protected');
    expect(await setupReadsRefusal(join(home, 'Developer/wt'), mac, documents, trust)).toBeNull();
  });

  it('refuse a checkout one of whose other worktrees is in an unopened protected folder (git lists it)', async () => {
    repo(join(home, 'Developer/repo'));
    git(join(home, 'Developer/repo'), 'worktree', 'add', '-q', join(home, 'Documents/wt'));
    expect(await setupReadsRefusal(join(home, 'Developer/repo'), mac, none, trust)).toBe('protected');
    expect(await setupReadsRefusal(join(home, 'Developer/repo'), mac, documents, trust)).toBeNull();
  });

  it('refuse a `.git` linked into an unopened protected folder', async () => {
    repo(join(home, 'Documents/real'));
    mkdirSync(join(home, 'Developer/front'));
    symlinkSync(join(home, 'Documents/real/.git'), join(home, 'Developer/front/.git'));
    expect(await setupReadsRefusal(join(home, 'Developer/front'), mac, none, trust)).toBe('protected');
  });

  it('refuse a trust file linked into an unopened protected folder for the trust read, not the registration', async () => {
    mkdirSync(join(home, 'Developer/proj/.claude'), { recursive: true });
    writeFileSync(join(home, 'Documents/mcp.json'), '{}');
    symlinkSync(join(home, 'Documents/mcp.json'), join(home, 'Developer/proj/.mcp.json'));
    expect(await setupReadsRefusal(join(home, 'Developer/proj'), mac, none, trust)).toBe('protected');
    expect(await setupReadsRefusal(join(home, 'Developer/proj'), mac, none, { trustFiles: false })).toBeNull();
    expect(await readable(join(home, 'Developer/proj/.mcp.json'), mac, none)).toBe(false);
    expect(await readable(join(home, 'Developer/proj/.mcp.json'), mac, documents)).toBe(true);
    expect(await readable(join(home, 'Developer/proj/.claude/settings.json'), mac, none)).toBe(true); // missing: nothing read
    // a `.claude` folder linked there too
    mkdirSync(join(home, 'Documents/claude'));
    mkdirSync(join(home, 'Developer/other'));
    symlinkSync(join(home, 'Documents/claude'), join(home, 'Developer/other/.claude'));
    expect(await setupReadsRefusal(join(home, 'Developer/other'), mac, none, trust)).toBe('protected');
  });
});
