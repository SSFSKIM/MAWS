import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_STRIP, EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, storedMain, type LayoutMainV1, type Strip, type TabSet } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE, TEST_MACHINE as M } from '../../../../test/support/machine';
import { createLayoutStore, frontOf, pageOpen, placeOf, quietly, registerReplaceGuard, tabOnScreen, type ReplaceVerdict } from './layout';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { allTabs, currentSet, type RekeyOf } from './layout-model';

const A = at('app-a' as AppSessionId);
// A session's tab as a layout from before O6 holds it (bare: P5 O6 M2), and as it reads, lifted to the local machine.
const session = (id: string) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const lifted = (id: string) => session(at(id));
// Saved before W12: version 1, one pane layout.
const persistedMain: LayoutMainV1 = {
  version: 1,
  ...EMPTY_TAB_SET,
  panes: [{ tabs: [session('app-a') as never, session('gone') as never], activeTabId: 'session:gone' }],
  closedTabs: [],
};
const shown = (store: ReturnType<typeof createLayoutStore>) => currentSet(store.getState().main);

async function hydrate(values: Record<string, unknown>, known = (id: AppSessionId) => id === A) {
  const fake = fakeClient({
    'layout.list': { keys: Object.keys(values) },
    'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }),
  });
  const store = createLayoutStore();
  await store.getState().hydrate(fake.client, known);
  return { store, fake };
}

