import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '@shared/graph/session';
import { LsFilesSchema } from '@shared/ipc/schema/git';
import { GitFixture } from '../../../test/support/git-fixture';
import { FileLister, listableRoots, WALK_MAX_ENTRIES } from './ls-files';
import { knownSessionDirectories } from '../settings/session-directories';
import { createGitRunner } from './runner';

let repo: GitFixture;
let plain: string;
beforeEach(async () => {
  repo = await GitFixture.create();
  for (const rel of ['src/main.ts', 'docs/main-notes.md', 'src/domain.ts', 'untracked.txt']) await repo.write(rel, 'x\n');
  await repo.write('.gitignore', 'ignored.log\nbuild/\n');
  await repo.write('ignored.log', 'x\n');
  await repo.write('build/out.js', 'x\n');
  await repo.git('add', 'src', 'docs', '.gitignore');
  await repo.git('commit', '-q', '-m', 'files');
  plain = realpathSync(mkdtempSync(join(tmpdir(), 'maws-walk-')));
});
afterEach(() => {
  repo.dispose();
  rmSync(plain, { recursive: true, force: true });
  vi.useRealTimers();
});

function lister(roots: () => string[], run = createGitRunner({ env: repo.serviceEnv() })) {
  return new FileLister({ run, roots });
}

