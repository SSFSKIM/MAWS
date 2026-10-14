import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type LayoutMain, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore, LAYOUT_WRITE_DELAY_MS, persistLayout, type ProjectOf } from './layout';
import { currentSet } from './layout-model';

const A = 'app-a' as AppSessionId;

// A store persisting through a fake main whose layout.json holds the three fixed keys at their defaults, then `values`
// (an `undefined` value leaves that key out).
function setup(given: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { regions: LAYOUT_DEFAULTS.regions, 'main.tabs': LAYOUT_DEFAULTS.main, 'panel.pinned': [], ...given };
  const fake = fakeClient({
    'layout.list': { keys: Object.keys(values) },
    'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }),
    'layout.set': undefined,
  });
  const store = createLayoutStore();
  const stop = persistLayout(fake.client, store);
  running.push(stop);
  const hydrate = async (known: (id: AppSessionId) => boolean = () => true, projectOf?: ProjectOf) => {
    const hydrating = store.getState().hydrate(fake.client, known, { projectOf });
    await vi.runAllTimersAsync();
    await hydrating;
  };
  return { store, stop, hydrate, sets: () => fake.invoked('layout.set') as { key: string; value: unknown }[] };
}

// Every persistence installed by a test, stopped after it (its beforeunload listener and timers must not leak).
const running: (() => void)[] = [];

