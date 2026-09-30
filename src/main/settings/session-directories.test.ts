import { describe, expect, it, vi } from 'vitest';
import { record } from '../../../test/support/builders';
import { knownSessionDirectories, recordDirectories } from './session-directories';

describe('knownSessionDirectories', () => {
  const held = record('app-a', { directory: '/r/a', additionalDirectories: ['/r/docs'] });
  const worktree = record('app-w', { directory: '/r/b', worktree: { path: '/r/b-wt' } as never });
  const archived = record('app-x', { directory: '/r/x', archived: true });

  it("names a record's directory, its additional directories and its worktree", () => {
    expect(recordDirectories(held)).toEqual(['/r/a', '/r/docs']);
    expect(recordDirectories(worktree)).toEqual(['/r/b', '/r/b-wt']);
  });

  it('joins the read model with the index, archived included', () => {
    const list = vi.fn(() => [worktree, archived]);
    expect(knownSessionDirectories({ allRecords: () => [held] }, { sessions: { list } })).toEqual(['/r/a', '/r/docs', '/r/b', '/r/b-wt', '/r/x']);
    expect(list).toHaveBeenCalledExactlyOnceWith({ includeArchived: true });
  });

  it('answers the read model alone, with a warning, when the index is unavailable', () => {
    const warn = vi.fn();
    const index = { sessions: { list: () => { throw new Error('index unavailable: SQLITE_CANTOPEN'); } } };
    expect(knownSessionDirectories({ allRecords: () => [held] }, index, { warn })).toEqual(['/r/a', '/r/docs']);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[settings] session directories without the index', expect.any(Error));
  });

  // Debt wave 4: C7's `@` listing roots read the same walk, unarchived only (from the read model as from the index)
  it('leaves archived sessions out on request, from the read model and the index alike', () => {
    const list = vi.fn(() => [worktree]);
    const heldArchived = { ...archived, directory: '/r/held-archived' };
    expect(knownSessionDirectories({ allRecords: () => [held, heldArchived] }, { sessions: { list } }, { includeArchived: false })).toEqual(['/r/a', '/r/docs', '/r/b', '/r/b-wt']);
    expect(list).toHaveBeenCalledExactlyOnceWith({ includeArchived: false });
  });
});
