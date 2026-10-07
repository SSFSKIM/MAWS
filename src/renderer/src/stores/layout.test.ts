import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type LayoutMainV1 } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore, registerReplaceGuard } from './layout';
import { currentSet } from './layout-model';

const A = 'app-a' as AppSessionId;
const session = (id: string) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
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
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a']);
    expect(shown(store).panes[0].activeTabId).toBe('session:app-a');
  });

  // W5: every layout saved before the floating Overview holds the Overview's tab, usually first and active. Reading it must
  // keep the user's tabs (not fail over to the default's empty pane) and show the first of them in the Overview's place.
  it('hydrating a layout saved with the Overview tab drops that tab, its pane activating the first remaining tab', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overview = { id: 'overview', kind: 'overview', pinned: true };
    const saved = { ...persistedMain, panes: [{ tabs: [overview, session('app-a'), session('b')], activeTabId: 'overview' }], closedTabs: [overview] };
    const { store } = await hydrate({ 'main.tabs': saved }, () => true);
    expect(store.getState().main).toEqual({ ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [session('app-a'), session('b')], activeTabId: 'session:app-a' }] } } });
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
    store.getState().openTab({ kind: 'file', path: '/r/early.ts', line: null, appSessionId: 'gone' as AppSessionId });
    await store.getState().hydrate(fake.client, () => false);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['file:/r/saved.ts', 'file:/r/early.ts']);
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
    expect(currentSet(s().main).panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a', 'session:c']);
    s().reopenClosed();
    expect(currentSet(s().main).panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a', 'session:b', 'session:c']);
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

  it('clears the no-session selection when setPanelTabs(null, …) asks for none (the panel home glyph with no session shown)', () => {
    const store = createLayoutStore();
    const pin = { id: 't1', toolId: 'files', pinned: true };
    store.getState().setPanelTabs(null, { tabs: [pin], activeTabId: 't1' });
    expect(store.getState().panelActiveNoSession).toBe('t1');
    store.getState().setPanelTabs(null, { tabs: [pin], activeTabId: null });
    expect(store.getState().panelActiveNoSession).toBeNull();
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
    expect(store.getState().regions).toEqual({ ...before.regions, panel: { width: 444, collapsed, maximized: false } });
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
      const saved = { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [session(A), session(NEW)], activeTabId: `session:${NEW}` }] } } };
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

// W12 (I3): the store files a session's tabs under the project hydration's `projectOf` answers.
describe('tab sets per project', () => {
  const X = 'proj-x' as ProjectId;
  const Y = 'proj-y' as ProjectId;
  const projects: Record<string, ProjectId | null> = { [A]: X, b: X, y1: Y, new: Y };
  const projectOf = (id: AppSessionId) => projects[id] ?? null;
  async function hydrated(values: Record<string, unknown> = {}) {
    const fake = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }) });
    const store = createLayoutStore();
    await store.getState().hydrate(fake.client, () => true, { projectOf });
    return store;
  }

  it('every open of a session shows its project’s set first; setCurrentProject switches; ⌘⇧T reopens into the tab’s set', async () => {
    const store = await hydrated();
    const s = () => store.getState();
    s().openSession(A);
    s().openTab({ kind: 'session', appSessionId: 'b' as AppSessionId }); // a notification's or a fork's open
    expect(s().main.current).toBe(X);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, 'session:b']);
    s().openSession('y1' as AppSessionId);
    expect(s().main.current).toBe(Y);
    s().setCurrentProject(X);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, 'session:b']);
    s().closeTab('session:b');
    s().setCurrentProject(null);
    expect(s().main.current).toBe(NO_PROJECT);
    s().reopenClosed();
    expect(s().main.current).toBe(X);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual([`session:${A}`, 'session:b']);
  });

  it('refileTabs moves an unstarted tab whose intent got a project, and the strip follows it', async () => {
    const store = await hydrated();
    projects.new = null;
    try {
      store.getState().openSession('new' as AppSessionId, { how: 'tab' });
      expect(store.getState().main.current).toBe(NO_PROJECT);
    } finally {
      projects.new = Y;
    }
    store.getState().refileTabs();
    expect(store.getState().main.current).toBe(Y);
    expect(Object.keys(store.getState().main.sets)).toEqual([Y]);
  });

  it('an unstarted tab in the session’s project’s set is asked about once the strip shows the session there', async () => {
    const store = await hydrated();
    const discard = vi.fn(async () => true);
    const off = registerReplaceGuard({ unstarted: (id) => id === 'new', discard });
    try {
      store.getState().openSession('new' as AppSessionId, { how: 'tab' }); // in Y
      store.getState().openSession(A); // X
      store.getState().openSession('y1' as AppSessionId);
      expect(store.getState().main.current).toBe(Y); // switched, and the session shown, before the guard answers
      expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:new', 'session:y1']);
      expect(discard).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:y1']);
    } finally {
      off();
    }
  });

  // The review's F1: discarding the draft's intent refiles it (to the no-project set) before the guard answers; the
  // session already stands in its own project's set, and the strip stays there.
  it('a draft refiled while its guard decides leaves the session in its project’s set and the strip on it', async () => {
    const store = await hydrated();
    const off = registerReplaceGuard({
      unstarted: (id) => id === 'new',
      discard: async () => {
        projects.new = null; // the intent went: the draft falls back to the project it was created with, none
        store.getState().refileTabs(); // as the intents subscription does
        return true;
      },
    });
    try {
      store.getState().openSession('new' as AppSessionId, { how: 'tab' }); // in Y
      store.getState().openSession('y1' as AppSessionId);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.getState().main.current).toBe(Y);
      expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:y1']);
      expect(Object.keys(store.getState().main.sets)).toEqual([Y]); // the draft's brief none set went with it
      expect(store.getState().main.closedTabs).toEqual([]);
    } finally {
      projects.new = Y;
      off();
    }
  });

  it('a change made before hydration is replayed with the project hydration answers', async () => {
    const fake = fakeClient({ 'layout.list': { keys: [] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, () => true, { projectOf });
    store.getState().openSession('y1' as AppSessionId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 3; i += 1) await fake.reply('layout.get', { value: null });
    await hydrating;
    expect(store.getState().main.current).toBe(Y);
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:y1']);
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
    expect(shown(store).panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a', 'session:b']); // after the hydrated active tab
    expect(shown(store).panes[0].activeTabId).toBe('session:b');
    store.getState().openSession(A); // after hydration a change applies once, as before
    expect(shown(store).panes[0].activeTabId).toBe('session:app-a');
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
    const saved = { ...LAYOUT_DEFAULTS.regions, panel: { width: 444, collapsed: false, maximized: true } };
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