describe('layout persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });

  it('writes nothing before hydration, and hydration writes only the keys layout.json lacks and those changed meanwhile', async () => {
    const regions = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 410, sort: 'recency' as const } };
    const { store, hydrate, sets } = setup({ regions, 'main.tabs': undefined });
    store.getState().setSidebar({ width: 260 }); // the persisted value is not known yet: writing now would clobber it
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([]);
    await hydrate();
    vi.advanceTimersByTime(1000);
    // W5: the change is replayed over the persisted regions (as a tab opened early is over the tabs) and written once
    const replayed = { ...regions, sidebar: { ...regions.sidebar, width: 260 } };
    expect(sets()).toEqual([{ key: 'main.tabs', value: LAYOUT_DEFAULTS.main }, { key: 'regions', value: replayed }]); // a first launch materialises the default
    expect(store.getState().regions).toEqual(replayed);
  });

  it('writes tabs opened before hydration over an existing main.tabs, before any later change and on beforeunload', async () => {
    const tabs: TabRef[] = [{ id: 'diagnostics', kind: 'diagnostics', pinned: false }, { id: 'settings', kind: 'settings', section: null, pinned: false }];
    const saved: LayoutMain = { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: 'diagnostics' }] } } };
    const { store, hydrate, sets } = setup({ 'main.tabs': saved });
    store.getState().openSession(A); // a sidebar click or a notification navigation racing the first layout.get
    await hydrate((id) => id === A);
    window.dispatchEvent(new Event('beforeunload'));
    const written = sets().filter((s) => s.key === 'main.tabs');
    expect(written).toHaveLength(1);
    expect(currentSet(written[0].value as LayoutMain).panes[0].tabs.map((t) => t.id)).toEqual(['diagnostics', `session:${A}`, 'settings']); // opened after the saved active tab, over the saved tabs
    expect(written[0].value).toBe(store.getState().main);
  });

  // W12: a version-1 main.tabs is filed by project at hydration (`projectOf`: the record's project, else the unstarted
  // intent's) and written back as version 2 at once; an unknown session's tab is dropped.
  it('reads a version-1 main.tabs into a tab set per project and writes version 2 back', async () => {
    const X = 'proj-x' as ProjectId;
    const Y = 'proj-y' as ProjectId;
    const tab = (id: string): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id as AppSessionId, pinned: false });
    const diagnostics: TabRef = { id: 'diagnostics', kind: 'diagnostics', pinned: false };
    const v1 = {
      version: 1,
      panes: [
        { tabs: [tab('x1'), tab('y1'), diagnostics, tab('gone')], activeTabId: 'session:y1' },
        { tabs: [tab('new'), tab('x2')], activeTabId: 'session:new' },
      ],
      focusedPane: 0,
      splitRatio: 0.4,
      closedTabs: [tab('x3')],
    };
    // x1, x2, x3 in X and y1 in Y have records; `new` is an unstarted chat whose intent chose Y; `gone` is unknown
    const projects: Record<string, ProjectId | null> = { x1: X, x2: X, x3: X, y1: Y, new: Y };
    const { store, hydrate, sets } = setup({ 'main.tabs': v1 });
    await hydrate((id) => id in projects, (id) => projects[id] ?? null);
    const main = store.getState().main;
    expect(main.current).toBe(Y); // the shown tab's project
    expect(main.sets).toEqual({
      [Y]: { panes: [{ tabs: [tab('y1'), diagnostics], activeTabId: 'session:y1' }, { tabs: [tab('new')], activeTabId: 'session:new' }], focusedPane: 0, splitRatio: 0.4 },
      [X]: { panes: [{ tabs: [tab('x1')], activeTabId: 'session:x1' }, { tabs: [tab('x2')], activeTabId: 'session:x2' }], focusedPane: 0, splitRatio: 0.4 },
    });
    expect(main.closedTabs).toEqual([tab('x3')]);
    expect(sets()).toEqual([{ key: 'main.tabs', value: main }]);
    // the next launch reads version 2 as it is and writes nothing
    const again = setup({ 'main.tabs': main });
    await again.hydrate((id) => id in projects, (id) => projects[id] ?? null);
    expect(again.store.getState().main).toEqual(main);
    vi.advanceTimersByTime(1000);
    expect(again.sets()).toEqual([]);
  });

  // P3-L (M3): the `artifact` tab kind is written to main.tabs and read back by the next launch as it was.
  it('writes an artifact tab to main.tabs and reads it back at the next launch, pinned and active', async () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().openTab({ kind: 'artifact', artifactId });
    store.getState().togglePinned(`artifact:${artifactId}`);
    vi.advanceTimersByTime(1000);
    const written = sets().filter((s) => s.key === 'main.tabs').at(-1)!.value as LayoutMain;
    expect(currentSet(written).panes[0]).toEqual({ tabs: [{ id: `artifact:${artifactId}`, kind: 'artifact', artifactId, pinned: true }], activeTabId: `artifact:${artifactId}` });
    const again = setup({ 'main.tabs': JSON.parse(JSON.stringify(written)) });
    await again.hydrate();
    expect(again.store.getState().main).toEqual(written);
  });

  it('writes nothing for hydration alone when layout.json holds every key', async () => {
    const { hydrate, sets } = setup();
    await hydrate();
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('beforeunload'));
    expect(sets()).toEqual([]);
  });

  it('a key that failed to read is not overwritten with its default', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient({ 'layout.list': { keys: [] }, 'layout.get': ({ key }: { key: string }) => ({ value: key === 'regions' ? LAYOUT_DEFAULTS.regions : [] }), 'layout.set': undefined });
    const failing = { ...fake.client, invoke: (name: never, input: never) => (name === 'layout.get' && (input as { key: string }).key === 'main.tabs' ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'x' } }) : fake.client.invoke(name, input)) } as typeof fake.client;
    const store = createLayoutStore();
    await store.getState().hydrate(failing, () => true);
    expect(fake.invoked('layout.set')).toEqual([]);
    error.mockRestore();
  });

  it('sends only the changed key, 250 ms after its last change', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().setSidebar({ width: 260 });
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS - 50);
    store.getState().setSidebar({ width: 240 });
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS - 1);
    expect(sets()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sets()).toEqual([{ key: 'regions', value: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 240 } } }]);
  });

  it('opening Overview restores and persists only the regions, with the normal write delay', async () => {
    const regions = { ...LAYOUT_DEFAULTS.regions, panel: { width: 444, collapsed: false, maximized: true, floating: false } };
    const { store, hydrate, sets } = setup({ regions });
    await hydrate();
    store.getState().setOverviewOpen(true);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS - 1);
    expect(sets()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sets()).toEqual([{ key: 'regions', value: { ...regions, panel: { ...regions.panel, maximized: false } } }]);
    store.getState().setOverviewOpen(false);
    store.getState().setOverviewOpen(true);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets()).toHaveLength(1); // open/close stays transient when no region needs restoring
  });

  it('debounces each key on its own', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().setPanel({ collapsed: true });
    vi.advanceTimersByTime(200);
    store.getState().openTab({ kind: 'diagnostics' });
    vi.advanceTimersByTime(50);
    expect(sets().map((s) => s.key)).toEqual(['regions']);
    vi.advanceTimersByTime(200);
    expect(sets().map((s) => s.key)).toEqual(['regions', 'main.tabs']);
  });

  it('writes the global pins and a session’s own panel tabs to their keys', async () => {
    const { store, hydrate, sets } = setup({ 'panel.app-a': { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' } });
    await hydrate((id) => id === A);
    store.getState().setPanelTabPinned(A, 't1', true);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets()).toEqual([
      { key: 'panel.pinned', value: [{ id: 't1', toolId: 'files', pinned: true }] },
      { key: 'panel.app-a', value: { tabs: [], activeTabId: 't1' } },
    ]);
  });

  it('drops a pending write of a removed session’s panel key, which main deletes', async () => {
    const { store, hydrate, sets } = setup({ 'panel.app-a': { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' } });
    await hydrate((id) => id === A);
    store.getState().updatePanelTabs(A, (refs) => [...refs, { id: 't2', toolId: 'terminal', pinned: false }]);
    store.getState().dropSession(A); // session.removed before the write went out
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('beforeunload'));
    expect(sets().filter((s) => s.key.startsWith('panel.'))).toEqual([]);
  });

  it('flushes a pending write on beforeunload', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().setSidebar({ collapsed: true });
    window.dispatchEvent(new Event('beforeunload'));
    expect(sets().map((s) => s.key)).toEqual(['regions']);
    vi.advanceTimersByTime(1000);
    expect(sets()).toHaveLength(1); // flushed, not written twice
  });

  it('never writes the transient no-session selection', async () => {
    const { store, hydrate, sets } = setup({ 'panel.pinned': [{ id: 'p1', toolId: 'terminal', pinned: true }, { id: 'p2', toolId: 'files', pinned: true }] });
    await hydrate();
    store.getState().setPanelTabs(null, { tabs: store.getState().panelPinned, activeTabId: 'p2' });
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([]);
  });

  it('flushes on stop and then stops listening', async () => {
    const { store, hydrate, sets, stop } = setup();
    await hydrate();
    store.getState().setSidebar({ width: 222 });
    stop();
    expect(sets()).toHaveLength(1);
    store.getState().setSidebar({ width: 333 });
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('beforeunload'));
    expect(sets()).toHaveLength(1);
  });
});

