// P3-HD M1: the `projects` key a launch's engine reads its local-scope servers under, captured by the host before the
// engine spawns (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, "Source truth and lifetime"; probe run
// 39007800364, e2e/fixtures/connectors-direct/run-39007800364/git-keys.json: outside a repository the cwd's own key, at
// a repository root and in its child directory the root's key). Scratch directories with a `.git` directory made by
// hand (no git command); linked checkouts, a `.git` file or link, unreadable paths and symlinked cwds stay unidentified.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLocalKey, nodeLocalKeyFiles, type LocalKeyFiles } from './local-key';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-hd-localkey-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('captureLocalKey', () => {
  it('outside a repository is the cwd itself', async () => {
    const cwd = join(dir, 'plain');
    mkdirSync(cwd);
    expect(await captureLocalKey(cwd)).toEqual({ kind: 'directory', key: cwd });
  });

  it('at a repository root and below it is the root holding the `.git` directory', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'sub', 'deep'), { recursive: true });
    expect(await captureLocalKey(repo)).toEqual({ kind: 'repository', key: repo });
    expect(await captureLocalKey(join(repo, 'sub', 'deep'))).toEqual({ kind: 'repository', key: repo });
  });

  it('the nearest `.git` wins, as the engine walks up', async () => {
    const outer = join(dir, 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(join(outer, '.git'), { recursive: true });
    mkdirSync(join(inner, '.git'), { recursive: true });
    expect(await captureLocalKey(join(inner))).toEqual({ kind: 'repository', key: inner });
  });

  it('a `.git` file (linked worktree, submodule) or link is unidentified until a probe proves the engine’s folding', async () => {
    const linked = join(dir, 'linked');
    mkdirSync(linked);
    writeFileSync(join(linked, '.git'), 'gitdir: /elsewhere/.git/worktrees/linked\n');
    expect(await captureLocalKey(linked)).toEqual({ kind: 'unidentified', why: 'linkedCheckout' });
    const viaLink = join(dir, 'via-link');
    mkdirSync(viaLink);
    mkdirSync(join(dir, 'real-git'));
    symlinkSync(join(dir, 'real-git'), join(viaLink, '.git'));
    expect(await captureLocalKey(viaLink)).toEqual({ kind: 'unidentified', why: 'linkedCheckout' });
  });

  it('a cwd reached through a symlink, a relative cwd, or one that does not exist is unidentified', async () => {
    mkdirSync(join(dir, 'target'));
    symlinkSync(join(dir, 'target'), join(dir, 'alias'));
    expect(await captureLocalKey(join(dir, 'alias'))).toEqual({ kind: 'unidentified', why: 'symlinkedCwd' });
    expect(await captureLocalKey('relative/dir')).toEqual({ kind: 'unidentified', why: 'notAbsolute' });
    expect(await captureLocalKey(join(dir, 'absent'))).toEqual({ kind: 'unidentified', why: 'unreadable' });
  });

  // P3-F L244: APFS answers a realpath in the spelling it stored, so a launch cwd composed (NFC) can come back
  // decomposed (NFD) for the very same directory. The fake realpath answers as APFS would; the filesystem is real.
  const storedNfd: LocalKeyFiles = { ...nodeLocalKeyFiles, realpath: async (path) => (await nodeLocalKeyFiles.realpath(path)).normalize('NFD') };

  it('a cwd the filesystem answers in another Unicode normalization is the same directory, keyed in NFC', async () => {
    const cwd = join(dir, 'caf\u00e9', '\ud55c\uae00');
    mkdirSync(cwd, { recursive: true });
    expect(await captureLocalKey(cwd, { files: storedNfd })).toEqual({ kind: 'directory', key: cwd });
    mkdirSync(join(dir, 'caf\u00e9', '.git'));
    expect(await captureLocalKey(cwd, { files: storedNfd })).toEqual({ kind: 'repository', key: join(dir, 'caf\u00e9') });
  });

  it('a symlink along the cwd stays refused even when its target differs from the cwd only by normalization', async () => {
    mkdirSync(join(dir, 'target', 'inner'), { recursive: true });
    symlinkSync(join(dir, 'target'), join(dir, 'caf\u00e9'));
    // a normalization-sensitive filesystem can hold the decomposed twin as another directory a link points at
    const twin: LocalKeyFiles = { ...nodeLocalKeyFiles, realpath: async (path) => path.normalize('NFD') };
    expect(await captureLocalKey(join(dir, 'caf\u00e9', 'inner'), { files: twin })).toEqual({ kind: 'unidentified', why: 'symlinkedCwd' });
  });

  it('a failed probe of any ancestor never reads as “no repository”', async () => {
    const cwd = join(dir, 'a', 'b');
    mkdirSync(cwd, { recursive: true });
    const denied: LocalKeyFiles = {
      ...nodeLocalKeyFiles,
      gitEntry: async (path) => {
        if (path === join(dir, 'a', '.git')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return nodeLocalKeyFiles.gitEntry(path);
      },
    };
    expect(await captureLocalKey(cwd, { files: denied })).toEqual({ kind: 'unidentified', why: 'unreadable' });
  });

  it('is bounded: a probe that does not answer in time is unidentified', async () => {
    const cwd = join(dir, 'slow');
    mkdirSync(cwd);
    const stuck: LocalKeyFiles = { ...nodeLocalKeyFiles, gitEntry: () => new Promise(() => {}) };
    expect(await captureLocalKey(cwd, { files: stuck, timeoutMs: 20 })).toEqual({ kind: 'unidentified', why: 'timeout' });
  });
});
