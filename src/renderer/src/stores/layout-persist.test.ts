import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type LayoutMain, type LayoutRegions, type PanelSurfaces, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore, LAYOUT_WRITE_DELAY_MS, persistLayout, type ProjectOf } from './layout';
import { currentSet } from './layout-model';

const A = 'app-a' as AppSessionId;
const surfaceState = (contexts: PanelSurfaces['contexts'] = {}): PanelSurfaces => ({ version: 1, stacks: {}, pinnedTools: [], contexts });

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

  // l1-sessions-13 review: main's inactivity sweep keeps the sessions `main.tabs` holds open, so an opening cannot wait
  // for the write delay; a closing can (main keeping a closed tab's session a moment longer archives nothing wrongly).
  it('writes a session or agent tab’s opening at once, and its closing after the delay', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    const written = () => sets().filter((s) => s.key === 'main.tabs').map((s) => s.value as LayoutMain);
    store.getState().openTab({ kind: 'diagnostics' });
    expect(written()).toEqual([]); // no session joined: the delay as before
    store.getState().openTab({ kind: 'session', appSessionId: A });
    expect(written()).toHaveLength(1);
    expect(written()[0]).toBe(store.getState().main);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS * 2);
    expect(written()).toHaveLength(1); // the pending diagnostics write went out with it
    store.getState().openTab({ kind: 'agent', appSessionId: 'app-b' as AppSessionId, agentId: 'agent-1' as AgentId });
    expect(written()).toHaveLength(2);
    store.getState().closeTab(`session:${A}`);
    expect(written()).toHaveLength(2);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(written()).toHaveLength(3);
    expect(written()[2]).toBe(store.getState().main);
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
    expect(sets()).toEqual([
      { key: 'main.tabs', value: main },
      { key: 'panelTools.surfaces', value: surfaceState({ [Y]: 'y1' as AppSessionId }) },
    ]);
    // the next launch reads version 2 and the remembered surface context as they are and writes nothing
    const again = setup({ 'main.tabs': main, 'panelTools.surfaces': store.getState().panelSurfaces });
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

  // P4-B3 (X37; its Decision Log 1): a floating split is written beside its ratio and comes back floating at the next
  // launch; docked again, the value is byte-identical to the one it floated from.
  it('writes a floating split to main.tabs, reads it back floating, and docks to the value it left', async () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().openTab({ kind: 'artifact', artifactId });
    store.getState().openSession(A, { split: true });
    store.getState().setSplitRatio(0.4);
    vi.advanceTimersByTime(1000);
    const before = JSON.stringify(sets().at(-1)!.value);
    store.getState().floatSplit(`session:${A}`);
    vi.advanceTimersByTime(1000);
    const floating = sets().at(-1)!.value as LayoutMain;
    expect(currentSet(floating)).toMatchObject({ floating: { sessionTabId: `session:${A}` }, splitRatio: 0.4 });
    const again = setup({ 'main.tabs': JSON.parse(JSON.stringify(floating)) });
    await again.hydrate();
    expect(again.store.getState().main).toEqual(floating); // relaunch restores the float
    store.getState().dockSplit();
    vi.advanceTimersByTime(1000);
    expect(JSON.stringify(sets().at(-1)!.value)).toBe(before);
  });

  // P4-B3x (P4 Decision Log 40): Expand's fold persists as its float does, so leaving Expand after a relaunch opens the
  // panel it folded; hydration keeps the rule between the two keys.
  describe('Expand’s fold of the right panel', () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';
    const S = `session:${A}`;
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const last = (sets: { key: string; value: unknown }[], key: string) => sets.filter((s) => s.key === key).at(-1)?.value;
    // layout.json after a launch: what it held, then each write in order.
    const after = (held: Record<string, unknown>, sets: { key: string; value: unknown }[]) => clone({ ...held, ...Object.fromEntries(sets.map((s) => [s.key, s.value])) });
    const expanded = async () => {
      const { store, hydrate, sets } = setup();
      await hydrate();
      store.getState().openTab({ kind: 'artifact', artifactId });
      store.getState().openSession(A, { split: true });
      vi.advanceTimersByTime(1000);
      store.getState().floatSplit(S, { foldPanel: true });
      vi.advanceTimersByTime(1000);
      return { main: last(sets(), 'main.tabs') as LayoutMain, regions: last(sets(), 'regions') as LayoutRegions };
    };

    it('writes the fold on the float and the folded panel, reads both back, and leaving Expand then opens the panel', async () => {
      const { main, regions } = await expanded();
      expect(currentSet(main).floating).toEqual({ sessionTabId: S, foldedPanel: true });
      expect(regions.panel).toEqual({ ...LAYOUT_DEFAULTS.regions.panel, collapsed: true });
      const again = setup({ 'main.tabs': clone(main), regions: clone(regions) });
      await again.hydrate();
      expect([again.store.getState().main, again.store.getState().regions]).toEqual([main, regions]);
      expect(again.sets(), 'only the additive surface context is materialized').toEqual([{ key: 'panelTools.surfaces', value: surfaceState({ [NO_PROJECT]: A }) }]);
      again.store.getState().dockSplit();
      vi.advanceTimersByTime(1000);
      expect((last(again.sets(), 'regions') as LayoutRegions).panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
      expect(currentSet(last(again.sets(), 'main.tabs') as LayoutMain).floating).toBeUndefined();
    });

    it('a stored fold whose float the reader drops (its session gone) opens the panel, both written back', async () => {
      const { main, regions } = await expanded();
      const held = { 'main.tabs': clone(main), regions: clone(regions) };
      const again = setup(held);
      await again.hydrate(() => false);
      expect(currentSet(again.store.getState().main).floating).toBeUndefined();
      expect(again.store.getState().regions.panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
      expect((last(again.sets(), 'regions') as LayoutRegions).panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
      expect(last(again.sets(), 'main.tabs'), 'main.tabs written back without the fold').toEqual(again.store.getState().main);
      // the owner closes the panel and quits with no tab change: the launch after keeps it closed
      const written = after(held, again.sets());
      const third = setup(written);
      await third.hydrate(() => false);
      third.store.getState().setPanel({ collapsed: true });
      vi.advanceTimersByTime(1000);
      const fourth = setup(after(written, third.sets()));
      await fourth.hydrate(() => false);
      expect(fourth.store.getState().regions.panel.collapsed).toBe(true);
    });

    it('a panel opened and closed again before hydration lands drops the stored fold, so leaving Expand leaves it closed', async () => {
      const { main, regions } = await expanded();
      const held = { 'main.tabs': clone(main), regions: clone(regions) };
      const again = setup(held);
      again.store.getState().setPanel({ maximized: true }); // Maximize, then the toggle, racing the first layout.get
      again.store.getState().setPanel({ collapsed: true });
      await again.hydrate();
      expect(currentSet(again.store.getState().main).floating).toEqual({ sessionTabId: S });
      expect(last(again.sets(), 'main.tabs'), 'main.tabs written back without the fold').toEqual(again.store.getState().main);
      again.store.getState().dockSplit();
      expect(again.store.getState().regions.panel.collapsed).toBe(true);
      // with its session gone the reader drops the float too, and the panel stays as the owner left it
      const gone = setup(held);
      gone.store.getState().setPanel({ maximized: true });
      gone.store.getState().setPanel({ collapsed: true });
      await gone.hydrate(() => false);
      expect(gone.store.getState().regions.panel.collapsed).toBe(true);
    });

    it('a stored fold beside an open panel is dropped, the float kept, and main.tabs written back', async () => {
      const { main } = await expanded();
      const again = setup({ 'main.tabs': clone(main) }); // regions at their default: the panel open
      await again.hydrate();
      expect(currentSet(again.store.getState().main).floating).toEqual({ sessionTabId: S });
      expect(currentSet(last(again.sets(), 'main.tabs') as LayoutMain).floating).toEqual({ sessionTabId: S });
      again.store.getState().dockSplit();
      expect(again.store.getState().regions.panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
    });
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
    const tab = { id: 'files:pinned', toolId: 'files', pinned: true };
    const { store, hydrate, sets } = setup({ regions, 'panel.pinned': [tab], 'panelTools.activeNoSession': { version: 1, activeTabId: tab.id } });
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

  // P4-B3 (M3): the pin selection while no session is in view was transient (no key held it), so a pinned tab selected
  // with no session came back as the Session overview at a relaunch (tracker row 290). It has a key of its own now.
  it('writes the no-session selection to its own key and reads it back among the pins', async () => {
    const pins = [{ id: 'p1', toolId: 'terminal', pinned: true }, { id: 'p2', toolId: 'files', pinned: true }];
    const { store, hydrate, sets } = setup({ 'panel.pinned': pins });
    await hydrate();
    store.getState().setPanelTabs(null, { tabs: store.getState().panelPinned, activeTabId: 'p2' });
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([
      { key: 'panelTools.activeNoSession', value: { version: 1, activeTabId: 'p2' } },
      { key: 'panelTools.surfaces', value: { ...surfaceState(), stacks: { '@none': ['p2'] } } },
    ]);
    const again = setup({ 'panel.pinned': pins, ...Object.fromEntries(sets().map(({ key, value }) => [key, value])) });
    await again.hydrate();
    expect(again.store.getState().panelActiveNoSession).toBe('p2');
    vi.advanceTimersByTime(1000);
    expect(again.sets()).toEqual([]);
    // a selection naming no pin any more (or a malformed value) reads as none
    for (const stored of [{ version: 1, activeTabId: 'gone' }, { activeTabId: 'p2' }]) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stale = setup({ 'panel.pinned': pins, 'panelTools.activeNoSession': stored });
      await stale.hydrate();
      expect(stale.store.getState().panelActiveNoSession).toBeNull();
      warn.mockRestore();
    }
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

// P4-B3 (M3; its Decision Log 22, X5 as amended): what a panel tool persists of a tab (the Artifacts tool's record) in
// `panelTools.params`, kept for the panel tabs that exist.
describe('panel tools’ params', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });
  const pin = { id: 'artifacts:pinned01', toolId: 'artifacts', pinned: true };
  const own = { id: 'artifacts:session1', toolId: 'artifacts', pinned: false };

  it('writes a tab’s params to their key, a null clearing them, and reads them back at the next launch', async () => {
    const { store, hydrate, sets } = setup({ 'panel.pinned': [pin], 'panel.app-a': { tabs: [own], activeTabId: own.id } });
    await hydrate((id) => id === A);
    store.getState().setPanelParams(pin.id, { target: 'x' });
    store.getState().setPanelParams(own.id, { target: 'y' });
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    const written = { version: 1, params: { [pin.id]: { target: 'x' }, [own.id]: { target: 'y' } } };
    expect(sets()).toEqual([{ key: 'panelTools.params', value: written }]);
    const again = setup({ 'panel.pinned': [pin], 'panel.app-a': { tabs: [own], activeTabId: own.id }, 'panelTools.params': written });
    await again.hydrate((id) => id === A);
    expect(again.store.getState().panelParams).toEqual(written.params);
    store.getState().setPanelParams(own.id, null);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets().at(-1)).toEqual({ key: 'panelTools.params', value: { version: 1, params: { [pin.id]: { target: 'x' } } } });
  });

  it('writes nothing for params equal to the ones held', async () => {
    const { store, hydrate, sets } = setup({ 'panel.pinned': [pin], 'panelTools.params': { version: 1, params: { [pin.id]: { target: 'x' } } } });
    await hydrate();
    const held = store.getState().panelParams;
    store.getState().setPanelParams(pin.id, { target: 'x' });
    store.getState().setPanelParams('artifacts:never-01', null);
    expect(store.getState().panelParams).toBe(held);
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([]);
  });

  it('keeps only the params of panel tabs that exist, at hydration and at each write; the tab written is kept before its ref lands', async () => {
    const stored = { version: 1, params: { [pin.id]: { target: 'x' }, [own.id]: { target: 'y' }, 'artifacts:closed01': { target: 'z' } } };
    // B's list is not read (an unknown session), so its tab's params go with the closed tab's
    const { store, hydrate, sets } = setup({ 'panel.pinned': [pin], 'panel.app-b': { tabs: [own], activeTabId: null }, 'panelTools.params': stored });
    await hydrate((id) => id === A);
    expect(store.getState().panelParams).toEqual({ [pin.id]: { target: 'x' } });
    store.getState().setPanelTabs(null, { tabs: [], activeTabId: null }); // the pin closed
    store.getState().setPanelParams('artifacts:new00001', { target: 'w' }); // a tab whose instance exists before its ref is written
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets().filter((s) => s.key === 'panelTools.params')).toEqual([{ key: 'panelTools.params', value: { version: 1, params: { 'artifacts:new00001': { target: 'w' } } } }]);
  });

  it('reads an invalid value as no params', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, hydrate } = setup({ 'panel.pinned': [pin], 'panelTools.params': { params: { [pin.id]: { target: 'x' } } } });
    await hydrate();
    expect(store.getState().panelParams).toEqual({});
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[layout] panelTools.params is not a valid value; using the default']);
    warn.mockRestore();
  });
});