describe('panel tabs from the host', () => {
  it('splits the pinned refs into panel.pinned and the rest into the session’s own key', () => {
    const store = createLayoutStore();
    store.getState().setPanelTabs(A, {
      tabs: [
        { id: 'p', toolId: 'terminal', pinned: true },
        { id: 'o', toolId: 'files', pinned: false },
      ],
      activeTabId: 'o',
    });
    expect(store.getState().panelPinned).toEqual([{ id: 'p', toolId: 'terminal', pinned: true }]);
    expect(store.getState().panelBySession.get(A)).toEqual({ tabs: [{ id: 'o', toolId: 'files', pinned: false }], activeTabId: 'o' });
    expect(store.getState().effectivePanelTabs(A).map((t) => t.id)).toEqual(['p', 'o']);
  });

  it('with no session keeps the pins and a transient selection among them', () => {
    const store = createLayoutStore();
    const p1 = { id: 'p1', toolId: 'terminal', pinned: true };
    const p2 = { id: 'p2', toolId: 'files', pinned: true };
    store.getState().setPanelTabs(null, { tabs: [p1, p2], activeTabId: 'p2' });
    expect(store.getState().panelActiveNoSession).toBe('p2');
    store.getState().setPanelTabs(null, { tabs: [p1, p2, { id: 'o', toolId: 'x', pinned: false }], activeTabId: 'o' });
    expect(store.getState().panelActiveNoSession).toBe('p2'); // an unpinned tab has nowhere to live without a session
  });

  it('revalidates the no-session selection whenever the pins change', () => {
    const store = createLayoutStore();
    const pin = (id: string) => ({ id, toolId: 'files', pinned: true });
    store.getState().setPanelTabs(null, { tabs: [pin('p1'), pin('p2'), pin('p3')], activeTabId: 'p2' });
    // Unpinned from a session's panel: p2 leaves the pins, and its right neighbour takes the selection.
    store.getState().setPanelTabPinned(A, 'p2', false);
    expect(store.getState().panelPinned.map((t) => t.id)).toEqual(['p1', 'p3']);
    expect(store.getState().panelActiveNoSession).toBe('p3');
    store.getState().setPanelTabPinned(A, 'p3', false);
    expect(store.getState().panelActiveNoSession).toBe('p1'); // no right neighbour: the last remaining pin
    store.getState().setPanelTabPinned(A, 'p1', false);
    expect(store.getState().panelActiveNoSession).toBeNull();
  });

  it('with no session keeps only the pins', () => {
    const store = createLayoutStore();
    store.getState().setPanelTabs(null, { tabs: [{ id: 'p', toolId: 'terminal', pinned: true }, { id: 'o', toolId: 'files', pinned: false }], activeTabId: 'p' });
    expect(store.getState().panelPinned.map((t) => t.id)).toEqual(['p']);
    expect(store.getState().panelBySession.size).toBe(0);
  });
});

