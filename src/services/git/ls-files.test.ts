import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '@shared/graph/session';
import { LsFilesSchema } from '@shared/ipc/schema/git';
import { admissionRepos, type AdmissionPaths } from '../../../test/support/admission-cases';
import { isolatedGitEnv } from '../../../test/support/git-env';
import { GitFixture } from '../../../test/support/git-fixture';
import { project, record } from '../../../test/support/builders';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { intentFor } from '../../../test/support/session-host';
import { FileLister, followSpineRoots, listableRoots, spineAdmitted, spineRoots, WALK_MAX_ENTRIES } from './ls-files';
import { createGitRunner, NotARepositoryError } from './runner';

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

  // P5 O3-C (reader R13): the roots are read through the spine's view: unarchived records, intents, every project row
  it('lists the directories of unarchived sessions, of intents and of every project row, once each', () => {
    const sessions = [
      record('app-a', { directory: '/a', additionalDirectories: ['/a/lib', '/shared'], worktree: { path: '/a/.claude/worktrees/w' } as SessionRecord['worktree'] }),
      record('app-b', { directory: '/b', additionalDirectories: ['/shared'] }),
      record('app-x', { directory: '/archived', archived: true, additionalDirectories: ['/archived-extra'] }),
    ];
    const intents = [
      intentFor('new-dir', { location: { kind: 'directory', path: '/c' }, additionalDirectories: ['/c-extra'] }),
      intentFor('new-wt', { location: { kind: 'newWorktree', repoRoot: '/r', name: 'n', branch: { kind: 'new', name: 'n', base: 'HEAD' } } as never, progress: { worktree: { path: '/r-n' } } as never }),
      intentFor('no-project', { location: null }),
    ];
    const view = fakeSpineView({ records: sessions, intents, projects: [project('p', 0, { directory: '/p' })], projectRows: [project('p', 0, { directory: '/p' }), project('h', 1, { directory: '/hidden', hidden: true }), project('a', 2, { directory: '/a' })] });
    expect(spineRoots(view)).toEqual(['/a', '/a/lib', '/shared', '/a/.claude/worktrees/w', '/b', '/c-extra', '/c', '/r', '/r-n', '/p', '/hidden']);
    expect(listableRoots(['/a', '/a'], ['/p', '/a'])).toEqual(['/a', '/p']);
  });

  it('reads the roots again after any record, project or intent change the view reports, and stops following', () => {
    const view = fakeSpineView();
    const invalidateRoots = vi.fn();
    const stop = followSpineRoots(view, { invalidateRoots });
    view.putRecord(record('app-a'));
    view.removeRecord('app-a' as never);
    view.setProjects([]);
    view.putIntent(intentFor('app-n'));
    view.setVisible('app-a' as never, true); // not a root
    expect(invalidateRoots).toHaveBeenCalledTimes(4);
    stop();
    expect(view.listeners()).toBe(0);
  });
});

