// Files' tree at the file's left (UX wave U6b-1, docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, M3,
// Interfaces §C): where the tree goes in a tab (`treePlace`, the owner's answer on card R8: the tree in the file's place),
// and the session's one tree state, read once from `files.tree` and written 250 ms after the last act.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_TREE_EXPANDED_MAX } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../../../test/support/machine';
import { useMachines } from '../../../stores/machines';
import { useSetup } from '../../../sessions/store';
import { createTreeStateStore, FILE_WIDTH_MIN, knownSession, treeOf, treePlace, TREE_WIDTH_DEFAULT, type TreePlace } from './tree-state';

const A = at('app-a') as AppSessionId;
const B = at('app-b') as AppSessionId;
const DELAY = 250;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const stored = (sessions: Record<string, { width: number | null; folded: boolean; expanded: string[] }>) => ({ version: 1, sessions });

describe('treePlace: the tree at the file’s left, and in the file’s place when the tab is too narrow for both', () => {
  const W = TREE_WIDTH_DEFAULT;
  const cases: [string, Parameters<typeof treePlace>[0], TreePlace][] = [
    ['no file: the tree alone, however narrow', { holdsFile: false, tabWidth: 100, treeWidth: W, folded: false, shown: false }, 'alone'],
    ['no file: the tree alone, folded or shown', { holdsFile: false, tabWidth: 900, treeWidth: W, folded: true, shown: true }, 'alone'],
    ['room for both, exactly: beside', { holdsFile: true, tabWidth: W + FILE_WIDTH_MIN, treeWidth: W, folded: false, shown: false }, 'beside'],
    ['room for both, folded by the person: folded', { holdsFile: true, tabWidth: W + FILE_WIDTH_MIN, treeWidth: W, folded: true, shown: false }, 'folded'],
    ['room for both: the narrow button changes nothing', { holdsFile: true, tabWidth: 900, treeWidth: W, folded: false, shown: true }, 'beside'],
    ['room for both, folded, shown: still folded (the stored choice)', { holdsFile: true, tabWidth: 900, treeWidth: W, folded: true, shown: true }, 'folded'],
    ['one pixel short: folded', { holdsFile: true, tabWidth: W + FILE_WIDTH_MIN - 1, treeWidth: W, folded: false, shown: false }, 'folded'],
    ['one pixel short, the button pressed: in the file’s place', { holdsFile: true, tabWidth: W + FILE_WIDTH_MIN - 1, treeWidth: W, folded: false, shown: true }, 'instead'],
    ['narrow, folded, the button pressed: in the file’s place', { holdsFile: true, tabWidth: 300, treeWidth: W, folded: true, shown: true }, 'instead'],
    ['a wider tree needs a wider tab: beside at its threshold', { holdsFile: true, tabWidth: 300 + FILE_WIDTH_MIN, treeWidth: 300, folded: false, shown: false }, 'beside'],
    ['a wider tree, one pixel short: folded', { holdsFile: true, tabWidth: 300 + FILE_WIDTH_MIN - 1, treeWidth: 300, folded: false, shown: false }, 'folded'],
  ];
  it.each(cases)('%s', (_, input, place) => expect(treePlace(input)).toBe(place));
});