// C8's eleventh ask: a session's panel refs read and written while another session, or none, is on screen.
describe('panel tabs of a session not on screen', () => {
  const B = 'app-b' as AppSessionId;
  const terminal = { id: 'term-1', toolId: 'terminal', pinned: false };
  const files = { id: 'files-1', toolId: 'files', pinned: false };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });

  it('adds a ref to session A while B is shown, persists it to panel.<A>, and reads it back after switching to A', async () => {
    const { store, hydrate, sets } = setup({ 'panel.app-a': { tabs: [files], activeTabId: 'files-1' } });
    await hydrate((id) => id === A || id === B);
    store.getState().openSession(B);
    store.getState().updatePanelTabs(A, (refs) => [...refs, terminal]);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets().filter((s) => s.key.startsWith('panel.'))).toEqual([{ key: 'panel.app-a', value: { tabs: [files, terminal], activeTabId: 'files-1' } }]);
    expect(store.getState().panelTabsOf(B)).toEqual([]);
    store.getState().openSession(A);
    expect(store.getState().panelTabsOf(A)).toEqual([files, terminal]);
    expect(store.getState().effectivePanelTabs(A)).toEqual([files, terminal]);
  });

  it('reads the pins first and files a pinned ref to panel.pinned, with no session on screen', async () => {
    const pin = { id: 'p1', toolId: 'review', pinned: true };
    const { store, hydrate, sets } = setup({ 'panel.pinned': [pin] });
    await hydrate();
    let given: unknown = null;
    store.getState().updatePanelTabs(A, (refs) => {
      given = refs;
      return [...refs, { ...terminal, pinned: true }, files];
    });
    expect(given).toEqual([pin]);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets()).toEqual([
      { key: 'panel.pinned', value: [pin, { ...terminal, pinned: true }] },
      { key: 'panel.app-a', value: { tabs: [files], activeTabId: null } },
    ]);
    expect(store.getState().panelTabsOf(B).map((t) => t.id)).toEqual(['p1', 'term-1']); // a pin shows for every session
  });

  it('selects a requested tab, keeps a surviving selection, and moves a removed one to its neighbour', () => {
    const store = createLayoutStore();
    store.getState().updatePanelTabs(A, () => [files, terminal], { activeTabId: 'term-1' });
    expect(store.getState().panelBySession.get(A)?.activeTabId).toBe('term-1');
    store.getState().updatePanelTabs(A, (refs) => [...refs, { id: 'x', toolId: 'x', pinned: false }]);
    expect(store.getState().panelBySession.get(A)?.activeTabId).toBe('term-1');
    store.getState().updatePanelTabs(A, (refs) => refs.filter((t) => t.id !== 'term-1'));
    expect(store.getState().panelBySession.get(A)?.activeTabId).toBe('x');
  });

  it('revalidates the no-session pin selection when it drops a pin', () => {
    const store = createLayoutStore();
    const pin = (id: string) => ({ id, toolId: 'files', pinned: true });
    store.getState().setPanelTabs(null, { tabs: [pin('p1'), pin('p2'), pin('p3')], activeTabId: 'p2' });
    store.getState().updatePanelTabs(A, (refs) => refs.filter((t) => t.id !== 'p2'));
    expect(store.getState().panelPinned.map((t) => t.id)).toEqual(['p1', 'p3']);
    expect(store.getState().panelActiveNoSession).toBe('p3');
  });
});
