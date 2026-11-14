import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, storedMain, stripOf, type LayoutMain, type LayoutRegions, type PanelSurfaces, type Strip, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createLayoutStore, LAYOUT_WRITE_DELAY_MS, persistLayout, quietly, storedLayout } from './layout';
import { sideGroups } from '../panel/surface-model'; // UX wave U8b
import { buildFSchemaOf } from '../../../../test/support/layout-build-f'; // UX wave U8b

const A = at('app-a' as AppSessionId);
const B = at('app-b' as AppSessionId);
const surfaceState = (contexts: PanelSurfaces['contexts'] = {}): PanelSurfaces => ({ version: 2, stacks: {}, pinnedTools: [], contexts });
// UX wave U13a: `main.tabs` holds the strip's stored form (`storedMain`); a written value read back as the strip it holds.
const stripIn = (value: unknown): Strip => stripOf(value as LayoutMain).strip;

// The keys a launch of this build has written once (UX wave U8b): after them, a launch is not the first read of a profile.
const SIDE_COLUMN_KEYS = { 'panelTools.groups': { version: 1, lower: {} }, 'panelTools.widths': { version: 1, wide: null, narrow: null }, 'cards.open': { version: 1, open: ['environment'] } };

// A store persisting through a fake main whose layout.json holds the three fixed keys at their defaults and the side
// column's three keys, then `values` (an `undefined` value leaves that key out).
function setup(given: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { regions: LAYOUT_DEFAULTS.regions, 'main.tabs': storedMain(LAYOUT_DEFAULTS.main), 'panel.pinned': [], ...SIDE_COLUMN_KEYS, ...given };
  const fake = fakeClient({
    'layout.list': { keys: Object.keys(values) },
    'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }),
    'layout.set': undefined,
  });
  const store = createLayoutStore();
  const stop = persistLayout(fake.client, store);
  running.push(stop);
  const hydrate = async (known: (id: AppSessionId) => boolean = () => true) => {
    const hydrating = store.getState().hydrate(fake.client, known);
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
    expect(sets()).toEqual([{ key: 'main.tabs', value: storedMain(LAYOUT_DEFAULTS.main) }, { key: 'regions', value: replayed }]); // a first launch materialises the default
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
    expect(written()[0]).toEqual(storedMain(store.getState().main));
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS * 2);
    expect(written()).toHaveLength(1); // the pending diagnostics write went out with it
    store.getState().openTab({ kind: 'agent', appSessionId: 'app-b' as AppSessionId, agentId: 'agent-1' as AgentId });
    expect(written()).toHaveLength(2);
    store.getState().closeTab(`session:${A}`);
    expect(written()).toHaveLength(2);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(written()).toHaveLength(3);
    expect(written()[2]).toEqual(storedMain(store.getState().main));
  });

  it('writes tabs opened before hydration over an existing main.tabs, before any later change and on beforeunload', async () => {
    const notes: TabRef = { id: `file:${TEST_MACHINE}:/invented/notes.md`, kind: 'file', path: '/invented/notes.md', line: null, appSessionId: null, machine: TEST_MACHINE, pinned: false };
    const tabs: TabRef[] = [{ id: 'diagnostics', kind: 'diagnostics', pinned: false }, notes];
    const saved = storedMain({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs, activeTabId: 'diagnostics' }] });
    const { store, hydrate, sets } = setup({ 'main.tabs': saved });
    store.getState().openSession(A); // a sidebar click or a notification navigation racing the first layout.get
    await hydrate((id) => id === A);
    window.dispatchEvent(new Event('beforeunload'));
    const written = sets().filter((s) => s.key === 'main.tabs');
    expect(written).toHaveLength(1);
    expect(stripIn(written[0].value).panes[0].tabs.map((t) => t.id)).toEqual(['diagnostics', `session:${A}`, notes.id]); // opened after the saved active tab, over the saved tabs
    expect(written[0].value).toEqual(storedMain(store.getState().main));
  });

  // U13a: a version-1 main.tabs is the strip it already is (it held one pane layout), written back at once as version
  // 3's stored form; an unknown session's tab is dropped. P5 O6 M2: its bare ids, from before O6, read as the local
  // machine's addresses.
  it('reads a version-1 main.tabs as the strip it holds and writes the stored form back', async () => {
    const bare = (id: string) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
    const tab = (id: string): TabRef => ({ id: `session:${at(id)}`, kind: 'session', appSessionId: at(id as AppSessionId), pinned: false });
    const diagnostics: TabRef = { id: 'diagnostics', kind: 'diagnostics', pinned: false };
    const v1 = {
      version: 1,
      panes: [
        { tabs: [bare('x1'), bare('y1'), diagnostics, bare('gone')], activeTabId: 'session:y1' },
        { tabs: [bare('new'), bare('x2')], activeTabId: 'session:new' },
      ],
      focusedPane: 0,
      splitRatio: 0.4,
      closedTabs: [bare('x3')],
    };
    const known = new Set<string>([at('x1'), at('x2'), at('x3'), at('y1'), at('new')]); // `gone` is unknown
    const { store, hydrate, sets } = setup({ 'main.tabs': v1 });
    await hydrate((id) => known.has(id));
    const main = store.getState().main;
    expect(main).toEqual({
      panes: [{ tabs: [tab('x1'), tab('y1'), diagnostics], activeTabId: tab('y1').id }, { tabs: [tab('new'), tab('x2')], activeTabId: tab('new').id }],
      focusedPane: 0,
      splitRatio: 0.4,
      closedTabs: [tab('x3')],
    });
    expect(sets()).toEqual([
      { key: 'main.tabs', value: storedMain(main) },
      { key: 'panelTools.surfaces', value: surfaceState({ [NO_PROJECT]: at('y1' as AppSessionId) }) },
    ]);
    // the next launch reads the stored form and the remembered surface context as they are and writes nothing
    const again = setup({ 'main.tabs': storedMain(main), 'panelTools.surfaces': store.getState().panelSurfaces });
    await again.hydrate((id) => known.has(id));
    expect(again.store.getState().main).toEqual(main);
    vi.advanceTimersByTime(1000);
    expect(again.sets()).toEqual([]);
  });

  // P3-L (M3): the `artifact` tab kind is written to main.tabs and read back by the next launch as it was.
  it('writes an artifact tab to main.tabs and reads it back at the next launch, pinned and active', async () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().openTab({ kind: 'artifact', artifactId, machine: TEST_MACHINE });
    store.getState().togglePinned(`artifact:${TEST_MACHINE}:${artifactId}`);
    vi.advanceTimersByTime(1000);
    const written = sets().filter((s) => s.key === 'main.tabs').at(-1)!.value as LayoutMain;
    expect(stripIn(written).panes[0]).toEqual({ tabs: [{ id: `artifact:${TEST_MACHINE}:${artifactId}`, kind: 'artifact', artifactId, machine: TEST_MACHINE, pinned: true }], activeTabId: `artifact:${TEST_MACHINE}:${artifactId}` });
    const again = setup({ 'main.tabs': JSON.parse(JSON.stringify(written)) });
    await again.hydrate();
    expect(again.store.getState().main).toEqual(stripIn(written));
  });

  // P4-B3 (X37; its Decision Log 1): a floating split is written beside its ratio and comes back floating at the next
  // launch; docked again, the value is byte-identical to the one it floated from.
  it('writes a floating split to main.tabs, reads it back floating, and docks to the value it left', async () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().openTab({ kind: 'artifact', artifactId, machine: TEST_MACHINE });
    store.getState().openSession(A, { split: true });
    store.getState().setSplitRatio(0.4);
    vi.advanceTimersByTime(1000);
    const before = JSON.stringify(sets().at(-1)!.value);
    store.getState().floatSplit(`session:${A}`);
    vi.advanceTimersByTime(1000);
    const floating = sets().at(-1)!.value as LayoutMain;
    expect(stripIn(floating)).toMatchObject({ floating: { sessionTabId: `session:${A}` }, splitRatio: 0.4 });
    const again = setup({ 'main.tabs': JSON.parse(JSON.stringify(floating)) });
    await again.hydrate();
    expect(again.store.getState().main).toEqual(stripIn(floating)); // relaunch restores the float
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
      store.getState().openTab({ kind: 'artifact', artifactId, machine: TEST_MACHINE });
      store.getState().openSession(A, { split: true });
      vi.advanceTimersByTime(1000);
      store.getState().floatSplit(S, { foldPanel: true });
      vi.advanceTimersByTime(1000);
      return { main: last(sets(), 'main.tabs') as LayoutMain, regions: last(sets(), 'regions') as LayoutRegions };
    };

    it('writes the fold on the float and the folded panel, reads both back, and leaving Expand then opens the panel', async () => {
      const { main, regions } = await expanded();
      expect(stripIn(main).floating).toEqual({ sessionTabId: S, foldedPanel: true });
      expect(regions.panel).toEqual({ ...LAYOUT_DEFAULTS.regions.panel, collapsed: true });
      const again = setup({ 'main.tabs': clone(main), regions: clone(regions) });
      await again.hydrate();
      expect([again.store.getState().main, again.store.getState().regions]).toEqual([stripIn(main), regions]);
      expect(again.sets(), 'only the additive surface context is materialized').toEqual([{ key: 'panelTools.surfaces', value: surfaceState({ [NO_PROJECT]: A }) }]);
      again.store.getState().dockSplit();
      vi.advanceTimersByTime(1000);
      expect((last(again.sets(), 'regions') as LayoutRegions).panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
      expect(stripIn(last(again.sets(), 'main.tabs')).floating).toBeUndefined();
    });

    it('a stored fold whose float the reader drops (its session gone) opens the panel, both written back', async () => {
      const { main, regions } = await expanded();
      const held = { 'main.tabs': clone(main), regions: clone(regions) };
      const again = setup(held);
      await again.hydrate(() => false);
      expect(again.store.getState().main.floating).toBeUndefined();
      expect(again.store.getState().regions.panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
      expect((last(again.sets(), 'regions') as LayoutRegions).panel).toEqual(LAYOUT_DEFAULTS.regions.panel);
      expect(last(again.sets(), 'main.tabs'), 'main.tabs written back without the fold').toEqual(storedMain(again.store.getState().main));
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
      expect(again.store.getState().main.floating).toEqual({ sessionTabId: S });
      expect(last(again.sets(), 'main.tabs'), 'main.tabs written back without the fold').toEqual(storedMain(again.store.getState().main));
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
      expect(again.store.getState().main.floating).toEqual({ sessionTabId: S });
      expect(stripIn(last(again.sets(), 'main.tabs')).floating).toEqual({ sessionTabId: S });
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
    const failing = { ...fake.client, invoke: (name: never, input: never, ...rest: unknown[]) => (name === 'layout.get' && (input as { key: string }).key === 'main.tabs' ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'x' } }) : (fake.client.invoke as unknown as (...a: unknown[]) => Promise<never>)(name, input, ...rest)) } as typeof fake.client;
    const store = createLayoutStore();
    await store.getState().hydrate(failing, () => true);
    // UX wave U8b: an empty listing is a first read, which waits for a launch whose every read answered
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
    const { store, hydrate, sets } = setup({ [`panel.${A}`]: { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' } });
    await hydrate((id) => id === A);
    store.getState().setPanelTabPinned(A, 't1', true);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets()).toEqual([
      { key: 'panel.pinned', value: [{ id: 't1', toolId: 'files', pinned: true }] },
      { key: `panel.${A}`, value: { tabs: [], activeTabId: 't1' } },
    ]);
  });

  it('drops a pending write of a removed session’s panel key, which main deletes', async () => {
    const { store, hydrate, sets } = setup({ [`panel.${A}`]: { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' } });
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
    store.getState().showSurfaceTab(null, 'p2'); // UX wave U8b: the act that shows a pin with no session
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
    const { store, hydrate, sets } = setup({ 'panel.pinned': [pin], [`panel.${A}`]: { tabs: [own], activeTabId: own.id } });
    await hydrate((id) => id === A);
    store.getState().setPanelParams(pin.id, { target: 'x' });
    store.getState().setPanelParams(own.id, { target: 'y' });
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    const written = { version: 1, params: { [pin.id]: { target: 'x' }, [own.id]: { target: 'y' } } };
    expect(sets()).toEqual([{ key: 'panelTools.params', value: written }]);
    const again = setup({ 'panel.pinned': [pin], [`panel.${A}`]: { tabs: [own], activeTabId: own.id }, 'panelTools.params': written });
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
    const { store, hydrate, sets } = setup({ 'panel.pinned': [pin], [`panel.${B}`]: { tabs: [own], activeTabId: null }, 'panelTools.params': stored });
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
  const stored = (tabs: unknown[], closedTabs: unknown[] = []) => ({ version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: session.id }] } }, closedTabs });

  it.each([
    ['a later build’s kind', stored([session, { id: 'canvas:1', kind: 'canvas', pinned: false }]), 1],
    ['a retired kind', stored([session], [{ id: 'overview', kind: 'overview', pinned: true }]), 0],
    // a deliverable tab is older than version 3, so it is stored with bare ids
    ['a deliverable tab', { version: 2, current: NO_PROJECT, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [{ ...session, id: 'session:app-a', appSessionId: 'app-a' }, { id: 'deliverable:app-a:d1', kind: 'deliverable', appSessionId: 'app-a', deliverableId: 'd1', pinned: false }], activeTabId: 'session:app-a' }] } }, closedTabs: [] }, 0],
  ])('rewrites %s once; the next launch reads what was written unchanged, warning nothing', async (_, value, warnings) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, hydrate, sets } = setup({ 'main.tabs': value });
    await hydrate((id) => id === A);
    expect(warn).toHaveBeenCalledTimes(warnings);
    const written = sets().filter((s) => s.key === 'main.tabs');
    expect(written).toEqual([{ key: 'main.tabs', value: storedMain(store.getState().main) }]);
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
    const reordered = { closedTabs: [], sets: { [NO_PROJECT]: { splitRatio: 0.5, focusedPane: 0, panes: value.sets[NO_PROJECT].panes } }, current: NO_PROJECT, version: 3 };
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

