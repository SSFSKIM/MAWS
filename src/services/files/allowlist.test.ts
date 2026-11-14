import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import { ADMISSION_CASES, admissionRepos, type AdmissionPaths } from '../../../test/support/admission-cases';
import { record as sessionRecord } from '../../../test/support/builders';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { GitFixture, runGit } from '../../../test/support/git-fixture';
import { admittedFolder, allowlistOf, rootsOf, under } from './allowlist';

describe('files allowlist', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'maws-files-allow-'));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const record = (directory: string, additionalDirectories: string[] = [], worktree: string | null = null) => ({
    directory,
    additionalDirectories,
    worktree: worktree === null ? null : { path: worktree, branch: 'b' },
  });

  it('is under a root only at a segment boundary', () => {
    expect(under('/repo', '/repo')).toBe(true);
    expect(under('/repo', '/repo/a/b.ts')).toBe(true);
    expect(under('/repo', '/repo2')).toBe(false);
    expect(under('/repo', '/repo2/a')).toBe(false);
    expect(under('/repo', '/re')).toBe(false);
    expect(under('/repo', '/')).toBe(false);
    expect(under('/', '/anything')).toBe(true);
  });

  it('resolves every root by its native realpath, in record order, deduplicated', async () => {
    const repo = join(base, 'repo');
    const extra = join(base, 'extra');
    mkdirSync(repo);
    mkdirSync(extra);
    symlinkSync(repo, join(base, 'repo-link'));
    const real = await realpath(base); // /var/folders/… is /private/var/folders/… on macOS
    // the worktree realpaths to the directory itself, and an additional directory repeats through a link
    const roots = await rootsOf(record(repo, [extra, join(base, 'repo-link')], join(base, 'repo-link')));
    expect(roots).toEqual([join(real, 'repo'), join(real, 'extra')]);
  });

  it('drops a root that does not resolve and never falls back to the record string', async () => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    expect(await rootsOf(record(join(base, 'gone'), [repo]))).toEqual([join(await realpath(base), 'repo')]);
    expect(await rootsOf(record(join(base, 'gone'), [join(base, 'also-gone')]))).toEqual([]);
  });

  // macOS: the temporary directory is on a case-insensitive APFS volume, where `repo` names `Repo`.
  it.skipIf(process.platform !== 'darwin')('canonicalises case on a case-insensitive volume, as the native realpath does', async () => {
    mkdirSync(join(base, 'Repo'));
    const roots = await rootsOf(record(join(base, 'repo')));
    expect(roots).toEqual([join(await realpath(base), 'Repo')]);
  });
});

// E11's sitting (joint-sitting notes, A4 setup): the Files pane of a New chat in a project answered "Could not list:
// unknown app session" until the session started. Before its first send a session is an intent with no record; its
// directories are the intent's location (and its additional directories), so the pane lists the project from the start.
describe('the allowlist of a session that has not started', () => {
  const ID = 'c6bb8a7b-7b58-44c4-a0fa-01314e461f36' as AppSessionId;
  const intent = (location: SetupIntent['location'], over: Partial<SetupIntent> = {}) => ({ appSessionId: ID, location, additionalDirectories: ['/extra'], progress: { worktree: null }, ...over }) as unknown as SetupIntent;
  // P5 O3-C (reader R12): the record and the intent through the spine's view
  const recordOf = (held: { directory: string } | null, found: SetupIntent | null) =>
    allowlistOf(fakeSpineView({ records: held === null ? [] : [sessionRecord(ID, { ...held, additionalDirectories: [], worktree: null })], intents: found === null ? [] : [found] }));

  it('is the record once there is one, whatever the intent says', () => {
    expect(recordOf({ directory: '/started' }, intent({ kind: 'directory', path: '/project' }))(ID)).toMatchObject({ directory: '/started', additionalDirectories: [], worktree: null });
  });

  it("is the intent's location before then: a directory, an existing worktree, a new worktree's repository until it is made", () => {
    expect(recordOf(null, intent({ kind: 'directory', path: '/project' }))(ID)).toEqual({ directory: '/project', additionalDirectories: ['/extra'], worktree: null });
    expect(recordOf(null, intent({ kind: 'existingWorktree', repoRoot: '/repo', path: '/repo-wt' }))(ID)).toEqual({ directory: '/repo-wt', additionalDirectories: ['/extra'], worktree: null });
    const fresh = intent({ kind: 'newWorktree', repoRoot: '/repo', name: 'n', branch: { kind: 'new', name: 'n', base: 'HEAD' } });
    expect(recordOf(null, fresh)(ID)).toEqual({ directory: '/repo', additionalDirectories: ['/extra'], worktree: null });
    const made = intent({ kind: 'newWorktree', repoRoot: '/repo', name: 'n', branch: { kind: 'new', name: 'n', base: 'HEAD' } }, { progress: { worktree: { path: '/repo-n', branch: 'n', head: 'h', createdHere: true } } as never });
    expect(recordOf(null, made)(ID)).toEqual({ directory: '/repo-n', additionalDirectories: ['/extra'], worktree: null });
  });

  it('is nothing for an unknown id or a New chat with no project chosen yet', () => {
    expect(recordOf(null, null)(ID)).toBeNull();
    expect(recordOf(null, intent(null))(ID)).toBeNull();
  });
});

