// The bookmarks mirror's sync (cua board #90's spec, "Mirror"): a profile's `Bookmarks` re-read when its partition is
// prepared and on `browser.bookmarks.sync`; the rows replaced and the record's state written; a failed read keeping the
// rows and setting `error`/`errorAt`; refused while an import or a removal runs or the index is read-only; and a removal
// finishing mid-read leaving neither rows nor record.
import { join } from 'node:path';
import type { Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBookmarkTree, type BookmarkTree } from '@shared/browser/bookmarks';
import type { ImportedBookmarks, ImportedProfile } from '@shared/browser/profiles';
import { profilePartition } from '@shared/browser/tab';
import { BOOKMARKS_REPORT } from '../../../../test/support/import-reports';
import { tempDir } from '../../../../test/support/index-fixture';
import { Index } from '../../index/index';
import type { BookmarksRead } from '../import/chrome/bookmarks';
import { ImportedProfiles } from '../import/profiles';
import { BookmarkSync, type BookmarkSyncDeps } from './sync';

const PARTITION = profilePartition('Default');
const CONSENTED: ImportedBookmarks = { consentedAt: '2026-10-08T09:00:00.000Z', syncedAt: '2026-10-08T09:00:01.000Z', count: 1, error: null, errorAt: null };
const NOW = Date.parse('2026-10-08T12:00:00.000Z');

const record = (bookmarks: ImportedBookmarks | null = CONSENTED, profileDir = 'Default'): ImportedProfile => ({
  profileDir,
  name: 'Person 1',
  partition: profilePartition(profileDir),
  importedAt: '2026-10-08T09:00:01.000Z',
  storageDirName: `maws-chrome-${profileDir.toLowerCase().replace(' ', '%20')}`,
  userDataDir: '/chrome',
  extensions: [],
  report: { ...BOOKMARKS_REPORT, profileDir, partition: profilePartition(profileDir) },
  bookmarks,
  gaiaName: null,
  userName: null,
  avatar: { kind: 'initials' },
});
const treeOf = (...names: string[]): BookmarkTree => ({
  ...emptyBookmarkTree(),
  bar: { kind: 'folder', id: 1, name: 'Bookmarks bar', children: names.map((name, k) => ({ kind: 'url' as const, id: k + 2, name, url: `https://${name.toLowerCase()}.example/`, addedAt: null })) },
});
const ok = (...names: string[]): BookmarksRead => ({ ok: true, tree: treeOf(...names), urls: names.length, skipped: 0 });
const barNames = (index: Index) => index.browserBookmarks.tree(PARTITION).bar.children.map((node) => node.name);

// A read the test answers when it chooses.
function deferredRead() {
  let answer!: (read: BookmarksRead) => void;
  const read = vi.fn(() => new Promise<BookmarksRead>((resolve) => (answer = resolve)));
  return { read, answer: (value: BookmarksRead) => answer(value) };
}