// P5 O6 M2 (OX2; acceptance 4's unit half): a layout.json written before O6 holds bare ids, every one the local
// machine's. It reads lifted, the store holds addresses, and every lifted key is written back once at its current version
// (a bare panel key under its address, the bare key deleted), so the launch after reads it unchanged and writes nothing.
describe('a layout written before O6', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });

  it('reads lifted, writes each key back once at its address, and the next launch writes nothing', async () => {
    const X = at('proj-x' as ProjectId);
    const file = { id: 'file:/w/x.ts', kind: 'file', path: '/w/x.ts', line: 3, appSessionId: 'app-a', pinned: true };
    const held = {
      'main.tabs': {
        version: 2,
        current: 'proj-x',
        sets: { 'proj-x': { panes: [{ tabs: [file, { id: 'session:app-a', kind: 'session', appSessionId: 'app-a', pinned: false }], activeTabId: 'session:app-a' }], focusedPane: 0, splitRatio: 0.5 } },
        closedTabs: [],
      },
      regions: { ...LAYOUT_DEFAULTS.regions, version: 4, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, expandedProjects: ['proj-x', 'other'] } },
      'panelTools.surfaces': { version: 1, stacks: { 'app-a': ['files:1'] }, pinnedTools: [], contexts: { 'proj-x': 'app-a' } },
      'panel.app-a': { tabs: [{ id: 'files:1', toolId: 'files', pinned: false }], activeTabId: 'files:1' },
    };
    const { store, hydrate, sets } = setup(held);
    await hydrate((id) => id === A);
    vi.advanceTimersByTime(1000);
    const fileTab = { ...file, id: `file:${TEST_MACHINE}:/w/x.ts`, appSessionId: A, machine: TEST_MACHINE };
    // U13a: its one project-keyed set is the strip, written in the stored form, its remembered session under `none`
    const main = { panes: [{ tabs: [fileTab, { id: `session:${A}`, kind: 'session', appSessionId: A, pinned: false }], activeTabId: `session:${A}` }], focusedPane: 0, splitRatio: 0.5, closedTabs: [] } as Strip;
    expect(store.getState().main).toEqual(main);
    expect(store.getState().regions.sidebar.expandedProjects).toEqual([X, `machine:${TEST_MACHINE}`]); // P5 O6 M5: the machine's own row
    expect(store.getState().panelBySession.get(A)).toEqual(held['panel.app-a']);
    expect(Object.fromEntries(sets().map(({ key, value }) => [key, value]))).toEqual({
      'main.tabs': storedMain(main),
      regions: { ...held.regions, version: 5, sidebar: { ...held.regions.sidebar, expandedProjects: [X, `machine:${TEST_MACHINE}`] } },
      'panelTools.surfaces': { version: 2, stacks: { [A]: ['files:1'] }, pinnedTools: [], contexts: { [NO_PROJECT]: A } },
      [`panel.${A}`]: held['panel.app-a'],
      'panel.app-a': null, // deleted, once its address's key is written
    });
    expect(sets().map(({ key }) => key).slice(-2)).toEqual([`panel.${A}`, 'panel.app-a']);
    // layout.json after the launch: the writes applied, the bare key gone
    const written = Object.fromEntries(Object.entries({ ...held, ...Object.fromEntries(sets().map(({ key, value }) => [key, value])) }).filter(([, value]) => value !== null));
    const again = setup(JSON.parse(JSON.stringify(written)) as Record<string, unknown>);
    await again.hydrate((id) => id === A);
    vi.advanceTimersByTime(1000);
    expect(again.store.getState().main).toEqual(main);
    expect(again.sets()).toEqual([]);
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
    // UX wave U8b (M2): the write maintains the refs; what is in view is chosen by `showSurfaceTab` alone
    expect(store.getState().panelBySession.get(A)).toEqual({ tabs: [{ id: 'o', toolId: 'files', pinned: false }], activeTabId: null });
    expect(store.getState().effectivePanelTabs(A).map((t) => t.id)).toEqual(['p', 'o']);
  });

  it('with no session keeps the pins and a transient selection among them', () => {
    const store = createLayoutStore();
    const p1 = { id: 'p1', toolId: 'terminal', pinned: true };
    const p2 = { id: 'p2', toolId: 'files', pinned: true };
    store.getState().setPanelTabs(null, { tabs: [p1, p2], activeTabId: 'p2' });
    store.getState().showSurfaceTab(null, 'p2'); // UX wave U8b: the write chooses nothing
    expect(store.getState().panelActiveNoSession).toBe('p2');
    store.getState().setPanelTabs(null, { tabs: [p1, p2, { id: 'o', toolId: 'x', pinned: false }], activeTabId: 'o' });
    expect(store.getState().panelActiveNoSession).toBe('p2'); // an unpinned tab has nowhere to live without a session
  });

  it('revalidates the no-session selection whenever the pins change', () => {
    const store = createLayoutStore();
    const pin = (id: string) => ({ id, toolId: 'files', pinned: true });
    store.getState().setPanelTabs(null, { tabs: [pin('p1'), pin('p2'), pin('p3')], activeTabId: 'p2' });
    store.getState().showSurfaceTab(null, 'p2'); // UX wave U8b: the write chooses nothing
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
  const terminal = { id: 'term-1', toolId: 'terminal', pinned: false };
  const files = { id: 'files-1', toolId: 'files', pinned: false };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });

  it('adds a ref to session A while B is shown, persists it to panel.<A>, and reads it back after switching to A', async () => {
    const { store, hydrate, sets } = setup({ [`panel.${A}`]: { tabs: [files], activeTabId: 'files-1' } });
    await hydrate((id) => id === A || id === B);
    store.getState().openSession(B);
    store.getState().updatePanelTabs(A, (refs) => [...refs, terminal]);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets().filter((s) => s.key.startsWith('panel.'))).toEqual([{ key: `panel.${A}`, value: { tabs: [files, terminal], activeTabId: 'files-1' } }]);
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
      { key: `panel.${A}`, value: { tabs: [files], activeTabId: null } },
    ]);
    expect(store.getState().panelTabsOf(B).map((t) => t.id)).toEqual(['p1', 'term-1']); // a pin shows for every session
  });

  it('shows a tab it is asked to, keeps a surviving selection, and moves a removed one to its neighbour', () => {
    const store = createLayoutStore();
    store.getState().updatePanelTabs(A, () => [files, terminal], { activate: 'term-1' });
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
    store.getState().showSurfaceTab(null, 'p2'); // UX wave U8b: the write chooses nothing
    store.getState().updatePanelTabs(A, (refs) => refs.filter((t) => t.id !== 'p2'));
    expect(store.getState().panelPinned.map((t) => t.id)).toEqual(['p1', 'p3']);
    expect(store.getState().panelActiveNoSession).toBe('p3');
  });
});