describe('layout and settings migrate', () => {
  it('hydrating a persisted layout whose session tab names an unknown appSessionId drops the tab', async () => {
    const { store } = await hydrate({ 'main.tabs': persistedMain });
    expect(store.getState().hydrated).toBe(true);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`]);
    expect(shown(store).panes[0].activeTabId).toBe(`session:${A}`);
  });

  // W5: every layout saved before the floating Overview holds the Overview's tab, usually first and active. Reading it must
  // keep the user's tabs (not fail over to the default's empty pane) and show the first of them in the Overview's place.
  it('hydrating a layout saved with the Overview tab drops that tab, its pane activating the first remaining tab', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overview = { id: 'overview', kind: 'overview', pinned: true };
    const saved = { ...persistedMain, panes: [{ tabs: [overview, session('app-a'), session('b')], activeTabId: 'overview' }], closedTabs: [overview] };
    const { store } = await hydrate({ 'main.tabs': saved }, () => true);
    expect(store.getState().main).toEqual({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [lifted('app-a'), lifted('b')], activeTabId: `session:${A}` }] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to the default for an absent or invalid key and reads the per-session panel keys', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, fake } = await hydrate({
      regions: { version: 1, sidebar: { width: 'wide' } },
      'panel.pinned': [{ id: 't1', toolId: 'terminal', pinned: true }],
      'panel.app-a': { tabs: [{ id: 't2', toolId: 'files', pinned: false }], activeTabId: 't2' },
      'panel.gone': { tabs: [], activeTabId: 'nope', extra: true },
    });
    expect(store.getState().regions).toEqual(LAYOUT_DEFAULTS.regions);
    expect(store.getState().main).toEqual(LAYOUT_DEFAULTS.main);
    expect(store.getState().panelPinned).toEqual([{ id: 't1', toolId: 'terminal', pinned: true }]);
    expect([...store.getState().panelBySession.keys()]).toEqual([A]);
    expect(store.getState().effectivePanelTabs(A).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(fake.invoked('layout.get').map((i) => (i as { key: string }).key).sort()).toEqual(['main.tabs', 'panel.app-a', 'panel.gone', 'panel.pinned', 'regions']);
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[layout] regions is not a valid value; using the default', '[layout] panel.gone is not a valid value; using the default']);
    warn.mockRestore();
  });

  // E11 W-D (tracker row E5 "dirty file tab pruned silently"): hydration drops only session and agent tabs of unknown
  // sessions, so a file tab (whose buffer may be dirty, if it opened before the read) is never dropped by it
  it('hydrating keeps a file tab of an unknown session, saved or opened before the read', async () => {
    const file = (path: string) => ({ id: `file:${path}`, kind: 'file', path, line: null, appSessionId: 'gone', pinned: false });
    const saved = { ...persistedMain, panes: [{ tabs: [session('gone'), file('/r/saved.ts')], activeTabId: 'session:gone' }] };
    const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] }, 'layout.get': ({ key }: { key: string }) => ({ value: key === 'main.tabs' ? saved : null }) });
    const store = createLayoutStore();
    store.getState().openTab({ kind: 'file', path: '/r/early.ts', line: null, appSessionId: at('gone' as AppSessionId), machine: M });
    await store.getState().hydrate(fake.client, () => false);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`file:${M}:/r/saved.ts`, `file:${M}:/r/early.ts`]);
  });

  it('falls back to the default for a malformed main.tabs (a null pane or tab) and still hydrates', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store } = await hydrate({ 'main.tabs': { ...persistedMain, panes: [{ tabs: [null], activeTabId: 'x' }, null] } });
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().main).toEqual(LAYOUT_DEFAULTS.main);
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[layout] main.tabs is not a valid value; using the default']);
    warn.mockRestore();
  });
});

describe('layout store actions', () => {
  it('delegates the tab transitions and remembers where a closed tab stood', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    s().openSession('b' as AppSessionId, { how: 'tab' });
    s().openSession('c' as AppSessionId, { how: 'tab' });
    s().activateTab('session:b');
    s().closeTab('session:b');
    expect(currentSet(s().main).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, 'session:c']);
    s().reopenClosed();
    expect(currentSet(s().main).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, 'session:b', 'session:c']);
    s().dropSession(A);
    expect(currentSet(s().main).panes[0].tabs.map((t) => t.id)).toEqual(['session:b', 'session:c']);
  });

  it('moves a panel tab between the global pins and the session’s own tabs (D-10)', () => {
    const store = createLayoutStore();
    store.setState({ panelBySession: new Map([[A, { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' }]]) });
    store.getState().setPanelTabPinned(A, 't1', true);
    expect(store.getState().panelPinned).toEqual([{ id: 't1', toolId: 'files', pinned: true }]);
    expect(store.getState().panelBySession.get(A)?.tabs).toEqual([]);
    expect(store.getState().effectivePanelTabs('other' as AppSessionId).map((t) => t.id)).toEqual(['t1']);
    store.getState().setPanelTabPinned(A, 't1', false);
    expect(store.getState().panelPinned).toEqual([]);
    expect(store.getState().panelBySession.get(A)?.tabs).toEqual([{ id: 't1', toolId: 'files', pinned: false }]);
  });

  // UX wave U8b (M2): a write of the pins never chooses what is in view; showing and hiding the column for no session do.
  it('shows the no-session pin it is asked for and hides it, keeping the selection to show again', () => {
    const store = createLayoutStore();
    const pin = { id: 't1', toolId: 'files', pinned: true };
    store.getState().setPanelTabs(null, { tabs: [pin], activeTabId: 't1' });
    expect(store.getState().panelActiveNoSession).toBeNull();
    store.getState().showSurfaceTab(null, 't1');
    expect(store.getState().panelActiveNoSession).toBe('t1');
    expect(surfaceTabs(store.getState(), null)).toEqual([pin]);
    store.getState().hideSurfaces(null);
    expect(store.getState().panelActiveNoSession).toBe('t1');
    expect(surfaceTabs(store.getState(), null)).toEqual([]);
  });

  it('patches the regions', () => {
    const store = createLayoutStore();
    store.getState().setSidebar({ width: 240 });
    store.getState().setPanel({ collapsed: true });
    expect(store.getState().regions.sidebar.width).toBe(240);
    expect(store.getState().regions.panel).toEqual({ ...LAYOUT_DEFAULTS.regions.panel, collapsed: true });
  });

  it.each([false, true])('opening Overview restores the main region without changing panel width or collapsed=%s', (collapsed) => {
    const store = createLayoutStore();
    store.getState().setPanel({ maximized: true, width: 444, collapsed });
    const before = store.getState();
    store.getState().setOverviewOpen(true);
    expect(store.getState().overviewOpen).toBe(true);
    expect(store.getState().regions).toEqual({ ...before.regions, panel: { width: 444, collapsed, maximized: false, floating: false } });
    expect(store.getState().main).toBe(before.main);
  });

  it('closing Overview does not restore a maximized panel', () => {
    const store = createLayoutStore();
    store.getState().setOverviewOpen(true);
    store.getState().setPanel({ maximized: true });
    const before = store.getState().regions;
    store.getState().setOverviewOpen(false);
    expect(store.getState().overviewOpen).toBe(false);
    expect(store.getState().regions).toBe(before);
  });

  // P3-G (§D1.1): `floating` and `maximized` are never both true, and neither holds while collapsed; every patch keeps it.
  describe('the panel’s invariants under every setPanel patch', () => {
    type Panel = typeof LAYOUT_DEFAULTS.regions.panel;
    const states: Record<string, Panel> = {
      docked: { ...LAYOUT_DEFAULTS.regions.panel },
      maximized: { ...LAYOUT_DEFAULTS.regions.panel, maximized: true },
      collapsed: { ...LAYOUT_DEFAULTS.regions.panel, collapsed: true },
      floating: { ...LAYOUT_DEFAULTS.regions.panel, floating: true },
    };
    const patches: Partial<Panel>[] = [
      { floating: true }, { floating: false }, { maximized: true }, { maximized: false }, { collapsed: true }, { collapsed: false },
      { floating: true, width: 500 }, { maximized: true, collapsed: false }, { collapsed: true, maximized: false }, { width: 444 },
    ];
    const cases = Object.entries(states).flatMap(([name, panel]) => patches.map((patch) => [name, patch, panel] as const));
    it.each(cases)('from %s, %j', (_name, patch, panel) => {
      const store = createLayoutStore();
      store.setState({ regions: { ...LAYOUT_DEFAULTS.regions, panel } });
      store.getState().setPanel(patch);
      const after = store.getState().regions.panel;
      expect(after.floating && after.maximized, 'floating and maximized exclusive').toBe(false);
      expect(after.collapsed && (after.floating || after.maximized), 'neither while collapsed').toBe(false);
      // The patch's own true field is what holds; a width is kept as given
      if (patch.collapsed === true) expect(after.collapsed).toBe(true);
      else if (patch.floating === true) expect(after).toMatchObject({ floating: true, collapsed: false });
      else if (patch.maximized === true) expect(after).toMatchObject({ maximized: true, collapsed: false });
      expect(after.width).toBe(patch.width ?? panel.width);
    });
  });

  it('revealMain clears maximized and floating and keeps everything else; a docked panel is left as it is', () => {
    const store = createLayoutStore();
    for (const panel of [{ maximized: true }, { floating: true }]) {
      store.getState().setPanel({ ...panel, width: 444 });
      store.getState().revealMain();
      expect(store.getState().regions.panel).toEqual({ ...LAYOUT_DEFAULTS.regions.panel, width: 444 });
    }
    const before = store.getState().regions;
    store.getState().revealMain();
    expect(store.getState().regions).toBe(before);
  });

  it('opening the Overview docks a floating panel', () => {
    const store = createLayoutStore();
    store.getState().setPanel({ floating: true, width: 500 });
    store.getState().setOverviewOpen(true);
    expect(store.getState().regions.panel).toEqual({ ...LAYOUT_DEFAULTS.regions.panel, width: 500 });
  });

  // §D1.5: the card's size is kept per panel tab; entries of tabs in no panel list go at the next write, at most 64 stay.
  it('writes the floating card’s size per panel tab, dropping tabs in no list and the oldest past 64', () => {
    const store = createLayoutStore();
    const tab = (id: string, pinned = false) => ({ id, toolId: 'files', pinned });
    store.setState({ panelPinned: [tab('pin', true)], panelBySession: new Map([[A, { tabs: [tab('t1'), tab('t2')], activeTabId: 't1' }]]) });
    store.getState().setFloatingCardSize('t1', { w: 400, h: 300 });
    store.getState().setFloatingCardSize('summary', { w: 420, h: 380 });
    expect(store.getState().regions.floatingCard).toEqual({ t1: { w: 400, h: 300 }, summary: { w: 420, h: 380 } });
    // t1 closes: its entry goes at the next write; a rewrite of a key moves it to the newest place
    store.setState({ panelBySession: new Map([[A, { tabs: [tab('t2')], activeTabId: 't2' }]]) });
    store.getState().setFloatingCardSize('pin', { w: 500, h: 400 });
    store.getState().setFloatingCardSize('summary', { w: 360, h: 240 });
    expect(Object.entries(store.getState().regions.floatingCard)).toEqual([['pin', { w: 500, h: 400 }], ['summary', { w: 360, h: 240 }]]);
    // At most 64: the oldest go first
    const many = Array.from({ length: 70 }, (_, i) => tab(`m${i}`));
    store.setState({ panelBySession: new Map([[A, { tabs: many, activeTabId: null }]]) });
    for (const t of many) store.getState().setFloatingCardSize(t.id, { w: 400, h: 300 });
    const keys = Object.keys(store.getState().regions.floatingCard);
    expect(keys).toHaveLength(64);
    expect(keys[0]).toBe('m6');
    expect(keys.at(-1)).toBe('m69');
  });

  // P4-B3 (its Decision Log 10): the split card's size over a main tab is kept as `main:<tab id>`, and goes with the tab
  // at the next write
  it('keeps the split card’s size per open main tab, and drops a closed tab’s', () => {
    const store = createLayoutStore();
    store.getState().openTab({ kind: 'diagnostics' });
    store.getState().openTab({ kind: 'file', path: '/invented/notes.md', line: null, appSessionId: null, machine: M });
    const notes = `file:${M}:/invented/notes.md`;
    store.getState().setFloatingCardSize('main:diagnostics', { w: 400, h: 300 });
    store.getState().setFloatingCardSize(`main:${notes}`, { w: 440, h: 320 });
    store.getState().setFloatingCardSize('main:gone', { w: 500, h: 400 });
    expect(Object.keys(store.getState().regions.floatingCard)).toEqual(['main:diagnostics', `main:${notes}`, 'main:gone']);
    store.getState().closeTab(notes);
    store.getState().setFloatingCardSize('summary', { w: 420, h: 380 });
    expect(Object.keys(store.getState().regions.floatingCard)).toEqual(['main:diagnostics', 'summary']);
  });

  // W5: the floating Overview's rect persists with the regions; whether it is open does not (the app opens on the tabs).
  it('keeps the Overview’s rect in the regions and its open state outside them', () => {
    const store = createLayoutStore();
    const before = store.getState().regions;
    store.getState().setOverviewOpen(true);
    expect(store.getState().overviewOpen).toBe(true);
    expect(store.getState().regions).toBe(before);
    store.getState().setOverviewRect({ x: 20, y: 12, width: 640, height: 480 });
    expect(store.getState().regions).toEqual({ ...before, overview: { x: 20, y: 12, width: 640, height: 480 } });
  });
});

// I2: a replace that would take an unstarted tab's place asks C10's close guard first (registered by the shell).
describe('replacing an unstarted tab', () => {
  const NEW = 'new-1' as AppSessionId;
  const B = 'b' as AppSessionId;
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  function unstartedShown(answer: boolean) {
    const store = createLayoutStore();
    const discard = vi.fn(async () => answer);
    const off = registerReplaceGuard({ unstarted: (id) => id === NEW, discard });
    store.getState().openSession(A);
    store.getState().openSession(NEW, { how: 'tab' });
    const tabs = () => shown(store).panes[0].tabs.map((t) => t.id);
    return { store, discard, off, tabs };
  }

  it('the session opens beside it at once; discarded, the unstarted tab goes, leaving the session in its place and no ⌘⇧T entry', async () => {
    const { store, discard, off, tabs } = unstartedShown(true);
    try {
      store.getState().openSession(B);
      expect(tabs()).toEqual([`session:${A}`, `session:${NEW}`, 'session:b']); // shown while the guard decides
      expect(shown(store).panes[0].activeTabId).toBe('session:b');
      expect(discard).toHaveBeenCalledWith(expect.objectContaining({ id: `session:${NEW}` }));
      await settled();
      expect(tabs()).toEqual([`session:${A}`, 'session:b']);
      expect(shown(store).panes[0].activeTabId).toBe('session:b');
      expect(store.getState().main.closedTabs).toEqual([]);
    } finally {
      off();
    }
  });

  it('a draft that started while its guard decided is left alone: its tab, its agent tab and its panel survive', async () => {
    const store = createLayoutStore();
    let started = false;
    let answer!: (discarded: boolean) => void;
    const off = registerReplaceGuard({ unstarted: (id) => id === NEW && !started, discard: () => new Promise<boolean>((resolve) => (answer = resolve)) });
    try {
      store.getState().openSession(A);
      store.getState().openSession(NEW, { how: 'tab' });
      store.getState().openSession(B);
      started = true; // its record arrived
      store.getState().openTab({ kind: 'agent', appSessionId: NEW, agentId: 'agent-1' as never }, { activate: false });
      store.getState().setPanelTabs(NEW, { tabs: [{ id: 'files-1', toolId: 'files', pinned: false }], activeTabId: 'files-1' });
      answer(true);
      await settled();
      const ids = shown(store).panes[0].tabs.map((t) => t.id);
      expect(ids).toContain(`session:${NEW}`);
      expect(ids).toContain(`agent:${NEW}:agent-1`);
      expect(store.getState().panelBySession.has(NEW)).toBe(true);
    } finally {
      off();
    }
  });

  it('declined, the unstarted tab stays and the session opens in a tab of its own', async () => {
    const { store, off, tabs } = unstartedShown(false);
    try {
      store.getState().openSession(B);
      await settled();
      expect(tabs()).toEqual([`session:${A}`, `session:${NEW}`, 'session:b']);
    } finally {
      off();
    }
  });

  // A change replayed over the hydrated tabs meets what the person never saw: a draft in the way there is kept and not
  // asked about, and the session opens beside it.
  it('an open made before hydration, replayed over a saved draft that is shown, keeps the draft and asks nothing', async () => {
    const discard = vi.fn(async () => true);
    const off = registerReplaceGuard({ unstarted: (id) => id === NEW, discard });
    try {
      const saved = storedMain({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [session(A), session(NEW)], activeTabId: `session:${NEW}` }] } as Strip);
      const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } });
      const store = createLayoutStore();
      const hydrating = store.getState().hydrate(fake.client, () => true);
      store.getState().openSession(B); // a click before layout.get answers
      await settled();
      for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'main.tabs' ? saved : null });
      await hydrating;
      await settled();
      expect(discard).not.toHaveBeenCalled();
      expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, `session:${NEW}`, 'session:b']);
      expect(store.getState().main.closedTabs).toEqual([]);
    } finally {
      off();
    }
  });

  // F2b review 2: the E11 verdict that sets a live draft aside does not reach a restored one.
  it('an open made before hydration keeps a saved draft its verdict would set aside, and announces nothing', async () => {
    const discard = vi.fn(async () => true);
    const announce = vi.fn();
    const off = registerReplaceGuard({ unstarted: (id) => id === NEW, discard, verdict: (tab) => (tab.id === `session:${NEW}` ? { aside: 'kept' } : null), announce });
    try {
      const saved = storedMain({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [session(A), session(NEW)], activeTabId: `session:${NEW}` }] } as Strip);
      const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } });
      const store = createLayoutStore();
      const hydrating = store.getState().hydrate(fake.client, () => true);
      store.getState().openSession(B); // a click before layout.get answers
      await settled();
      for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'main.tabs' ? saved : null });
      await hydrating;
      await settled();
      expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, `session:${NEW}`, 'session:b']);
      expect(store.getState().main.closedTabs).toEqual([]);
      expect(discard).not.toHaveBeenCalled();
      expect(announce).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('asks nothing for a session already open, a new tab or a split', async () => {
    const { store, discard, off, tabs } = unstartedShown(true);
    try {
      store.getState().openSession(A);
      store.getState().openSession(NEW);
      store.getState().openSession(B, { how: 'tab' });
      expect(discard).not.toHaveBeenCalled();
      expect(tabs()).toEqual([`session:${A}`, `session:${NEW}`, 'session:b']);
    } finally {
      off();
    }
  });
});

// E11 F2b (plan 2.5; owner decision 2): opening a session replaces the main tab whatever it shows; the guard's verdict
// keeps what would be lost and sets an unstarted chat's draft aside, and the owner is told which.
describe('replacing a tab of any kind', () => {
  const NEW = 'new-1' as AppSessionId;
  const B = 'b' as AppSessionId;
  const FILE = { kind: 'file', path: '/r/a.ts', line: null, appSessionId: A, machine: M } as const;
  const tabs = (store: ReturnType<typeof createLayoutStore>) => shown(store).panes[0].tabs.map((t) => t.id);

  function guarded(verdicts: Record<string, ReplaceVerdict>) {
    const discard = vi.fn(async () => true);
    const announce = vi.fn();
    const off = registerReplaceGuard({ unstarted: (id) => id === NEW, discard, verdict: (tab) => verdicts[tab.id] ?? null, announce });
    return { discard, announce, off };
  }

  it('a clean file or Diagnostics gives its place, remembered for ⌘⇧T, and nothing is said', () => {
    const { announce, off } = guarded({});
    try {
      for (const target of [FILE, { kind: 'diagnostics' } as const]) {
        const store = createLayoutStore();
        store.getState().openSession(A);
        store.getState().openTab(target);
        const old = shown(store).panes[0].activeTabId;
        store.getState().openSession(B);
        expect(tabs(store), target.kind).toEqual([`session:${A}`, 'session:b']);
        expect(store.getState().main.closedTabs.map((t) => t.id)).toEqual([old]);
      }
      expect(announce).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('a file with unsaved changes stays open and says why; the session opens beside it', () => {
    const { announce, off } = guarded({ [`file:${M}:/r/a.ts`]: { keep: 'a.ts has unsaved changes' } });
    try {
      const store = createLayoutStore();
      store.getState().openSession(A);
      store.getState().openTab(FILE);
      store.getState().openSession(B);
      expect(tabs(store)).toEqual([`session:${A}`, `file:${M}:/r/a.ts`, 'session:b']);
      expect(shown(store).panes[0].activeTabId).toBe('session:b');
      expect(store.getState().main.closedTabs).toEqual([]);
      expect(announce).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: `file:${M}:/r/a.ts` }), { keep: 'a.ts has unsaved changes' });
    } finally {
      off();
    }
  });

  it('an unstarted chat with a draft is set aside: replaced in place, its intent kept (nothing discarded or asked), ⌘⇧T brings it back', () => {
    const { discard, announce, off } = guarded({ [`session:${NEW}`]: { aside: 'kept' } });
    try {
      const store = createLayoutStore();
      store.getState().openSession(A);
      store.getState().openSession(NEW, { how: 'tab' });
      store.getState().openSession(B);
      expect(tabs(store)).toEqual([`session:${A}`, 'session:b']);
      expect(store.getState().main.closedTabs.map((t) => t.id)).toEqual([`session:${NEW}`]);
      expect(discard).not.toHaveBeenCalled();
      expect(announce).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: `session:${NEW}` }), { aside: 'kept' });
    } finally {
      off();
    }
  });

  it('a pinned tab of any kind is left alone, and its pin says so without a word from the guard', () => {
    const { announce, off } = guarded({});
    try {
      const store = createLayoutStore();
      store.getState().openSession(A);
      store.getState().openTab(FILE);
      store.getState().togglePinned(`file:${M}:/r/a.ts`);
      store.getState().openSession(B);
      expect(tabs(store)).toEqual([`file:${M}:/r/a.ts`, 'session:b', `session:${A}`]); // the pinned tab first, the session after it
      expect(announce).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });
});

// UX wave U13a (its section, "The strip", "As read"; the plan's M2): one strip for every tab, whatever is stored.
describe('one strip', () => {
  const X = at('proj-x' as ProjectId);
  const Y = at('proj-y' as ProjectId);
  const B = at('app-b' as AppSessionId);
  const C = at('app-c' as AppSessionId);
  const tab = (id: AppSessionId, pinned = false) => ({ id: `session:${id}`, kind: 'session' as const, appSessionId: id, pinned });
  const diagnostics = { id: 'diagnostics' as const, kind: 'diagnostics' as const, pinned: false };
  const notes = { id: `file:${M}:/w/notes.md`, kind: 'file' as const, path: '/w/notes.md', line: null, appSessionId: null, machine: M, pinned: false };
  const one = (tabs: object[], activeTabId = (tabs[0] as { id: string }).id) => ({ panes: [{ tabs, activeTabId }], focusedPane: 0, splitRatio: 0.5 }) as TabSet;
  // as build F leaves it: the set that was showing (X), the no-project set and another project's
  const sets = { version: 3, current: X, sets: { [X]: one([tab(A), notes]), [NO_PROJECT]: one([diagnostics]), [Y]: one([tab(B)]) }, closedTabs: [] };
  const merged: Strip = { panes: [{ tabs: [tab(A), notes, diagnostics, tab(B)], activeTabId: `session:${A}` }], focusedPane: 0, splitRatio: 0.5, closedTabs: [] };
  const writes = (fake: ReturnType<typeof fakeClient>, key: string) => fake.invoked('layout.set').filter((input) => (input as { key: string }).key === key).map((input) => (input as { value: unknown }).value);
  async function read(values: Record<string, unknown>, opts: { early?: (store: ReturnType<typeof createLayoutStore>) => void } = {}) {
    const fake = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }), 'layout.set': undefined });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, () => true);
    opts.early?.(store);
    const result = await hydrating;
    return { store, fake, result };
  }

  it('a stored value with several sets reads as one strip, the tab in front still in front, written back once as one set, and says it merged', async () => {
    const first = await read({ 'main.tabs': sets });
    expect(first.result).toEqual({ merged: true });
    expect(first.store.getState().main).toEqual(merged);
    expect(writes(first.fake, 'main.tabs')).toEqual([storedMain(merged)]);
    const again = await read({ 'main.tabs': storedMain(merged) });
    expect(again.result).toEqual({ merged: false });
    expect(again.store.getState().main).toEqual(merged);
    expect(writes(again.fake, 'main.tabs')).toEqual([]);
  });

  it('one project-keyed set is written in the stored form with its remembered session under none, with no notice, and read back with nothing written', async () => {
    // the tab in front is no session's, and the remembered session is not the set's first
    const stored = { version: 3, current: X, sets: { [X]: one([tab(A), tab(B), diagnostics], 'diagnostics') }, closedTabs: [] };
    const surfaces = { version: 2, stacks: {}, pinnedTools: [], contexts: { [X]: B } };
    const first = await read({ 'main.tabs': stored, 'panelTools.surfaces': surfaces });
    expect(first.result).toEqual({ merged: false });
    expect(surfaceSession(first.store.getState())).toBe(B);
    const written = { 'main.tabs': writes(first.fake, 'main.tabs'), 'panelTools.surfaces': writes(first.fake, 'panelTools.surfaces') };
    expect(written).toEqual({ 'main.tabs': [storedMain(first.store.getState().main)], 'panelTools.surfaces': [{ ...surfaces, contexts: { [NO_PROJECT]: B } }] });
    const again = await read({ 'main.tabs': written['main.tabs'][0], 'panelTools.surfaces': written['panelTools.surfaces'][0] });
    expect(again.result).toEqual({ merged: false });
    expect(surfaceSession(again.store.getState())).toBe(B);
    expect([...writes(again.fake, 'main.tabs'), ...writes(again.fake, 'panelTools.surfaces')]).toEqual([]);
  });

  it('a strip written and read back is the same strip: order, pins, split and ratio, floating card, each pane’s tab in front, focus, history', async () => {
    const strip: Strip = {
      panes: [{ tabs: [{ ...diagnostics, pinned: true }, tab(A), notes], activeTabId: `session:${A}` }, { tabs: [tab(B), tab(C)], activeTabId: `session:${C}` }],
      focusedPane: 1,
      splitRatio: 0.3,
      floating: { sessionTabId: `session:${C}` },
      closedTabs: [tab(at('app-d' as AppSessionId))],
    };
    const { store, fake, result } = await read({ 'main.tabs': storedMain(strip) });
    expect(result).toEqual({ merged: false });
    expect(store.getState().main).toEqual(strip);
    expect(writes(fake, 'main.tabs')).toEqual([]);
  });

  it('a tab opened before the read is replayed over the merged strip', async () => {
    const { store } = await read({ 'main.tabs': sets }, { early: (s) => s.getState().openSession(C, { how: 'tab' }) });
    expect(store.getState().main.panes[0]).toEqual({ tabs: [tab(A), tab(C), notes, diagnostics, tab(B)], activeTabId: `session:${C}` });
  });

  it('a fold stored in a set that was not showing ends with that set’s float in the merge, and the side column opens again', async () => {
    const folded = { panes: [{ tabs: [tab(A)], activeTabId: `session:${A}` }, { tabs: [tab(B)], activeTabId: `session:${B}` }], focusedPane: 0, splitRatio: 0.4, floating: { sessionTabId: `session:${B}`, foldedPanel: true } };
    const regions = { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, collapsed: true } };
    const { store, fake } = await read({ regions, 'main.tabs': { version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: one([diagnostics]), [Y]: folded }, closedTabs: [] } });
    expect(store.getState().main).toEqual({ ...EMPTY_STRIP, panes: [{ tabs: [diagnostics, tab(A), tab(B)], activeTabId: 'diagnostics' }] });
    expect(store.getState().regions.panel.collapsed).toBe(false);
    expect(writes(fake, 'regions')).toEqual([store.getState().regions]);
  });

  it('a session of another project opens in the same strip: beside the tabs with ⌘-click, in the place of the tab in front with a plain click (I2)', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    s().openTab({ kind: 'diagnostics' });
    s().openSession(B, { how: 'tab' });
    expect(allTabs(s().main).map((t) => t.id)).toEqual([`session:${A}`, 'diagnostics', `session:${B}`]);
    s().openSession(C);
    expect(allTabs(s().main).map((t) => t.id)).toEqual([`session:${A}`, 'diagnostics', `session:${C}`]);
    expect(s().main.closedTabs.map((t) => t.id)).toEqual([`session:${B}`]);
  });

  // l6-artifacts-13 (A11): a file opened from a session's card column no longer files the strip away from the tabs
  it('opening a file of a session beside a deck’s tab and a document’s tab keeps both in the strip', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    s().openTab({ kind: 'artifact', artifactId: 'deck-1', machine: M });
    s().openTab({ kind: 'artifact', artifactId: 'doc-1', machine: M });
    s().openTab({ kind: 'file', path: '/w/notes.md', line: 3, appSessionId: A, machine: M });
    expect(allTabs(s().main).map((t) => t.id)).toEqual([`session:${A}`, `artifact:${M}:deck-1`, `artifact:${M}:doc-1`, notes.id]);
    expect(frontOf(s())).toBe(notes.id);
  });

  it('frontOf is the tab in front of the focused pane, and empty for an empty pane', () => {
    const store = createLayoutStore();
    expect(frontOf(store.getState())).toBe('');
    store.getState().openSession(A);
    store.getState().openSession(B, { split: true });
    expect(frontOf(store.getState())).toBe(`session:${B}`);
    store.getState().showPane(0);
    expect(frontOf(store.getState())).toBe(`session:${A}`);
    store.getState().focusPane(1);
    expect(frontOf(store.getState())).toBe(`session:${B}`);
  });
});

// UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, Interfaces §F): the page
// and the Settings dialog beside the strip, and U13a's table of acts with the effect `commitShown` now has.
describe('the page and the Settings dialog', () => {
  const B = at('app-b' as AppSessionId);
  const C = at('app-c' as AppSessionId);
  const PAGE = { kind: 'customize', view: 'mine', show: 'skills' } as const;
  // A store showing A, B and C in one pane (C in front), with a closed tab to reopen, a page and the dialog open, and the
  // number of writes counted from here.
  function opened() {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    s().openSession(B, { how: 'tab' });
    s().openSession(C, { how: 'tab' });
    s().openSession(at('app-d' as AppSessionId), { how: 'tab' });
    s().closeTab(`session:${at('app-d' as AppSessionId)}`);
    s().openDestination(PAGE);
    s().openSettings('engine');
    let writes = 0;
    store.subscribe(() => (writes += 1));
    return { store, s, writes: () => writes };
  }

  const shows: [string, (s: ReturnType<typeof createLayoutStore>['getState']) => void][] = [
    ['openTab', (s) => s().openTab({ kind: 'diagnostics' })],
    ['openSession', (s) => s().openSession(B)],
    ['activateTab', (s) => s().activateTab(`session:${A}`)],
    ['activateTab of the tab in front', (s) => s().activateTab(`session:${C}`)],
    ['selectTab', (s) => s().selectTab(1)],
    ['cycleTab', (s) => s().cycleTab(1)],
    ['reopenClosed', (s) => s().reopenClosed()],
    ['moveTab', (s) => s().moveTab(`session:${A}`, 0, 2)],
    ['reorderTab', (s) => s().reorderTab(`session:${A}`, 2)],
    ['splitWithActive', (s) => s().splitWithActive()],
    ['showPane', (s) => s().showPane(0)],
  ];
  for (const [name, act] of shows) {
    it(`${name} closes the page and the dialog in the write that lands it`, () => {
      const { store, writes } = opened();
      act(store.getState);
      expect([store.getState().destination, store.getState().settings]).toEqual([null, null]);
      expect(writes()).toBe(1);
    });
  }

  const keeps: [string, (s: ReturnType<typeof createLayoutStore>['getState']) => void][] = [
    ['focusPane', (s) => s().focusPane(0)],
    ['openTab with activate: false', (s) => s().openTab({ kind: 'diagnostics' }, { activate: false })],
    ['closeTab', (s) => s().closeTab(`session:${A}`)],
    ['togglePinned', (s) => s().togglePinned(`session:${A}`)],
    ['setSplitRatio', (s) => s().setSplitRatio(0.3)],
    ['dropSession', (s) => s().dropSession(A)],
    ['refreshTabTitles', (s) => s().refreshTabTitles()],
  ];
  for (const [name, act] of keeps) {
    it(`${name} closes neither`, () => {
      const { store } = opened();
      act(store.getState);
      expect([store.getState().destination, store.getState().settings]).toEqual([PAGE, { section: 'engine' }]);
    });
  }

  it('openDestination closes the dialog and leaves the strip equal by reference; the same kind again changes only its fields', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    const strip = s().main;
    s().openSettings();
    s().openDestination(PAGE);
    expect([s().destination, s().settings, s().main]).toEqual([PAGE, null, strip]);
    expect(s().main).toBe(strip);
    s().openDestination({ ...PAGE, view: 'discover', show: 'all' });
    expect(s().destination).toEqual({ kind: 'customize', view: 'discover', show: 'all' });
    const held = s().destination;
    s().openDestination({ kind: 'customize', view: 'discover', show: 'all' });
    expect(s().destination, 'the same page again writes nothing').toBe(held);
    s().openDestination({ kind: 'library' });
    expect(s().destination).toEqual({ kind: 'library' });
    expect(s().main).toBe(strip);
  });

  it('closeDestination and closeSettings leave the strip equal by reference', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    const strip = s().main;
    s().openDestination({ kind: 'projects' });
    s().openSettings('voice');
    s().closeSettings();
    expect([s().settings, s().destination]).toEqual([null, { kind: 'projects' }]);
    s().closeDestination();
    expect(s().destination).toBeNull();
    expect(s().main).toBe(strip);
  });

  it('openSettings over a page keeps it; open already, only a section that is given changes', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openDestination({ kind: 'projects' });
    s().openSettings('voice');
    expect([s().destination, s().settings]).toEqual([{ kind: 'projects' }, { section: 'voice' }]);
    s().openSettings();
    expect(s().settings).toEqual({ section: 'voice' });
    s().openSettings('engine');
    expect(s().settings).toEqual({ section: 'engine' });
  });

  it('closeFront closes the dialog and keeps the page, then closes the page, then answers false', () => {
    const { s } = opened();
    expect(s().closeFront()).toBe(true);
    expect([s().destination, s().settings]).toEqual([PAGE, null]);
    expect(s().closeFront()).toBe(true);
    expect(s().destination).toBeNull();
    const strip = s().main;
    expect(s().closeFront()).toBe(false);
    expect(s().main).toBe(strip);
  });

  it('setOverviewOpen(true) closes the dialog and keeps the page', () => {
    const { s } = opened();
    s().setOverviewOpen(true);
    expect([s().overviewOpen, s().destination, s().settings]).toEqual([true, PAGE, null]);
  });

  // The architect's ruling on M5: while the Overview is over the main region the side column is docked; over a page it
  // docks nothing until the page closes under it.
  describe('the Overview over a page, with the side column maximized', () => {
    function maximized() {
      const store = createLayoutStore();
      const s = () => store.getState();
      s().setPanel({ maximized: true, collapsed: false });
      s().openDestination(PAGE);
      return s;
    }

    it('opened, closed, then Back: the column is maximized as it was, its regions the same object', () => {
      const s = maximized();
      const regions = s().regions;
      s().setOverviewOpen(true);
      expect(s().regions).toBe(regions);
      s().setOverviewOpen(false);
      s().closeDestination();
      expect(s().regions).toBe(regions);
      expect(s().regions.panel.maximized).toBe(true);
    });

    it('the page left with the Overview still open: the column is docked in the write that closes the page', () => {
      const s = maximized();
      const strip = s().main;
      s().setOverviewOpen(true);
      s().closeDestination();
      expect([s().destination, s().overviewOpen]).toEqual([null, true]);
      expect(s().regions.panel).toMatchObject({ maximized: false, floating: false, collapsed: false });
      expect(s().main).toEqual(strip);
    });

    it('a tab shown with the Overview open over the page docks the column too', () => {
      const s = maximized();
      s().setOverviewOpen(true);
      s().openSession(B);
      expect([s().destination, s().overviewOpen, s().regions.panel.maximized]).toEqual([null, true, false]);
    });

    it('with no page, opening the Overview docks the column at once, as before', () => {
      const store = createLayoutStore();
      store.getState().setPanel({ maximized: true, collapsed: false });
      store.getState().setOverviewOpen(true);
      expect(store.getState().regions.panel.maximized).toBe(false);
    });
  });

  it('inside quietly an activating openTab closes neither; outside it, the same call does', () => {
    const { s } = opened();
    expect(quietly(() => { s().openTab({ kind: 'diagnostics' }); return frontOf(s()); })).toBe('diagnostics');
    expect([s().destination, s().settings]).toEqual([PAGE, { section: 'engine' }]);
    s().openTab({ kind: 'diagnostics' });
    expect([s().destination, s().settings]).toEqual([null, null]);
  });

  it('the selectors: pageOpen, placeOf, tabOnScreen', () => {
    const { s } = opened();
    expect([pageOpen(s()), placeOf(s()), tabOnScreen(s())]).toEqual([true, 'settings', null]);
    s().closeSettings();
    expect(placeOf(s())).toBe('page:customize');
    s().closeDestination();
    expect([pageOpen(s()), placeOf(s()), tabOnScreen(s())?.id]).toEqual([false, `session:${C}`, `session:${C}`]);
  });
});

describe('tab changes before hydration', () => {
  it('a tab opened while the layout snapshot is outstanding is replayed over the hydrated tabs', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, (id) => id === A || id === ('b' as AppSessionId));
    store.getState().openSession('b' as AppSessionId, { how: 'tab' }); // a ⌘-click before layout.get answers
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:b']); // shown at once
    await new Promise((resolve) => setTimeout(resolve, 0)); // layout.list answered; the three reads are outstanding
    expect(fake.pending('layout.get')).toBe(3);
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'main.tabs' ? persistedMain : null });
    await hydrating;
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, 'session:b']); // after the hydrated active tab
    expect(shown(store).panes[0].activeTabId).toBe('session:b');
    store.getState().openSession(A); // after hydration a change applies once, as before
    expect(shown(store).panes[0].activeTabId).toBe(`session:${A}`);
  });
});

// W5: a project opened in the sidebar before the persisted regions arrive stays open, and the result is written back.
describe('region changes before hydration', () => {
  it('opening Overview before the regions arrive restores main over the saved maximized panel and persists it', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['regions'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, () => true);
    store.getState().setOverviewOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = { ...LAYOUT_DEFAULTS.regions, panel: { width: 444, collapsed: false, maximized: true, floating: false } };
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'regions' ? saved : null });
    await hydrating;
    const restored = { ...saved, panel: { ...saved.panel, maximized: false } };
    expect(store.getState().overviewOpen).toBe(true);
    expect(store.getState().regions).toEqual(restored);
    expect(fake.invoked('layout.set')).toContainEqual({ key: 'regions', value: restored });
  });

  it('are replayed over the hydrated regions', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['regions'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, () => true);
    store.getState().setSidebar({ expandedProjects: ['proj-a' as ProjectId] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 260 } };
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'regions' ? saved : null });
    await hydrating;
    expect(store.getState().regions.sidebar).toEqual({ ...saved.sidebar, expandedProjects: ['proj-a'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.invoked('layout.set')).toContainEqual({ key: 'regions', value: store.getState().regions });
  });

  it('an updater is replayed over the hydrated sidebar, so an early expansion adds to the saved ones', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['regions'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, () => true);
    store.getState().setSidebar(({ expandedProjects }) => ({ expandedProjects: [...expandedProjects, 'proj-b' as ProjectId] }));
    expect(store.getState().regions.sidebar.expandedProjects).toEqual(['proj-b']); // against the default, until hydration
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, expandedProjects: ['proj-a' as ProjectId] } };
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'regions' ? saved : null });
    await hydrating;
    expect(store.getState().regions.sidebar.expandedProjects).toEqual(['proj-a', 'proj-b']);
  });
});

// P5 O6 M4 ("The layout across machines"): a machine's first snapshot of the run settles its tabs, as hydration settles
// this machine's.
describe('settling a machine’s tabs', () => {
  const onB = (id: string) => addressOf(OTHER_MACHINE, id as AppSessionId);
  const main = (...ids: string[]) => storedMain({ ...EMPTY_STRIP, panes: [{ tabs: ids.map(session), activeTabId: `session:${ids[0]}` }] } as Strip);
  const tabIds = (store: ReturnType<typeof createLayoutStore>) => shown(store).panes.flatMap((p) => p.tabs.map((t) => t.id));

  it('drops that machine’s tabs it does not list, and no other machine’s', async () => {
    let loaded = false; // B's snapshot: until it is in, B's tabs are kept
    const { store } = await hydrate({ 'main.tabs': main(A, onB('b1'), onB('b9')) }, (id) => id === A || id === onB('b1') || !loaded);
    expect(tabIds(store)).toEqual([`session:${A}`, `session:${onB('b1')}`, `session:${onB('b9')}`]);
    loaded = true;
    store.getState().settleMachine(M);
    expect(tabIds(store)).toHaveLength(3); // this machine's settle judges only its own tabs
    store.getState().settleMachine(OTHER_MACHINE);
    expect(tabIds(store)).toEqual([`session:${A}`, `session:${onB('b1')}`]);
  });

  it('does nothing before hydration', () => {
    const store = createLayoutStore();
    store.getState().openSession(onB('b9'), { how: 'tab' });
    store.getState().settleMachine(OTHER_MACHINE);
    expect(tabIds(store)).toEqual([`session:${onB('b9')}`]);
  });
});

// P5 O6 M5 ("Migrating project-keyed state"): the sidebar's expanded rows keyed by a project's address (a key from before
// M5) move to its org project's key at hydration, and again as each machine's projects arrive (U13a: the tabs hold no
// project key any more).
describe('rekeying the expanded rows to org keys', () => {
  const P1 = at('p1' as ProjectId);
  const P2 = addressOf(OTHER_MACHINE, 'p2' as ProjectId);
  const ORG = 'repo:maws' as never;
  const values = { regions: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, expandedProjects: [P1, P2, 'other'] } } };

  it('moves what it can at hydration, leaves a machine not loaded yet, and moves its keys on its arrival', async () => {
    let otherLoaded = false;
    const rekeyOf: RekeyOf = (key) => (key === P1 ? ORG : otherLoaded ? ORG : 'wait');
    const fake = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: (values as Record<string, unknown>)[key] ?? null }) });
    const store = createLayoutStore();
    await store.getState().hydrate(fake.client, () => true, { rekeyOf });
    expect(store.getState().regions.sidebar.expandedProjects).toEqual([ORG, P2, `machine:${M}`]);
    const before = store.getState().main;
    otherLoaded = true;
    store.getState().rekeyProjects();
    expect(store.getState().regions.sidebar.expandedProjects).toEqual([ORG, `machine:${M}`]);
    expect(store.getState().main).toBe(before);
  });
});

// P5 O6 M2 (M6's scene): a session tab keeps its session's last-known title, so a tab of a machine that has not loaded in
// this run (its record not held) is still named; the title is written only when it differs from the one the tab holds.
describe('a session tab’s last-known title', () => {
  it('is set when the tab opens and refreshed when its record’s title changes, and only then', async () => {
    const titles = new Map<AppSessionId, string>([[A, 'First title']]);
    const fake = fakeClient({ 'layout.list': { keys: [] }, 'layout.get': () => ({ value: null }) });
    const store = createLayoutStore();
    await store.getState().hydrate(fake.client, () => true, { titleOf: (id: AppSessionId) => titles.get(id) });
    store.getState().openSession(A);
    const tab = () => allTabs(store.getState().main).find((t) => t.id === `session:${A}`);
    expect(tab()).toMatchObject({ title: 'First title' });
    const before = store.getState().main;
    store.getState().refreshTabTitles();
    expect(store.getState().main, 'nothing differs: nothing changes, so nothing is written').toBe(before);
    titles.set(A, 'Renamed');
    store.getState().refreshTabTitles();
    expect(tab()).toMatchObject({ title: 'Renamed' });
    titles.delete(A); // its record not held (its machine not loaded): the title it had stays
    store.getState().refreshTabTitles();
    expect(tab()).toMatchObject({ title: 'Renamed' });
  });

  it('reads a tab saved before the title was kept, and a saved title back', async () => {
    const titled = { ...lifted('app-a'), title: 'Saved title' };
    const saved = storedMain({ ...EMPTY_STRIP, panes: [{ tabs: [titled, lifted('app-b')], activeTabId: titled.id }] } as Strip);
    const { store } = await hydrate({ 'main.tabs': saved }, () => true);
    expect(allTabs(store.getState().main)).toEqual([titled, lifted('app-b')]);
  });
});