describe('BookmarkSync', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let profiles: ImportedProfiles;
  let emit: ReturnType<typeof vi.fn<(name: string, payload: unknown) => unknown>>;
  let busy: 'importing' | 'removing' | null;
  let deps: BookmarkSyncDeps;

  beforeEach(async () => {
    dir = tempDir('maws-90-sync-');
    index = new Index(join(dir.path, 'index.sqlite'));
    profiles = ImportedProfiles.open(dir.path);
    await profiles.put(record());
    index.browserBookmarks.replace(PARTITION, treeOf('A'));
    emit = vi.fn<(name: string, payload: unknown) => unknown>();
    busy = null;
    deps = { profiles, store: index.browserBookmarks, busy: () => busy, read: vi.fn(async () => ok('A2', 'Z')), emit: emit as BookmarkSyncDeps['emit'], env: {}, now: () => NOW };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    index.close();
    dir.dispose();
  });

  it('re-reads the file in place, replaces the rows, records syncedAt and the URL count, and announces both changes', async () => {
    const sync = new BookmarkSync(deps);
    expect(await sync.sync('Default')).toEqual({ syncedAt: '2026-10-08T12:00:00.000Z', count: 2 });
    expect(deps.read).toHaveBeenCalledWith('/chrome', 'Default');
    expect(barNames(index)).toEqual(['A2', 'Z']);
    expect(profiles.get('Default')!.bookmarks).toEqual({ ...CONSENTED, syncedAt: '2026-10-08T12:00:00.000Z', count: 2 });
    expect(emit).toHaveBeenCalledWith('browser.bookmarks.changed', { partition: PARTITION });
    expect(emit).toHaveBeenCalledWith('browser.import.changed', { profiles: profiles.list() });
  });

  it.each([['missing'], ['unreadable']] as const)('a %s file keeps the rows and records the error and its time, keeping the last sync', async (error) => {
    const sync = new BookmarkSync({ ...deps, read: async () => ({ ok: false, error }) });
    expect(await sync.sync('Default')).toEqual({ error });
    expect(barNames(index)).toEqual(['A']);
    expect(profiles.get('Default')!.bookmarks).toEqual({ ...CONSENTED, error, errorAt: '2026-10-08T12:00:00.000Z' });
    expect(emit).not.toHaveBeenCalledWith('browser.bookmarks.changed', expect.anything());
  });

  it('a later successful sync clears the error', async () => {
    await profiles.update('Default', (r) => ({ ...r, bookmarks: { ...CONSENTED, error: 'missing', errorAt: '2026-10-08T11:00:00.000Z' } }));
    await new BookmarkSync(deps).sync('Default');
    expect(profiles.get('Default')!.bookmarks).toMatchObject({ error: null, errorAt: null, count: 2 });
  });

  it('a replace the index refuses part-way keeps the rows and records indexUnavailable', async () => {
    const store = { replace: vi.fn(() => { throw Object.assign(new Error('disk I/O error'), { code: 'ERR_SQLITE_ERROR' }); }), readOnly: false };
    const sync = new BookmarkSync({ ...deps, store });
    expect(await sync.sync('Default')).toEqual({ error: 'indexUnavailable' });
    expect(barNames(index)).toEqual(['A']);
    expect(profiles.get('Default')!.bookmarks).toMatchObject({ error: 'indexUnavailable', errorAt: '2026-10-08T12:00:00.000Z' });
  });

  it('a read-only index answers indexUnavailable before reading, and writes nothing', async () => {
    const sync = new BookmarkSync({ ...deps, store: { replace: vi.fn(), readOnly: true } });
    expect(await sync.sync('Default')).toEqual({ error: 'indexUnavailable' });
    expect(deps.read).not.toHaveBeenCalled();
    expect(profiles.get('Default')!.bookmarks).toEqual(CONSENTED);
  });

  it.each([
    ['importing', 'an import is running'],
    ['removing', 'a profile is being removed'],
  ] as const)('is refused while %s, reading and writing nothing', async (state, reason) => {
    busy = state;
    const sync = new BookmarkSync(deps);
    expect(await sync.sync('Default')).toEqual({ error: 'refused', reason });
    expect(deps.read).not.toHaveBeenCalled();
    expect(barNames(index)).toEqual(['A']);
    expect(profiles.get('Default')!.bookmarks).toEqual(CONSENTED);
  });

  it('is refused for a profile that is not imported, or whose bookmarks were not imported', async () => {
    await profiles.put(record(null, 'Profile 1'));
    const sync = new BookmarkSync(deps);
    expect(await sync.sync('Profile 2')).toEqual({ error: 'refused', reason: 'not an imported profile' });
    expect(await sync.sync('Profile 1')).toEqual({ error: 'refused', reason: 'this profile’s bookmarks were not imported' });
    expect(deps.read).not.toHaveBeenCalled();
  });

  it('a removal that withdrew the profile during the read leaves the rows to it and writes nothing', async () => {
    const { read, answer } = deferredRead();
    const sync = new BookmarkSync({ ...deps, read });
    const pending = sync.sync('Default');
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    const release = profiles.withdraw('Default');
    answer(ok('A2'));
    expect(await pending).toEqual({ error: 'refused', reason: 'not an imported profile' });
    expect(barNames(index)).toEqual(['A']);
    expect(profiles.get('Default')!.bookmarks).toEqual(CONSENTED);
    release();
  });

  it('a removal finishing during the read leaves no rows and no record', async () => {
    const { read, answer } = deferredRead();
    const sync = new BookmarkSync({ ...deps, read });
    const pending = sync.sync('Default');
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    // the removal: withdrawn, its rows removed, its record dropped
    const release = profiles.withdraw('Default');
    index.browserBookmarks.removePartition(PARTITION);
    await profiles.remove('Default');
    release();
    answer(ok('A2', 'Z'));
    expect(await pending).toEqual({ error: 'refused', reason: 'not an imported profile' });
    expect(index.browserBookmarks.tree(PARTITION)).toEqual(emptyBookmarkTree());
    expect(profiles.get('Default')).toBeNull();
    expect(profiles.list()).toEqual([]);
  });

  it('runs one sync of a profile at a time: a second request reads after the first has written', async () => {
    const reads: ((read: BookmarksRead) => void)[] = [];
    const read = vi.fn(() => new Promise<BookmarksRead>((resolve) => reads.push(resolve)));
    const sync = new BookmarkSync({ ...deps, read });
    const first = sync.sync('Default');
    const second = sync.sync('Default');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    reads[0]!(ok('First'));
    await first;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    reads[1]!(ok('Second', 'Two'));
    expect(await second).toMatchObject({ count: 2 });
    expect(barNames(index)).toEqual(['Second', 'Two']);
  });

  describe('when a partition is prepared', () => {
    const ses = {} as Session;

    it('syncs the record of that partition with consented bookmarks, without throwing', async () => {
      const sync = new BookmarkSync(deps);
      expect(() => sync.onPartitionPrepared(ses, PARTITION)).not.toThrow();
      await sync.idle();
      expect(barNames(index)).toEqual(['A2', 'Z']);
      expect(profiles.get('Default')!.bookmarks).toMatchObject({ count: 2, error: null });
    });

    it('does nothing for a partition with no record (the import’s own `copying` call) or no consented bookmarks', async () => {
      await profiles.put(record(null, 'Profile 1'));
      const sync = new BookmarkSync(deps);
      sync.onPartitionPrepared(ses, profilePartition('Profile 3'));
      sync.onPartitionPrepared(ses, profilePartition('Profile 1'));
      sync.onPartitionPrepared(ses, 'persist:maws-browser');
      await sync.idle();
      expect(deps.read).not.toHaveBeenCalled();
    });

    it('logs a failure by its code only and never throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sync = new BookmarkSync({ ...deps, read: async () => ({ ok: false, error: 'missing' }) });
      sync.onPartitionPrepared(ses, PARTITION);
      await sync.idle();
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(['[browser-import] error bookmarks_sync missing']);
    });

    it('never throws even when the records cannot be listed', () => {
      const sync = new BookmarkSync({ ...deps, profiles: { ...profiles, list: () => { throw new Error('boom'); } } as unknown as BookmarkSyncDeps['profiles'] });
      expect(() => sync.onPartitionPrepared(ses, PARTITION)).not.toThrow();
    });
  });
});