// P5 O6 M4: main deletes the panel key of its own removed session; another machine's session's key is the page's to delete.
describe('the panel keys of another machine’s sessions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });
  const own = { id: 'files:1', toolId: 'files', pinned: false };

  it('deletes another machine’s session’s key once the session leaves the layout, and leaves this machine’s to main', async () => {
    const onB = addressOf(OTHER_MACHINE, 'app-b' as AppSessionId);
    const { store, hydrate, sets } = setup({ [`panel.${A}`]: { tabs: [own], activeTabId: own.id }, [`panel.${onB}`]: { tabs: [own], activeTabId: own.id } });
    await hydrate();
    expect(store.getState().panelBySession.has(onB)).toBe(true);
    store.getState().dropSession(onB);
    store.getState().dropSession(A);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets().filter((s) => s.key.startsWith('panel.') && s.key !== 'panel.pinned')).toEqual([{ key: `panel.${onB}`, value: null }]);
  });
});

// UX wave U8b (docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md, M1; Interfaces §A, §G): a profile build F
// wrote, read by this build the first time and again.
describe('the side column’s first read of a profile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });
  const pin = { id: 'terminal:ffff0001', toolId: 'terminal', pinned: true };
  const files = { id: 'files:ffff0002', toolId: 'files', pinned: false };
  const info = { id: 'session-info:ffff0003', toolId: 'session-info', pinned: false };
  const review = { id: 'review:ffff0004', toolId: 'review', pinned: false };
  const t1 = { id: 'terminal:ffff0005', toolId: 'terminal', pinned: false };
  const t2 = { id: 'terminal:ffff0006', toolId: 'terminal', pinned: false };
  const pane = { id: 'plugin-pane:ffff0007', toolId: 'plugin-pane', pinned: false }; // its plugin not loaded yet
  const multiInstance = (toolId: string) => (toolId === 'plugin-pane' ? undefined : toolId === 'terminal');
  const fixed = { regions: LAYOUT_DEFAULTS.regions, 'main.tabs': storedMain(LAYOUT_DEFAULTS.main), 'panel.pinned': [] };

  // A launch over `file`, each key of `failing` failing its `layout.get` (and `layout.list` its listing); `during` acts on
  // the store while the reads are pending; `after()` is layout.json as its writes left it.
  async function launch(file: Record<string, unknown>, failing: readonly string[] = [], during?: (store: ReturnType<typeof createLayoutStore>) => void) {
    const fake = fakeClient({
      'layout.list': { keys: Object.keys(file) },
      'layout.get': ({ key }: { key: string }) => ({ value: file[key] ?? null }),
      'layout.set': undefined,
    });
    const invoke = fake.client.invoke as unknown as (name: string, input: { key?: string }, ...rest: unknown[]) => Promise<unknown>;
    const client = { ...fake.client, invoke: (name: string, input: { key?: string }, ...rest: unknown[]) => ((name === 'layout.get' ? failing.includes(input.key!) : failing.includes(name)) ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'x' } }) : invoke(name, input, ...rest)) } as unknown as typeof fake.client;
    const store = createLayoutStore();
    const stop = persistLayout(client, store);
    running.push(stop);
    const hydrating = store.getState().hydrate(client, () => true, { multiInstance });
    during?.(store);
    await vi.runAllTimersAsync();
    await hydrating;
    const sets = () => fake.invoked('layout.set') as { key: string; value: unknown }[];
    const after = () => ({ ...file, ...Object.fromEntries(sets().map(({ key, value }) => [key, value])) });
    return { store, sets, after };
  }

  // UX wave U7b (Interfaces §G): no page means no key, so a first read never writes `destination`.
  it('a first read of a profile that holds no destination writes the three keys of the side column and not this one', async () => {
    const { sets } = await launch(fixed);
    expect(sets().map((write) => write.key).sort()).toEqual(['cards.open', 'panelTools.groups', 'panelTools.widths']);
  });

  it('reads F’s two stacked surfaces as two groups and drops the tabs F never closed, the pins and terminals kept', async () => {
    const f = {
      ...fixed,
      'panel.pinned': [pin],
      [`panel.${A}`]: { tabs: [files, info, review, t1, t2, pane], activeTabId: review.id },
      'panelTools.surfaces': { version: 2, stacks: { [A]: [files.id, review.id] }, pinnedTools: [], contexts: {} },
    };
    const first = await launch(f);
    const state = first.store.getState();
    expect(state.effectivePanelTabs(A)).toEqual([pin, files, review, t1, t2, pane]);
    expect(sideGroups(state, A)).toMatchObject({ upper: { shown: files }, lower: { tabs: [review], shown: review }, hidden: false });
    expect(first.sets().map((write) => write.key).sort()).toEqual(['cards.open', `panel.${A}`, 'panelTools.groups', 'panelTools.widths']);
    // a second launch is not a first read: nothing is pruned, nothing written
    const again = await launch(first.after());
    expect(again.store.getState().effectivePanelTabs(A)).toEqual([pin, files, review, t1, t2, pane]);
    expect(again.sets()).toEqual([]);
    // a pruned tool opened again on purpose is a tab again, and stays one
    again.store.getState().setPanelTabs(A, { tabs: [...again.store.getState().effectivePanelTabs(A), info], activeTabId: info.id });
    await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
    const third = await launch(again.after());
    expect(third.store.getState().effectivePanelTabs(A)).toContainEqual(info);
  });

  // The first read prunes and marks the profile for good, so it waits for a launch at which every read answered (Decision
  // Log 3): a failed read's fallback would make a scope look as if it held less than it does.
  // A profile F wrote: Files above and Review below in A, a tab F never closed (Session info), a width, params, and A's
  // session shown in main (so hydration learns a surface context, a reason to write `panelTools.surfaces`).
  const own = { tabs: [files, info, review, t1], activeTabId: review.id };
  const shown: TabRef = { id: `session:${A}`, kind: 'session', appSessionId: A, pinned: false };
  const profile = {
    ...fixed,
    regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 512 } },
    'main.tabs': storedMain({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [shown], activeTabId: shown.id }] }),
    'panel.pinned': [pin],
    [`panel.${A}`]: own,
    'panelTools.surfaces': { version: 2, stacks: { [A]: [files.id, review.id] }, pinnedTools: [], contexts: {} },
    'panelTools.params': { version: 1, params: { [info.id]: { kept: 'invented' }, [files.id]: { root: 'invented' } } },
  };
  const keys = (sets: { key: string }[]) => sets.map((write) => write.key);
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it.each(['panelTools.surfaces', 'panel.pinned', `panel.${A}`, 'panelTools.params', 'regions'])('waits while the read of %s fails: nothing pruned, nothing marked; the next launch reads it first', async (key) => {
    const error = quiet();
    const failed = await launch(profile, [key]);
    expect(error).toHaveBeenCalledWith(`[layout] layout.get ${key} failed`, expect.anything());
    error.mockRestore();
    if (key !== `panel.${A}`) expect(failed.store.getState().panelBySession.get(A)?.tabs).toEqual([files, info, review, t1]);
    await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
    expect(failed.sets().map((write) => write.key)).not.toContain('panelTools.groups');
    expect(failed.sets().map((write) => write.key)).not.toContain(`panel.${A}`);
    expect(failed.sets().map((write) => write.key)).not.toContain('panelTools.params');
    expect(failed.sets().map((write) => write.key)).not.toContain('panelTools.widths');
    expect(failed.sets().map((write) => write.key)).not.toContain(key); // hydration writes no default over a value it could not read
    expect(failed.after()).toMatchObject({ [`panel.${A}`]: own, 'panelTools.params': profile['panelTools.params'] });
    const next = await launch(failed.after());
    expect(next.store.getState().effectivePanelTabs(A)).toEqual([pin, files, review, t1]);
    expect(sideGroups(next.store.getState(), A)).toMatchObject({ upper: { shown: files }, lower: { tabs: [review], shown: review }, hidden: false });
    expect(next.after()).toMatchObject({ 'panelTools.groups': { version: 1, lower: {} }, 'panelTools.widths': { version: 1, wide: 512, narrow: null } });
  });

  it('waits while the listing fails, writing nothing over the keys it could not read; the next launch reads it first', async () => {
    const error = quiet();
    const failed = await launch(profile, ['layout.list']);
    error.mockRestore();
    await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
    for (const key of ['panelTools.surfaces', 'panelTools.groups', 'panelTools.params', 'panelTools.widths', 'cards.open', `panel.${A}`]) expect(keys(failed.sets())).not.toContain(key);
    expect(failed.after()).toMatchObject({ 'panelTools.surfaces': profile['panelTools.surfaces'], [`panel.${A}`]: own });
    const next = await launch(failed.after());
    expect(next.store.getState().effectivePanelTabs(A)).toEqual([pin, files, review, t1]);
    expect(sideGroups(next.store.getState(), A)).toMatchObject({ upper: { shown: files }, lower: { tabs: [review], shown: review }, hidden: false });
  });

  // After a deferred first read, this build's first write of the side column's state marks the profile (Decision Log 3):
  // from then on it may hold tabs this build showed, which no later prune may take.
  const extra = { id: 'browser:ffff0008', toolId: 'browser', pinned: false };
  it.each([
    ['one group', 'panelTools.surfaces'],
    ['two groups', 'panelTools.params'],
  ])('a deferred first read, then a tab opened, shown and left, keeps every tab at the next launch: %s', async (_, failing) => {
    const error = quiet();
    const failed = await launch(profile, [failing]);
    error.mockRestore();
    const store = failed.store;
    expect(sideGroups(store.getState(), A).lower !== null).toBe(failing === 'panelTools.params');
    const before = sideGroups(store.getState(), A).upper.shown!;
    store.getState().updatePanelTabs(A, (refs) => [...refs, extra]); // added without being brought into view
    store.getState().showSurfaceTab(A, extra.id);
    store.getState().showSurfaceTab(A, before.id);
    window.dispatchEvent(new Event('beforeunload'));
    expect(failed.after()).toMatchObject({ 'panelTools.groups': { version: 1 } });
    const next = await launch(failed.after());
    expect(next.store.getState().panelBySession.get(A)?.tabs).toEqual([files, info, review, t1, extra]);
    expect(keys(next.sets())).not.toContain(`panel.${A}`);
  });

  it('a deferred first read, then a pin, prunes nothing at the next launch', async () => {
    const error = quiet();
    const failed = await launch(profile, ['panelTools.surfaces']);
    error.mockRestore();
    failed.store.getState().setPanelTabPinned(A, files.id, true);
    window.dispatchEvent(new Event('beforeunload'));
    expect(failed.after()).toMatchObject({ 'panelTools.groups': { version: 1 } });
    const next = await launch(failed.after());
    expect(next.store.getState().effectivePanelTabs(A)).toEqual(expect.arrayContaining([info, review, t1]));
    expect(next.store.getState().panelPinned.map((tab) => tab.id)).toContain(files.id);
  });

  it('writes back the params without the tabs the first read dropped', async () => {
    const f = {
      ...fixed,
      [`panel.${A}`]: { tabs: [files, info, review], activeTabId: files.id },
      'panelTools.surfaces': { version: 2, stacks: { [A]: [files.id] }, pinnedTools: [], contexts: {} },
      'panelTools.params': { version: 1, params: { [info.id]: { kept: 'invented' }, [files.id]: { root: 'invented' } } },
    };
    const first = await launch(f);
    expect(first.store.getState().effectivePanelTabs(A)).toEqual([files]);
    expect(first.after()['panelTools.params']).toEqual({ version: 1, params: { [files.id]: { root: 'invented' } } });
    const again = await launch(first.after());
    expect(again.sets()).toEqual([]);
  });

  // The branch review's finding 2 (root UC-14: a first read loses nothing): F's two stacked surfaces, and an act that
  // hides A's column while the reads are pending. The prune judges what was stored; the act is replayed after it.
  const stacked = {
    ...fixed,
    'main.tabs': storedMain({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [shown], activeTabId: shown.id }] }),
    [`panel.${A}`]: { tabs: [files, review], activeTabId: review.id },
    'panelTools.surfaces': { version: 2, stacks: { [A]: [files.id, review.id] }, pinnedTools: [], contexts: {} },
  };
  it.each([
    ['openSession, then hideSurfaces', (store: ReturnType<typeof createLayoutStore>) => { store.getState().openSession(A); store.getState().hideSurfaces(A); }],
    ['hideSurfaces, then openSession', (store: ReturnType<typeof createLayoutStore>) => { store.getState().hideSurfaces(A); store.getState().openSession(A); }],
  ])('UC-14: a first read keeps every tab it would keep without an act, when %s land while the reads are pending', async (_, acts) => {
    const first = await launch(stacked, [], acts);
    expect(first.store.getState().panelBySession.get(A)?.tabs).toEqual([files, review]);
    expect(sideGroups(first.store.getState(), A).hidden).toBe(true); // the act holds
    window.dispatchEvent(new Event('beforeunload'));
    const lists = first.sets().filter((write) => write.key === `panel.${A}`);
    for (const write of lists) expect((write.value as { tabs: unknown[] }).tabs).toContainEqual(files);
    for (const write of first.sets()) expect(buildFSchemaOf(write.key)?.safeParse(write.value).success ?? true, write.key).toBe(true);
    const next = await launch(first.after());
    expect(next.store.getState().panelBySession.get(A)?.tabs).toEqual([files, review]);
  });

  // The branch review's finding 3: a card opened or folded while the reads are pending is replayed over the stored folds
  // and written, as an early act on the side column is.
  it.each([
    ['Context opened', (store: ReturnType<typeof createLayoutStore>) => store.getState().setCardOpen('context', true), ['environment', 'context']],
    ['Environment folded', (store: ReturnType<typeof createLayoutStore>) => store.getState().setCardOpen('environment', false), []],
  ] as const)('a card fold made while the reads are pending holds after hydration and is stored: %s', async (_, act, open) => {
    const launched = await launch({ ...fixed, ...SIDE_COLUMN_KEYS }, [], act);
    expect(launched.store.getState().cardsOpen).toEqual(open);
    await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
    expect(launched.after()['cards.open']).toEqual({ version: 1, open });
    expect((await launch(launched.after())).store.getState().cardsOpen).toEqual(open);
  });

  it('takes F’s one width as the wide width, 380 as automatic, and keeps 380 once dragged to it', async () => {
    const at = (width: number) => ({ ...fixed, regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width } } });
    expect((await launch(at(380))).store.getState().panelWidths).toEqual({ version: 1, wide: null, narrow: null });
    const dragged = await launch(at(512));
    expect(dragged.store.getState().panelWidths).toEqual({ version: 1, wide: 512, narrow: null });
    expect(dragged.sets()).toContainEqual({ key: 'panelTools.widths', value: { version: 1, wide: 512, narrow: null } });
    dragged.store.getState().setPanelWidth(380); // nothing in view: the narrow width
    await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
    const later = await launch(dragged.after());
    expect(later.store.getState().panelWidths).toEqual({ version: 1, wide: 512, narrow: 380 });
    later.store.getState().setPanelWidth(null);
    await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
    expect(later.after()).toMatchObject({ 'panelTools.widths': { version: 1, wide: 512, narrow: null }, regions: { panel: { width: 380 } } });
  });

  it('reads cards.open absent, or holding a card it does not know, as Environment open', async () => {
    expect((await launch({ ...fixed, ...SIDE_COLUMN_KEYS, 'cards.open': undefined })).store.getState().cardsOpen).toEqual(['environment']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await launch({ ...fixed, ...SIDE_COLUMN_KEYS, 'cards.open': { version: 1, open: ['context', 'artifacts'] } })).store.getState().cardsOpen).toEqual(['environment']);
    warn.mockRestore();
    expect((await launch({ ...fixed, ...SIDE_COLUMN_KEYS, 'cards.open': { version: 1, open: ['context'] } })).store.getState().cardsOpen).toEqual(['context']);
  });
});

// UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, Interfaces §F "At hydration"
// and §G): the page under its own key, written while a page is open and deleted when none is.
describe('the page’s key', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    running.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });
  const PAGE = { kind: 'customize', view: 'mine', show: 'skills' } as const;
  const stored = (destination: unknown) => ({ version: 1, destination });
  // A version-1 `main.tabs`: not the stored form's shape (`canonical` false), as a build before U13a left it.
  const v1 = { version: 1, panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5, closedTabs: [] };

  // A launch over layout.json holding the fixed keys, the side column's and `given`; `failing` keys fail their read;
  // `during` acts while the reads are pending. `pages()` is what was written to `destination`.
  async function launch(given: Record<string, unknown>, opts: { failing?: string[]; during?: (store: ReturnType<typeof createLayoutStore>) => void } = {}) {
    const file: Record<string, unknown> = { regions: LAYOUT_DEFAULTS.regions, 'main.tabs': storedMain(LAYOUT_DEFAULTS.main), 'panel.pinned': [], ...SIDE_COLUMN_KEYS, ...given };
    const fake = fakeClient({
      'layout.list': { keys: Object.keys(file) },
      'layout.get': ({ key }: { key: string }) => ({ value: file[key] ?? null }),
      'layout.set': undefined,
    });
    const invoke = fake.client.invoke as unknown as (name: string, input: { key?: string }, ...rest: unknown[]) => Promise<unknown>;
    const client = { ...fake.client, invoke: (name: string, input: { key?: string }, ...rest: unknown[]) => (name === 'layout.get' && opts.failing?.includes(input.key!) ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'x' } }) : invoke(name, input, ...rest)) } as unknown as typeof fake.client;
    const store = createLayoutStore();
    running.push(persistLayout(client, store));
    const hydrating = store.getState().hydrate(client, () => true);
    opts.during?.(store);
    await vi.runAllTimersAsync();
    await hydrating;
    const writes = () => fake.invoked('layout.set') as { key: string; value: unknown }[];
    const pages = () => writes().filter((write) => write.key === 'destination').map((write) => write.value);
    return { store, pages, writes };
  }

  it('a page opened is written as its stored form after the delay; closed, the key is deleted', async () => {
    const { store, pages } = await launch({});
    store.getState().openDestination(PAGE);
    expect(pages()).toEqual([]);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(pages()).toEqual([stored(PAGE)]);
    store.getState().closeDestination();
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(pages()).toEqual([stored(PAGE), null]);
    expect(storedLayout(store.getState()).get('destination'), 'what the suites hold against build F: null while no page is open').toBeNull();
  });

  it('the Settings dialog is never written', async () => {
    const { store, pages } = await launch({});
    store.getState().openSettings('voice');
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS * 2);
    window.dispatchEvent(new Event('beforeunload'));
    expect(pages()).toEqual([]);
  });

  it('rule 4: a stored page over the stored form’s shape opens, and nothing is written', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE) });
    expect(store.getState().destination).toEqual(PAGE);
    vi.advanceTimersByTime(1000);
    expect(pages()).toEqual([]);
  });

  it('rule 5: a stored page over another shape of main.tabs does not open, and the key is deleted', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE), 'main.tabs': v1 });
    expect(store.getState().destination).toBeNull();
    expect(pages()).toEqual([null]);
  });

  // Rule 4 asks the shape of the stored `main.tabs`, not of the default read in its place.
  it('rule 5: a stored page over a main.tabs that does not parse does not open, and the key is deleted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, pages } = await launch({ destination: stored(PAGE), 'main.tabs': { version: 9 } });
    expect(warn.mock.calls.filter(([line]) => String(line).includes('main.tabs'))).toHaveLength(1);
    expect(store.getState().destination).toBeNull();
    expect(pages()).toEqual([null]);
    warn.mockRestore();
  });

  it('rule 5: a stored page with no main.tabs in the file does not open, and the key is deleted', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE), 'main.tabs': null });
    expect(store.getState().destination).toBeNull();
    expect(pages()).toEqual([null]);
  });

  it('a failed read of main.tabs opens no stored page and writes nothing to destination, the key left in the file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, pages } = await launch({ destination: stored(PAGE) }, { failing: ['main.tabs'] });
    expect(store.getState().destination).toBeNull();
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS * 2);
    window.dispatchEvent(new Event('beforeunload'));
    expect(pages()).toEqual([]);
    expect(error.mock.calls.filter(([line]) => String(line).includes('main.tabs'))).toHaveLength(1);
    error.mockRestore();
  });

  it('rule 5: a stored value that does not parse opens nothing, is warned once, and is left in the file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, pages } = await launch({ destination: stored({ kind: 'settings' }) });
    expect(store.getState().destination).toBeNull();
    expect(warn.mock.calls.filter(([line]) => String(line).includes('destination'))).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(pages()).toEqual([]);
    store.getState().openDestination({ kind: 'library' }); // the next page opened replaces it
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(pages()).toEqual([stored({ kind: 'library' })]);
    warn.mockRestore();
  });

  it('rule 1: a page the person opened before the read is what stays open, written over the stored one', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE) }, { during: (s) => s.getState().openDestination({ kind: 'projects' }) });
    expect(store.getState().destination).toEqual({ kind: 'projects' });
    expect(pages()).toEqual([stored({ kind: 'projects' })]);
  });

  it('rule 1: a page the person opened and closed before the read leaves none, the stored key deleted', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE) }, { during: (s) => { s.getState().openDestination({ kind: 'projects' }); s.getState().closeDestination(); } });
    expect(store.getState().destination).toBeNull();
    expect(pages()).toEqual([null]);
  });

  it('rule 2: an act of the person’s that showed a tab before the read leaves none, the stored key deleted', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE) }, { during: (s) => s.getState().openSession(A) });
    expect(store.getState().destination).toBeNull();
    expect(pages()).toEqual([null]);
  });

  it('rule 2 does not count an open made inside quietly: the stored page opens', async () => {
    const { store, pages } = await launch({ destination: stored(PAGE) }, { during: (s) => quietly(() => s.getState().openSession(A)) });
    expect(store.getState().destination).toEqual(PAGE);
    expect(pages()).toEqual([]);
  });

  it('a read of the key that failed writes nothing to it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, pages } = await launch({ destination: stored(PAGE) }, { failing: ['destination'], during: (s) => s.getState().openDestination({ kind: 'projects' }) });
    expect(store.getState().destination).toEqual({ kind: 'projects' });
    expect(pages()).toEqual([]);
    error.mockRestore();
  });

  // M6 (A8; "At hydration", rule 3): `main.tabs` as build F writes it, with tabs of the four retired kinds. The tab in
  // front decides: a Customize, Projects or library tab opens its page, a Settings tab none and no stored page over it.
  describe('rule 3: a retired tab in front', () => {
    const session = { id: `session:${A}`, kind: 'session', appSessionId: A, pinned: false };
    const settingsTab = { id: 'settings', kind: 'settings', section: 'engine', pinned: false };
    const customizeTab = { id: 'customize', kind: 'customize', section: 'skills', pinned: false };
    const projectsTab = { id: 'projects', kind: 'projects', pinned: false };
    const artifactsTab = { id: 'artifacts', kind: 'artifacts', pinned: false };
    const fWrote = (active: string, key: string = at('proj-x')) => ({
      version: 3,
      current: key,
      sets: { [key]: { panes: [{ tabs: [session, settingsTab, customizeTab], activeTabId: active }, { tabs: [projectsTab], activeTabId: 'projects' }], focusedPane: 0, splitRatio: 0.5 } },
      closedTabs: [artifactsTab],
    });
    const RETIRED_IDS = ['settings', 'customize', 'projects', 'artifacts'];
    const idsIn = (value: unknown) => JSON.stringify(value).match(/"id":"[^"]*"/g) ?? [];

    it('A8: a Customize tab at Skills in front opens Customize at Skills, and the page and the tabs without the four are written; a second launch over what was written opens the same page and writes nothing', async () => {
      const first = await launch({ 'main.tabs': fWrote('customize') });
      expect(first.store.getState().destination).toEqual(PAGE);
      expect(first.pages()).toEqual([stored(PAGE)]);
      const tabs = first.writes().filter((write) => write.key === 'main.tabs');
      expect(tabs).toHaveLength(1);
      expect(idsIn(tabs[0].value).filter((id) => RETIRED_IDS.some((retired) => id === `"id":"${retired}"`))).toEqual([]);
      expect(stripIn(tabs[0].value).panes.map((pane) => [pane.tabs.map((tab) => tab.id), pane.activeTabId])).toEqual([[[session.id], session.id]]);
      const second = await launch(Object.fromEntries(first.writes().map((write) => [write.key, write.value])));
      expect(second.store.getState().destination).toEqual(PAGE);
      vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS * 2);
      expect(second.writes()).toEqual([]);
    });

    it('a Projects tab in front opens Projects', async () => {
      const value = fWrote(session.id);
      const { store } = await launch({ 'main.tabs': { ...value, sets: { [at('proj-x')]: { ...value.sets[at('proj-x')], focusedPane: 1 } } } });
      expect(store.getState().destination).toEqual({ kind: 'projects' });
    });

    it('a Settings tab in front opens no page, and a stored page over tabs of the stored form’s shape is deleted, not restored', async () => {
      const { store, pages } = await launch({ 'main.tabs': fWrote('settings', 'none'), destination: stored({ kind: 'library' }) });
      expect(store.getState().destination).toBeNull();
      expect(store.getState().settings, 'the dialog is never opened by a relaunch').toBeNull();
      expect(pages()).toEqual([null]);
    });
  });

  it('a profile that holds no destination costs no read of it', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['regions', 'main.tabs', 'panel.pinned', ...Object.keys(SIDE_COLUMN_KEYS)] }, 'layout.get': () => ({ value: null }), 'layout.set': undefined });
    await createLayoutStore().getState().hydrate(fake.client, () => true);
    expect((fake.invoked('layout.get') as { key: string }[]).map((read) => read.key)).not.toContain('destination');
  });
});