describe('the session’s tree state', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads files.tree once, at first use, and a relaunch finds each session’s width, fold and open folders', async () => {
    const fake = fakeClient({ 'layout.get': { value: stored({ [A]: { width: 300, folded: true, expanded: ['/r', '/r/src'] } }) } });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    expect(store.getState().loaded).toBe(false);
    expect(fake.invoked('layout.get')).toEqual([]);
    await Promise.all([store.getState().load(), store.getState().load()]);
    expect(fake.invoked('layout.get')).toEqual([{ key: 'files.tree' }]);
    expect(store.getState().loaded).toBe(true);
    const tree = treeOf(store.getState(), A);
    expect([tree.width, tree.folded, [...tree.expanded]]).toEqual([300, true, ['/r', '/r/src']]);
    expect(treeOf(store.getState(), B)).toMatchObject({ width: null, folded: false, expanded: new Set() }); // a session never stored: the defaults
  });

  it('ignores a stored value of another version or shape, every session at its defaults', async () => {
    const good = { width: 300, folded: true, expanded: ['/r'] };
    const bad = [
      { version: 2, sessions: { [A]: good } },
      { version: 1, sessions: { [A]: { ...good, scrollTop: 40 } } },
      { version: 1, sessions: { [A]: { ...good, width: 300.5 } } },
      { version: 1, sessions: { [A]: { ...good, folded: 'yes' } } },
      { version: 1, sessions: { [A]: { ...good, expanded: Array.from({ length: FILES_TREE_EXPANDED_MAX + 1 }, (_, i) => `/r/d${i}`) } } },
      [good],
    ];
    for (const value of bad) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = createTreeStateStore(fakeClient({ 'layout.get': { value } }).client, { writeDelayMs: DELAY, knows: () => true });
      await store.getState().load();
      const tree = treeOf(store.getState(), A);
      expect([tree.width, tree.folded, [...tree.expanded]], JSON.stringify(value).slice(0, 80)).toEqual([null, false, []]);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    }
  });

  it('writes the whole value 250 ms after the last act and at once when the page unloads; the first root’s own opening writes nothing', async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    await store.getState().load();
    vi.useFakeTimers();
    store.getState().firstRoot(A, '/r');
    vi.advanceTimersByTime(DELAY * 4);
    expect(fake.invoked('layout.set')).toEqual([]);
    expect([...treeOf(store.getState(), A).expanded]).toEqual(['/r']);
    store.getState().toggle(A, '/r/src');
    vi.advanceTimersByTime(DELAY - 100);
    store.getState().setWidth(A, 260);
    vi.advanceTimersByTime(DELAY - 1);
    expect(fake.invoked('layout.set')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fake.invoked('layout.set')).toEqual([{ key: 'files.tree', value: stored({ [A]: { width: 260, folded: false, expanded: ['/r', '/r/src'] } }) }]);
    store.getState().setFolded(A, true);
    window.dispatchEvent(new Event('beforeunload'));
    expect(fake.invoked('layout.set')).toHaveLength(2);
    expect(fake.invoked('layout.set')[1]).toEqual({ key: 'files.tree', value: stored({ [A]: { width: 260, folded: true, expanded: ['/r', '/r/src'] } }) });
    vi.advanceTimersByTime(DELAY * 4);
    expect(fake.invoked('layout.set')).toHaveLength(2); // the unload's write was the pending one
  });

  it('writes the two hundred folders opened last, a folder opened again counting as newest, and keeps them all open while it runs', async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    await store.getState().load();
    vi.useFakeTimers();
    const paths = Array.from({ length: FILES_TREE_EXPANDED_MAX + 5 }, (_, i) => `/r/d${String(i).padStart(3, '0')}`);
    for (const path of paths) store.getState().toggle(A, path);
    store.getState().toggle(A, paths[0]); // closed
    store.getState().toggle(A, paths[0]); // and opened again: the newest
    vi.advanceTimersByTime(DELAY);
    const written = (fake.invoked('layout.set')[0] as { value: { sessions: Record<string, { expanded: string[] }> } }).value.sessions[A].expanded;
    expect(written).toEqual([...paths.slice(6), paths[0]]);
    expect(written).toHaveLength(FILES_TREE_EXPANDED_MAX);
    expect(treeOf(store.getState(), A).expanded.size).toBe(paths.length);
  });

  // M3's review: a width measured in fractional pixels must not reach the stored value, whose schema takes whole numbers
  // (a refused read gives every session its defaults)
  it('stores a width as a whole number, and never writes a value its schema would refuse', async () => {
    const fake = fakeClient({ 'layout.get': { value: stored({ [B]: { width: 400, folded: true, expanded: ['/r'] } }) }, 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    await store.getState().load();
    vi.useFakeTimers();
    store.getState().setWidth(A, 380.5);
    vi.advanceTimersByTime(DELAY);
    const written = (fake.invoked('layout.set')[0] as { value: unknown }).value;
    expect(written).toEqual(stored({ [B]: { width: 400, folded: true, expanded: ['/r'] }, [A]: { width: 381, folded: false, expanded: [] } }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.getState().setWidth(A, Number.NaN);
    vi.advanceTimersByTime(DELAY);
    expect(fake.invoked('layout.set')).toHaveLength(1); // not written
    expect(error).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    const again = createTreeStateStore(fakeClient({ 'layout.get': { value: written } }).client, { writeDelayMs: DELAY, knows: () => true });
    await again.getState().load();
    expect([treeOf(again.getState(), A).width, treeOf(again.getState(), B)]).toMatchObject([381, { width: 400, folded: true, expanded: new Set(['/r']) }]);
  });

  it('drops at a write a session the window no longer knows', async () => {
    const fake = fakeClient({ 'layout.get': { value: stored({ [A]: { width: null, folded: false, expanded: ['/r'] }, [B]: { width: 400, folded: false, expanded: [] } }) }, 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: (id) => id !== B });
    await store.getState().load();
    vi.useFakeTimers();
    store.getState().setWidth(A, 200);
    vi.advanceTimersByTime(DELAY);
    expect(fake.invoked('layout.set')).toEqual([{ key: 'files.tree', value: stored({ [A]: { width: 200, folded: false, expanded: ['/r'] } }) }]);
    expect(store.getState().trees.has(B)).toBe(false);
  });

  it('draws an act made before the read answered at once, applies it over what the read brings, and writes only after the read', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: 1, knows: () => true });
    const loading = store.getState().load();
    store.getState().setFolded(A, true);
    expect(treeOf(store.getState(), A).folded).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.invoked('layout.set')).toEqual([]);
    await fake.reply('layout.get', { value: stored({ [A]: { width: 300, folded: false, expanded: ['/r'] }, [B]: { width: 400, folded: false, expanded: [] } }) });
    await loading;
    expect(treeOf(store.getState(), A)).toMatchObject({ width: 300, folded: true, expanded: new Set(['/r']) });
    expect(treeOf(store.getState(), B).width).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.invoked('layout.set')).toEqual([{ key: 'files.tree', value: stored({ [A]: { width: 300, folded: true, expanded: ['/r'] }, [B]: { width: 400, folded: false, expanded: [] } }) }]);
  });

  it('a refused read leaves every session at its defaults and the tree drawn', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient();
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    const loading = store.getState().load();
    await fake.fail('layout.get', 'the layout file could not be read');
    await loading;
    expect(store.getState().loaded).toBe(true);
    expect(treeOf(store.getState(), A).width).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('opens a session’s first root once; after a relaunch it only notes it, so a deliberate collapse stands; a new first root opens', async () => {
    const fake = fakeClient({ 'layout.get': { value: stored({ [A]: { width: null, folded: false, expanded: [] } }) } });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    await store.getState().load();
    store.getState().firstRoot(A, '/r');
    expect([...treeOf(store.getState(), A).expanded]).toEqual([]); // restored: the person had closed it
    store.getState().firstRoot(B, '/r');
    expect([...treeOf(store.getState(), B).expanded]).toEqual(['/r']); // never stored: opened once
    store.getState().toggle(B, '/r');
    store.getState().firstRoot(B, '/r');
    expect([...treeOf(store.getState(), B).expanded]).toEqual([]); // once only
    store.getState().firstRoot(A, '/wt');
    expect([...treeOf(store.getState(), A).expanded]).toEqual(['/wt']); // a worktree that replaced the directory
    await settle();
  });

  it('keeps the selection and the scroll offset for this run only, apart from what it writes', async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: () => true });
    await store.getState().load();
    vi.useFakeTimers();
    store.getState().select(A, '/r/src/app.ts');
    store.getState().scrolled(A, 120);
    vi.advanceTimersByTime(DELAY * 4);
    expect(fake.invoked('layout.set')).toEqual([]);
    expect(treeOf(store.getState(), A)).toMatchObject({ selected: '/r/src/app.ts', scrollTop: 120 });
    store.getState().toggle(A, '/r');
    vi.advanceTimersByTime(DELAY);
    expect(fake.invoked('layout.set')).toEqual([{ key: 'files.tree', value: stored({ [A]: { width: null, folded: false, expanded: ['/r'] } }) }]);
  });
});