// UX wave U8c-2, M3 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §G): a folder that comes from
// one of the record's two facts is a root only through the one admission, read at the call from git's own files: the work
// tree git finds for it must itself be a work tree of the repository the record's directory is in. The table of cases is
// the endpoint's too (test/endpoint/checkout-rule.test.ts), over the same repositories.
describe('the admission of a fact’s folder (§G), read from git’s own files', () => {
  let repos: Awaited<ReturnType<typeof admissionRepos>>;
  let p: AdmissionPaths;
  beforeAll(async () => {
    repos = await admissionRepos();
    p = repos.paths;
  });
  afterAll(() => repos.dispose());

  it.each(ADMISSION_CASES)('%s', async (_name, make) => {
    const { record, which, admitted } = make(p);
    expect(await admittedFolder(record, which)).toEqual(admitted === null ? null : { folder: admitted, checked: true });
    // and rootsOf appends exactly what it admits, after the record's own roots
    expect(await rootsOf(record)).toEqual([...new Set([record.directory, ...(record.worktree ? [record.worktree.path] : []), ...(admitted === null ? [] : [admitted])])]);
  });

  it('answers the record’s own folder as it names it, unchecked and with nothing read, for a record with no fact', async () => {
    const plain = { directory: join(p.base, 'nowhere'), additionalDirectories: [], worktree: null };
    expect(await admittedFolder(plain, 'path')).toEqual({ folder: plain.directory, checked: false });
    expect(await admittedFolder(plain, 'launch')).toEqual({ folder: plain.directory, checked: false });
    const filed = { directory: join(p.w1, 'packages'), additionalDirectories: [], worktree: { path: p.w1, branch: 'w1' } };
    expect(await admittedFolder(filed, 'path')).toEqual({ folder: p.w1, checked: false });
  });

  it('appends the launch folder and then the working folder, each once, after the record’s own roots', async () => {
    const both = { directory: p.beside, additionalDirectories: [p.other], worktree: { path: p.beside, branch: 'beside' }, launchFolder: p.main, agentFolder: { checkout: p.w1, cwd: p.w1, branch: 'w1', linked: true } };
    expect(await rootsOf(both)).toEqual([p.beside, p.other, p.main, p.w1]);
  });

  it('drops an admitted folder that is a home of the machine for a remote caller, as any root', async () => {
    const record = { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.beside, cwd: p.beside, branch: 'beside', linked: true } };
    expect(await rootsOf(record, [p.beside])).toEqual([p.main]);
    expect(await rootsOf(record, [join(p.base, 'elsewhere')])).toEqual([p.main, p.beside]);
  });

  // Not in the shared table: git itself, finding a nested `.git` it cannot read, takes the outer repository (on the VM, git
  // 2.43 answers the main checkout as the top level from inside it), so the endpoint's reader, which asks git, admits the
  // folder as a sub-folder of the main work tree. The files reader reads git's files itself, and a read that fails refuses.
  it('refuses a folder whose repository’s metadata cannot be read, rather than taking the repository around it', async () => {
    const nested = join(p.main, 'locked-nested');
    mkdirSync(nested);
    await runGit(nested, ['init', '-q', '-b', 'nested']);
    const record = { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: nested, cwd: nested, branch: null, linked: false } };
    try {
      for (const [locked, mode] of [[join(nested, '.git'), 0o755], [join(nested, '.git', 'HEAD'), 0o644]] as const) {
        chmodSync(locked, 0o000);
        try {
          expect(await admittedFolder(record, 'path'), locked).toBeNull();
        } finally {
          chmodSync(locked, mode);
        }
      }
    } finally {
      rmSync(nested, { recursive: true, force: true });
    }
  });

  // The branch review (P1), this reader's side: membership is realpath equality with the path git lists, so where the
  // filesystem keeps `café` composed and decomposed apart (ext4) the registered worktree is admitted and a sibling spelled
  // in the other form, holding a copy of its pointer, is not (test/endpoint/checkout-rule.test.ts, the endpoint's side).
  // Where the forms fold (APFS) the two names are one folder.
  it('admits a worktree named in one Unicode form and not a sibling named in the other that copies its pointer', async (ctx) => {
    const one = await GitFixture.create();
    try {
      const decomposed = one.path('.claude/worktrees/cafe\u0301');
      const composed = one.path('.claude/worktrees/caf\u00e9');
      await one.git('worktree', 'add', '-q', '-b', 'cafe', decomposed);
      try {
        mkdirSync(composed);
      } catch {
        ctx.skip(); // the forms fold (APFS): one directory
      }
      copyFileSync(join(decomposed, '.git'), join(composed, '.git'));
      const at = (folder: string) => ({ directory: one.root, additionalDirectories: [], worktree: null, agentFolder: { checkout: folder, cwd: folder, branch: null, linked: true } });
      expect(await admittedFolder(at(decomposed), 'path')).toEqual({ folder: decomposed, checked: true });
      expect(await admittedFolder(at(composed), 'path')).toBeNull();
    } finally {
      one.dispose();
    }
  });

  it('reads the predicate again at each call: a registration removed since is no root', async () => {
    const record = { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.w1, cwd: p.w1, branch: 'w1', linked: true } };
    expect(await admittedFolder(record, 'path')).toEqual({ folder: p.w1, checked: true });
    const moved = join(p.base, 'w1-registration');
    renameSync(join(p.main, '.git/worktrees/w1'), moved);
    try {
      expect(await admittedFolder(record, 'path')).toBeNull();
    } finally {
      renameSync(moved, join(p.main, '.git/worktrees/w1'));
    }
    expect(await admittedFolder(record, 'path')).toEqual({ folder: p.w1, checked: true });
  });
});
