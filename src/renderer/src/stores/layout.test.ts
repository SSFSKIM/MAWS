import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type LayoutMain } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore } from './layout';

const A = 'app-a' as AppSessionId;
const session = (id: string) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const persistedMain: LayoutMain = {
  ...LAYOUT_DEFAULTS.main,
  panes: [{ tabs: [session('app-a') as never, session('gone') as never], activeTabId: 'session:gone' }],
};

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
    expect(store.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a']);
    expect(store.getState().main.panes[0].activeTabId).toBe('session:app-a');
  });

  // W5: every layout saved before the floating Overview holds the Overview's tab, usually first and active. Reading it must
  // keep the user's tabs (not fail over to the default's empty pane) and show the first of them in the Overview's place.
  it('hydrating a layout saved with the Overview tab drops that tab, its pane activating the first remaining tab', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overview = { id: 'overview', kind: 'overview', pinned: true };
    const saved = { ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [overview, session('app-a'), session('b')], activeTabId: 'overview' }], closedTabs: [overview] };
    const { store } = await hydrate({ 'main.tabs': saved }, () => true);
    expect(store.getState().main).toEqual({ ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [session('app-a'), session('b')], activeTabId: 'session:app-a' }] });
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
});

describe('layout store actions', () => {
  it('delegates the tab transitions and remembers where a closed tab stood', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A);
    s().openSession('b' as AppSessionId);
    s().openSession('c' as AppSessionId);
    s().activateTab('session:b');
    s().closeTab('session:b');
    expect(s().main.panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a', 'session:c']);
    s().reopenClosed();
    expect(s().main.panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a', 'session:b', 'session:c']);
    s().dropSession(A);
    expect(s().main.panes[0].tabs.map((t) => t.id)).toEqual(['session:b', 'session:c']);
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

describe('tab changes before hydration', () => {
  it('a tab opened while the layout snapshot is outstanding is replayed over the hydrated tabs', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, (id) => id === A || id === ('b' as AppSessionId));
    store.getState().openSession('b' as AppSessionId); // a click before layout.get answers
    expect(store.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['session:b']); // shown at once
    await new Promise((resolve) => setTimeout(resolve, 0)); // layout.list answered; the three reads are outstanding
    expect(fake.pending('layout.get')).toBe(3);
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'main.tabs' ? persistedMain : null });
    await hydrating;
    expect(store.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['session:app-a', 'session:b']); // after the hydrated active tab
    expect(store.getState().main.panes[0].activeTabId).toBe('session:b');
    store.getState().openSession(A); // after hydration a change applies once, as before
    expect(store.getState().main.panes[0].activeTabId).toBe('session:app-a');
  });
});

// W5: a project opened in the sidebar before the persisted regions arrive stays open, and the result is written back.
describe('region changes before hydration', () => {
  it('are replayed over the hydrated regions', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['regions'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, () => true);
    store.getState().setSidebar({ openProject: 'proj-a' as ProjectId });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 260 } };
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'regions' ? saved : null });
    await hydrating;
    expect(store.getState().regions.sidebar).toEqual({ ...saved.sidebar, openProject: 'proj-a' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.invoked('layout.set')).toContainEqual({ key: 'regions', value: store.getState().regions });
  });
});