// The branch review's first finding: an unstarted chat has no record yet, only its setup intent; the window knows it, so
// a write keeps its tree.
describe('the sessions the window knows', () => {
  const U = at('app-unstarted') as AppSessionId;
  afterEach(() => {
    vi.useRealTimers();
    useMachines.setState({ loaded: new Set() });
    useSetup.setState({ intents: new Map() });
  });

  it('an unstarted chat, known by its setup intent alone, keeps its tree at a write of another session’s', async () => {
    useMachines.setState({ loaded: new Set([TEST_MACHINE]) });
    useSetup.getState().applyIntents([{ appSessionId: U, location: null, additionalDirectories: [], updatedAt: '2026-11-15T10:00:00.000Z', progress: { worktree: null } } as never]);
    const fake = fakeClient({ 'layout.get': { value: stored({ [U]: { width: 300, folded: true, expanded: ['/u'] } }) }, 'layout.set': undefined });
    const store = createTreeStateStore(fake.client, { writeDelayMs: DELAY, knows: knownSession });
    await store.getState().load();
    vi.useFakeTimers();
    store.getState().setWidth(U, 310);
    vi.advanceTimersByTime(DELAY);
    expect(fake.invoked('layout.set')).toEqual([{ key: 'files.tree', value: stored({ [U]: { width: 310, folded: true, expanded: ['/u'] } }) }]);
  });
});
