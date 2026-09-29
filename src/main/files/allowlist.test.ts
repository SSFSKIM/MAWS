import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rootsOf, under } from './allowlist';

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