describe('git lsFiles filters and falls back', () => {
  it('lists tracked and untracked files, not ignored ones, ranking src/main.ts above docs/main-notes.md for main', async () => {
    const answer = LsFilesSchema.parse(await lister(() => [repo.root]).list({ directory: repo.root, query: 'main', limit: 30 }));
    expect(answer.source).toBe('git');
    expect(answer.truncated).toBe(false);
    expect(answer.paths.slice(0, 2)).toEqual(['src/main.ts', 'docs/main-notes.md']);
    expect(answer.paths).toContain('src/domain.ts');
    const all = await lister(() => [repo.root]).list({ directory: repo.root, query: '', limit: 200 });
    expect(all.paths).toEqual(expect.arrayContaining(['README.md', 'untracked.txt', '.gitignore', 'src/', 'docs/']));
    expect(all.paths.filter((p) => p.includes('ignored') || p.startsWith('build'))).toEqual([]);
  });

  it('caps at the limit and says so', async () => {
    const answer = await lister(() => [repo.root]).list({ directory: repo.root, query: '', limit: 2 });
    expect(answer.paths).toHaveLength(2);
    expect(answer.truncated).toBe(true);
  });

  it('lists a subdirectory relative to itself and caches the listing for ten seconds', async () => {
    const run = vi.fn(createGitRunner({ env: repo.serviceEnv() }));
    const l = lister(() => [repo.root], run);
    expect((await l.list({ directory: join(repo.root, 'src'), query: '', limit: 30 })).paths).toEqual(['main.ts', 'domain.ts']);
    await l.list({ directory: join(repo.root, 'src'), query: 'dom', limit: 30 });
    expect(run).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_001);
    await l.list({ directory: join(repo.root, 'src'), query: '', limit: 30 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('walks a directory that is not a repository, skipping node_modules, .git, dist and .claude/worktrees', async () => {
    for (const rel of ['src/main.ts', 'node_modules/pkg/index.js', 'dist/bundle.js', '.claude/worktrees/wt/src/main.ts', '.claude/settings.json', 'a/b/c/d/e/f/g/deep.ts', 'a/b/c/d/e/f/shallow.ts']) {
      mkdirSync(join(plain, rel, '..'), { recursive: true });
      writeFileSync(join(plain, rel), 'x\n');
    }
    const answer = LsFilesSchema.parse(await lister(() => [plain]).list({ directory: plain, query: '', limit: 200 }));
    expect(answer.source).toBe('walk');
    expect(answer.paths).toEqual(expect.arrayContaining(['src/main.ts', 'src/', '.claude/settings.json', 'a/b/c/d/e/f/shallow.ts']));
    expect(answer.paths.filter((p) => /node_modules|dist|worktrees|deep\.ts/.test(p))).toEqual([]);
    expect((await lister(() => [plain]).list({ directory: plain, query: 'main', limit: 30 })).paths[0]).toBe('src/main.ts');
  });

  it('stops a walk at its entry cap and reports it truncated', async () => {
    expect(WALK_MAX_ENTRIES).toBe(20_000);
    for (let i = 0; i < 30; i++) writeFileSync(join(plain, `f${i}.txt`), 'x');
    const answer = await new FileLister({ run: createGitRunner({ env: repo.serviceEnv() }), roots: () => [plain], walkMaxEntries: 10 }).list({ directory: plain, query: '', limit: 200 });
    expect(answer.paths.length).toBeLessThanOrEqual(10);
    expect(answer.truncated).toBe(true);
  });

  it('refuses a directory outside every session and project directory, a traversal included', async () => {
    const l = lister(() => [join(repo.root, 'src')]);
    await expect(l.list({ directory: repo.root, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    await expect(l.list({ directory: join(repo.root, 'src', '..'), query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    await repo.write('src-other/x.ts', 'x\n'); // a sibling sharing the root's name as a prefix
    await expect(l.list({ directory: `${repo.root}/src-other`, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    await expect(l.list({ directory: `${repo.root}/missing`, query: '', limit: 30 })).rejects.toThrow(/ENOENT/);
    await expect(lister(() => []).list({ directory: plain, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    expect((await l.list({ directory: join(repo.root, 'src'), query: '', limit: 30 })).paths).toContain('main.ts');
  });

  it('reads and realpaths the roots once until invalidated, and again when a directory falls outside them', async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'maws-root-')));
    try {
      let current = [repo.root, repo.root, join(repo.root, 'src')];
      const roots = vi.fn(() => current);
      const l = lister(roots);
      for (const query of ['m', 'ma', 'mai']) await l.list({ directory: repo.root, query, limit: 30 });
      expect(roots).toHaveBeenCalledTimes(1); // not per keystroke
      // A root added since the set was read is found on the miss, without waiting for the change.
      current = [repo.root, other];
      await l.list({ directory: other, query: '', limit: 30 });
      expect(roots).toHaveBeenCalledTimes(2);
      // A root that went (a session archived) stays listable only until main invalidates the set.
      current = [other];
      await l.list({ directory: repo.root, query: '', limit: 30 });
      expect(roots).toHaveBeenCalledTimes(2);
      l.invalidateRoots();
      await expect(l.list({ directory: repo.root, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
      await l.list({ directory: other, query: 'x', limit: 30 });
      expect(roots).toHaveBeenCalledTimes(4); // the invalidated read, and the refusal's re-read; then the set holds
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('lists the directories of unarchived sessions and of projects, once each', () => {
    const record = (directory: string, archived: boolean, extra: Partial<SessionRecord> = {}) => ({ directory, archived, additionalDirectories: [], worktree: null, ...extra }) as unknown as SessionRecord;
    const sessions = [
      record('/a', false, { additionalDirectories: ['/a/lib', '/shared'], worktree: { path: '/a/.claude/worktrees/w' } as SessionRecord['worktree'] }),
      record('/b', false, { additionalDirectories: ['/shared'] }),
      record('/archived', true, { additionalDirectories: ['/archived-extra'] }),
    ];
    // debt wave 4: main's `roots` reads the sessions through C11's `knownSessionDirectories`, unarchived only
    const unarchived = knownSessionDirectories({ allRecords: () => sessions.slice(0, 1) }, { sessions: { list: () => sessions.slice(1) } }, { includeArchived: false });
    expect(listableRoots(unarchived, ['/p', '/a'])).toEqual(['/a', '/a/lib', '/shared', '/a/.claude/worktrees/w', '/b', '/p']);
  });
});