// UX wave U8c-2, M3 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, decision 10 and §G): a
// directory no kept root holds is listed only when, as its listing is loaded, it lies under a fact's folder that the
// admission accepts then; that answer is never kept among the roots, so a registration removed stops the next load.
describe('git lsFiles and the folders the records’ facts name', () => {
  let repos: Awaited<ReturnType<typeof admissionRepos>>;
  let p: AdmissionPaths;
  beforeAll(async () => {
    repos = await admissionRepos();
    p = repos.paths;
  });
  afterAll(() => repos.dispose());

  const movedTo = (folder: string, over: Partial<SessionRecord> = {}) =>
    record('app-moved', { directory: p.main, agentFolder: { checkout: folder, cwd: folder, branch: null, linked: true }, ...over });
  const listerOver = (view: ReturnType<typeof fakeSpineView>) =>
    new FileLister({ run: createGitRunner({ env: { PATH: process.env.PATH, HOME: p.plain } }), roots: () => spineRoots(view), admitted: spineAdmitted(view) });
  const deregistered = async (name: string, during: () => Promise<void>) => {
    const away = join(p.base, `${name}-registration`);
    renameSync(join(p.main, '.git/worktrees', name), away);
    try {
      await during();
    } finally {
      renameSync(away, join(p.main, '.git/worktrees', name));
    }
  };

  it('lists a directory under a fact’s registered worktree that no kept root holds', async () => {
    const view = fakeSpineView({ records: [movedTo(p.beside)] });
    const l = listerOver(view);
    expect((await l.list({ directory: join(p.beside, 'packages'), query: '', limit: 30 })).paths).toEqual(expect.arrayContaining(['app/index.ts', 'app/']));
    expect((await l.list({ directory: p.beside, query: 'index', limit: 30 })).paths[0]).toBe('packages/app/index.ts');
  });

  it('lists no folder that holds a copied .git pointer, nor one whose repository’s config cannot be read, nor one an archived session’s fact names', async () => {
    const copied = listerOver(fakeSpineView({ records: [movedTo(p.copy)] }));
    await expect(copied.list({ directory: p.copy, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    const locked = listerOver(fakeSpineView({ records: [movedTo(p.lockedWt, { directory: p.locked })] })); // its repository's config cannot be read
    await expect(locked.list({ directory: p.lockedWt, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    const archived = listerOver(fakeSpineView({ records: [movedTo(p.beside, { archived: true })] }));
    await expect(archived.list({ directory: p.beside, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
  });

  it('serves a loaded listing its ten seconds, and lists nothing at the next load once the worktree is deregistered', async () => {
    const l = listerOver(fakeSpineView({ records: [movedTo(p.beside)] }));
    expect((await l.list({ directory: p.beside, query: '', limit: 30 })).paths).toContain('README.md');
    await deregistered('beside', async () => {
      expect((await l.list({ directory: p.beside, query: '', limit: 30 })).paths).toContain('README.md'); // the listing already loaded
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 10_001);
      await expect(l.list({ directory: p.beside, query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    });
  });

  it('keeps no fact’s folder among its roots: a directory under it, not yet loaded, is refused once the registration is gone', async () => {
    const view = fakeSpineView({ records: [movedTo(p.beside)] });
    const l = listerOver(view);
    expect((await l.list({ directory: p.beside, query: '', limit: 30 })).paths).toContain('README.md');
    expect(spineRoots(view)).toEqual([p.main]);
    await deregistered('beside', async () => {
      await expect(l.list({ directory: join(p.beside, 'packages'), query: '', limit: 30 })).rejects.toThrow(/not a directory of any session or project/);
    });
  });

  it('answers the admitted facts’ folders of unarchived records, and reads nothing for a record with none', async () => {
    const view = fakeSpineView({
      records: [
        movedTo(p.beside),
        record('app-launched', { directory: p.beside, worktree: { path: p.beside, branch: 'beside' }, launchFolder: p.main }),
        record('app-plain', { directory: join(p.base, 'never-there') }),
        record('app-forged', { directory: p.main, agentFolder: { checkout: p.nested, cwd: p.nested, branch: null, linked: false } }),
      ],
    });
    expect((await spineAdmitted(view)()).sort()).toEqual([p.beside, p.main].sort());
  });
});

// UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, decisions 4 and 14, M2 decision 8; B8):
// three folders side by side over real git, and what the lister reads from git's index entries. Every name is invented.
describe('git lsFiles beside a refused repository, and a submodule as the folder it is', () => {
  it('walks a folder that is no repository, fails one git refuses (not as no repository), and lists a good one from git', async () => {
    const refused = await GitFixture.create();
    try {
      writeFileSync(join(plain, 'loose.txt'), 'x\n');
      writeFileSync(join(refused.root, '.git/config'), '[core\n\tthis line git cannot read\n'); // a configuration git cannot read
      const l = lister(() => [plain, refused.root, repo.root]);
      const walked = await l.list({ directory: plain, query: '', limit: 200 });
      expect([walked.source, walked.paths]).toEqual(['walk', ['loose.txt']]);
      const failure = await l.list({ directory: refused.root, query: '', limit: 200 }).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(NotARepositoryError);
      const good = await l.list({ directory: repo.root, query: '', limit: 200 });
      expect(good.source).toBe('git');
      expect(good.paths).toEqual(expect.arrayContaining(['README.md', 'src/main.ts', 'docs/main-notes.md', 'untracked.txt', 'src/', 'docs/']));
    } finally {
      refused.dispose();
    }
  });

  it('lists a clean submodule as <path>/ and under no other spelling, a conflicted path once, and an untracked name that holds a tab unharmed', async () => {
    const library = await GitFixture.create();
    try {
      await repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library.root, 'vendor/harbor-lib');
      await repo.git('commit', '-q', '-m', 'a submodule');
      await repo.write('tides.txt', 'low\n');
      await repo.git('add', 'tides.txt');
      await repo.git('commit', '-q', '-m', 'tides');
      await repo.git('checkout', '-q', '-b', 'spring');
      await repo.write('tides.txt', 'spring\n');
      await repo.git('commit', '-q', '-am', 'spring tide');
      await repo.git('checkout', '-q', 'main');
      await repo.write('tides.txt', 'neap\n');
      await repo.git('commit', '-q', '-am', 'neap tide');
      await repo.git('merge', '-q', 'spring').catch(() => undefined); // the conflict leaves tides.txt at three stages
      expect((await repo.git('ls-files', '--stage', 'tides.txt')).trim().split('\n')).toHaveLength(3);
      await repo.write('tab\there.txt', 'x\n');
      const answer = LsFilesSchema.parse(await lister(() => [repo.root]).list({ directory: repo.root, query: '', limit: 200 }));
      expect(answer.source).toBe('git');
      expect(answer.paths.filter((path) => path.startsWith('vendor/harbor-lib'))).toEqual(['vendor/harbor-lib/']);
      expect(answer.paths).toContain('vendor/');
      expect(answer.paths.filter((path) => path === 'tides.txt')).toHaveLength(1);
      expect(answer.paths).toContain('tab\there.txt');
      expect(answer.paths).toEqual(expect.arrayContaining(['README.md', '.gitmodules', 'src/main.ts', 'untracked.txt']));
    } finally {
      library.dispose();
    }
  });

  // A conflict whose stages mix a file and a gitlink (one side added a submodule where the other added a file): the path
  // is listed once, as the folder, since a gitlink at any of its stages makes it one. A path whose stages are all files,
  // in the same index, is listed once as a file: the control.
  it('lists a conflicted path whose stages mix a file and a gitlink once, as <path>/; one whose stages are all files once, as a file', async () => {
    const git = (args: string[], input?: string): string =>
      execFileSync('/usr/bin/git', ['-C', repo.root, ...args], { env: isolatedGitEnv(), encoding: 'utf8', input });
    await repo.write('blob-a.txt', 'ebb\n');
    await repo.write('blob-b.txt', 'flood\n');
    const a = git(['hash-object', '-w', 'blob-a.txt']).trim();
    const b = git(['hash-object', '-w', 'blob-b.txt']).trim();
    const link = git(['rev-parse', 'HEAD']).trim();
    git(['update-index', '--index-info'], [
      `100644 ${a} 1\tharbor`,
      `160000 ${link} 2\tharbor`,
      `100644 ${b} 3\tharbor`,
      `100644 ${a} 1\tquay.txt`,
      `100644 ${a} 2\tquay.txt`,
      `100644 ${b} 3\tquay.txt`,
      '',
    ].join('\n'));
    expect(git(['ls-files', '--stage', 'harbor']).trim().split('\n')).toHaveLength(3);
    const answer = LsFilesSchema.parse(await lister(() => [repo.root]).list({ directory: repo.root, query: '', limit: 200 }));
    expect(answer.paths.filter((path) => path.startsWith('harbor'))).toEqual(['harbor/']);
    expect(answer.paths.filter((path) => path.startsWith('quay'))).toEqual(['quay.txt']);
  });

  // Decision 14's one limit, pinned so that a change of the reading is seen: an untracked path whose own name begins with
  // an index entry's head (a mode, an object id, a stage and a tab) is read as an index entry.
  it('reads an untracked name that begins with an index entry’s head as that entry: listed as what follows its tab', async () => {
    const id = 'a'.repeat(40);
    await repo.write(`100644 ${id} 0\tdecoy.txt`, 'x\n');
    await repo.write(`160000 ${id} 0\tdecoy-link`, 'x\n');
    const answer = await lister(() => [repo.root]).list({ directory: repo.root, query: '', limit: 200 });
    expect(answer.paths).toEqual(expect.arrayContaining(['decoy.txt', 'decoy-link/']));
    expect(answer.paths.filter((path) => path.includes(id))).toEqual([]);
  });
});
