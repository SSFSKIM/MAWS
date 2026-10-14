// The renderer's library store over a fake main (the P3-L execution document, M3): the lists, rows and Spaces the
// window watches, read on first watch and read again on every `library.changed`; a failed read keeps the last good
// answer; an answer a newer read superseded is dropped; what nobody watches is not refreshed and is forgotten past a cap.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import {
  connectLibrary, library, libraryList, libraryRow, librarySpaces, listKey, refreshLibrary, resetLibrary, UNWATCHED_KEPT, watchLibraryList,
  watchLibraryRow, watchLibrarySpaces,
} from './store';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COUNTS = { document: 0, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 0, file: 0 };

function row(n: number, over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: id(n),
    kind: 'html',
    title: `Page ${n}`,
    createdBy: { kind: 'human' },
    createdAt: 1_000 * n,
    updatedAt: 1_000 * n,
    lastViewedAt: null,
    pinned: false,
    agentEditsAsSuggestions: false,
    revision: n,
    lastEditor: { kind: 'human' },
    lastEditedAt: 1_000 * n,
    sessions: [],
    ...over,
  };
}
const answer = (...rows: LibraryRow[]) => ({ rows, counts: { ...COUNTS, html: rows.length } });
const space = (n: number): LibrarySpace => ({ id: id(100 + n), name: `Space ${n}`, createdAt: n, count: 0 });

const state = () => library.getState();
let fake: FakeClient;
let disconnect: () => void;
const offs: (() => void)[] = [];
beforeEach(() => {
  resetLibrary();
  fake = fakeClient();
  window.maws = fake.client;
  disconnect = connectLibrary();
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  disconnect();
});
const watch = (off: () => void) => (offs.push(off), off);

describe('a list', () => {
  it('is read on its first watch and shared by later watchers of the same filter', async () => {
    watch(watchLibraryList({ kind: 'html', pinned: true }));
    watch(watchLibraryList({ pinned: true, kind: 'html' }));
    expect(fake.invoked('library.list')).toEqual([{ filter: { kind: 'html', pinned: true } }]);
    expect(libraryList(state(), { kind: 'html', pinned: true })).toMatchObject({ status: 'reading', value: undefined });
    await fake.reply('library.list', answer(row(2), row(1)));
    expect(libraryList(state(), { kind: 'html', pinned: true })).toMatchObject({ status: 'ready', error: null });
    expect(libraryList(state(), { kind: 'html', pinned: true }).value?.rows.map((r) => r.id)).toEqual([id(2), id(1)]);
  });

  it('keys a filter by what it asks: no filter, an empty one and a blank query are one list', () => {
    expect(listKey(undefined)).toBe(listKey({}));
    expect(listKey({ query: '   ' })).toBe(listKey({}));
    expect(listKey({ query: undefined, kind: 'file' })).toBe(listKey({ kind: 'file' }));
    expect(listKey({ spaceId: null })).not.toBe(listKey({}));
    watch(watchLibraryList({ query: ' ' }));
    expect(fake.invoked('library.list')).toEqual([{ filter: {} }]);
  });

  it('keeps the last good list across a failed read, with the refusal’s message, until a read succeeds', async () => {
    watch(watchLibraryList());
    await fake.reply('library.list', answer(row(1)));
    fake.event('library.changed', { revision: 2 });
    await fake.fail('library.list', 'index unavailable');
    expect(libraryList(state())).toMatchObject({ status: 'error', error: 'index unavailable' });
    expect(libraryList(state()).value?.rows.map((r) => r.id), 'the last good list').toEqual([id(1)]);
    fake.event('library.changed', { revision: 3 });
    expect(libraryList(state()).status, 'reading again, the list still shown').toBe('reading');
    expect(libraryList(state()).value?.rows).toHaveLength(1);
    await fake.reply('library.list', answer(row(2), row(1)));
    expect(libraryList(state())).toMatchObject({ status: 'ready', error: null });
    expect(libraryList(state()).value?.rows).toHaveLength(2);
  });

  it('drops an answer a newer read superseded: a change while a read is out reads again', async () => {
    watch(watchLibraryList());
    fake.event('library.changed', { revision: 2 });
    expect(fake.pending('library.list')).toBe(2);
    await fake.reply('library.list', answer(row(1))); // the first read, from before the change
    expect(libraryList(state())).toMatchObject({ status: 'reading', value: undefined });
    await fake.reply('library.list', answer(row(2), row(1)));
    expect(libraryList(state()).value?.rows).toHaveLength(2);
  });
});