// P4-B3 (M3; its Decision Log 23, tracker row 126): a stored main.tabs the reader rewrote (a tab of an unknown or retired
// kind dropped, a deliverable tab converted) is written back once at hydration, so the next launch reads it unchanged
// and warns nothing.
describe('the reader’s write-back of main.tabs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });
  const session = { id: `session:${A}`, kind: 'session', appSessionId: A, pinned: false };
  const stored = (tabs: unknown[], closedTabs: unknown[] = []) => ({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: session.id }] } }, closedTabs });

  it.each([
    ['a later build’s kind', stored([session, { id: 'canvas:1', kind: 'canvas', pinned: false }]), 1],
    ['a retired kind', stored([session], [{ id: 'overview', kind: 'overview', pinned: true }]), 0],
    ['a deliverable tab', stored([session, { id: 'deliverable:app-a:d1', kind: 'deliverable', appSessionId: A, deliverableId: 'd1', pinned: false }]), 0],
  ])('rewrites %s once; the next launch reads what was written unchanged, warning nothing', async (_, value, warnings) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, hydrate, sets } = setup({ 'main.tabs': value });
    await hydrate((id) => id === A);
    expect(warn).toHaveBeenCalledTimes(warnings);
    const written = sets().filter((s) => s.key === 'main.tabs');
    expect(written).toEqual([{ key: 'main.tabs', value: store.getState().main }]);
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([
      ...written,
      { key: 'panelTools.surfaces', value: surfaceState({ [NO_PROJECT]: A }) },
    ]);
    warn.mockClear();
    const again = setup(JSON.parse(JSON.stringify(Object.fromEntries(sets().map(({ key, value }) => [key, value])))) as Record<string, unknown>);
    await again.hydrate((id) => id === A);
    vi.advanceTimersByTime(1000);
    expect(again.sets()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('writes nothing for a value the reader keeps, whatever order its keys were written in', async () => {
    const value = stored([{ pinned: true, appSessionId: A, kind: 'session', id: session.id }]);
    const reordered = { closedTabs: [], sets: { [NO_PROJECT]: { splitRatio: 0.5, focusedPane: 0, panes: value.sets[NO_PROJECT].panes } }, current: NO_PROJECT, version: 2 };
    const { hydrate, sets } = setup({ 'main.tabs': reordered, 'panelTools.surfaces': surfaceState({ [NO_PROJECT]: A }) });
    await hydrate((id) => id === A);
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([]);
  });

  it('never writes the default over a value it could not read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { hydrate, sets } = setup({ 'main.tabs': stored([{ ...session, pinned: 'yes' }]) });
    await hydrate((id) => id === A);
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([]);
    warn.mockRestore();
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
