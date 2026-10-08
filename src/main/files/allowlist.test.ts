import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import { allowlistOf, rootsOf, under } from './allowlist';

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

  it('canonicalises case on a case-insensitive volume, as the native realpath does', async () => {
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
  const recordOf = (record: { directory: string } | null, found: SetupIntent | null) =>
    allowlistOf({ record: () => (record === null ? null : { ...record, additionalDirectories: [], worktree: null }) }, { get: () => found });

  it('is the record once there is one, whatever the intent says', () => {
    expect(recordOf({ directory: '/started' }, intent({ kind: 'directory', path: '/project' }))(ID)).toEqual({ directory: '/started', additionalDirectories: [], worktree: null });
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