describe('library.changed', () => {
  it('reads again every watched list, row and the Spaces, and nothing nobody watches', async () => {
    watch(watchLibraryList({ kind: 'file' }));
    const offHtml = watch(watchLibraryList({ kind: 'html' }));
    watch(watchLibraryRow(id(1)));
    watch(watchLibrarySpaces());
    await fake.reply('library.list', answer());
    await fake.reply('library.list', answer(row(1)));
    await fake.reply('library.get', { row: row(1) });
    await fake.reply('library.spaces', { spaces: [space(1)] });
    offHtml();
    fake.event('library.changed', { revision: 5 });
    expect(fake.invoked('library.list').slice(2)).toEqual([{ filter: { kind: 'file' } }]);
    expect(fake.invoked('library.get')).toEqual([{ artifactId: id(1) }, { artifactId: id(1) }]);
    expect(fake.invoked('library.spaces')).toHaveLength(2);
    await fake.reply('library.list', answer());
    await fake.reply('library.get', { row: null }); // deleted
    await fake.reply('library.spaces', { spaces: [] });
    expect(libraryRow(state(), id(1))).toMatchObject({ status: 'ready', value: null });
    expect(librarySpaces(state()).value).toEqual([]);
  });

  it('refreshLibrary reads every watched read again (a Retry)', async () => {
    watch(watchLibraryRow(id(1)));
    await fake.fail('library.get', 'timeout');
    expect(libraryRow(state(), id(1))).toMatchObject({ status: 'error', error: 'timeout', value: undefined });
    refreshLibrary();
    await fake.reply('library.get', { row: row(1) });
    expect(libraryRow(state(), id(1)).value?.title).toBe('Page 1');
  });
});

describe('a read nobody watches', () => {
  it('is kept to show at once when watched again, and read again then', async () => {
    const off = watchLibraryRow(id(1));
    await fake.reply('library.get', { row: row(1) });
    off();
    fake.event('library.changed', { revision: 2 });
    expect(fake.pending('library.get'), 'unwatched: not refreshed').toBe(0);
    watch(watchLibraryRow(id(1)));
    expect(libraryRow(state(), id(1))).toMatchObject({ status: 'reading' });
    expect(libraryRow(state(), id(1)).value?.title, 'the kept answer, shown while it is read again').toBe('Page 1');
    await fake.reply('library.get', { row: row(1, { title: 'Renamed' }) });
    expect(libraryRow(state(), id(1)).value?.title).toBe('Renamed');
  });

  it('is forgotten past the cap, oldest first', async () => {
    for (let n = 1; n <= UNWATCHED_KEPT + 1; n++) {
      const off = watchLibraryRow(id(n));
      await fake.reply('library.get', { row: row(n) });
      off();
    }
    expect(state().reads.has(`row:${id(1)}`)).toBe(false);
    expect(state().reads.has(`row:${id(2)}`)).toBe(true);
    expect(state().reads.size).toBe(UNWATCHED_KEPT);
  });

  it('an answer landing after its last watcher left is still kept', async () => {
    const off = watchLibraryList();
    off();
    await fake.reply('library.list', answer(row(1)));
    expect(libraryList(state()).value?.rows).toHaveLength(1);
  });
});
