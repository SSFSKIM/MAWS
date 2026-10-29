import { describe, expect, it } from 'vitest';
import { record } from '../../../test/support/builders';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { knownSessionDirectories, recordDirectories } from './directories';

describe('knownSessionDirectories', () => {
  const held = record('app-a', { directory: '/r/a', additionalDirectories: ['/r/docs'] });
  const worktree = record('app-w', { directory: '/r/b', worktree: { path: '/r/b-wt' } as never });
  const archived = record('app-x', { directory: '/r/x', archived: true });

  it("names a record's directory, its additional directories and its worktree", () => {
    expect(recordDirectories(held)).toEqual(['/r/a', '/r/docs']);
    expect(recordDirectories(worktree)).toEqual(['/r/b', '/r/b-wt']);
  });

  // P5 O3-C (reader R11): every record the spine's view holds, archived included; none while it holds none
  it('names every record of the spine’s view, archived included', () => {
    expect(knownSessionDirectories(fakeSpineView({ records: [held, worktree, archived] }))).toEqual(['/r/a', '/r/docs', '/r/b', '/r/b-wt', '/r/x']);
    expect(knownSessionDirectories(fakeSpineView({ unavailable: 'refused' }))).toEqual([]);
  });

  // Debt wave 4: `git.lsFiles`'s listing roots read the same walk, unarchived only
  it('leaves archived sessions out on request', () => {
    expect(knownSessionDirectories(fakeSpineView({ records: [held, worktree, archived] }), { includeArchived: false })).toEqual(['/r/a', '/r/docs', '/r/b', '/r/b-wt']);
  });
});
