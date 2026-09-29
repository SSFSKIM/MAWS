import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type LayoutMain } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore } from './layout';

const A = 'app-a' as AppSessionId;
const session = (id: string) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const persistedMain: LayoutMain = {
  ...LAYOUT_DEFAULTS.main,
  panes: [{ tabs: [LAYOUT_DEFAULTS.main.panes[0].tabs[0], session('app-a') as never, session('gone') as never], activeTabId: 'session:gone' }],
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
    expect(store.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:app-a']);
    expect(store.getState().main.panes[0].activeTabId).toBe('overview');
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
    expect(s().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:app-a', 'session:c']);
    s().reopenClosed();
    expect(s().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:app-a', 'session:b', 'session:c']);
    s().dropSession(A);
    expect(s().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:b', 'session:c']);
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

  it('patches the regions', () => {
    const store = createLayoutStore();
    store.getState().setSidebar({ width: 240 });
    store.getState().setPanel({ collapsed: true });
    expect(store.getState().regions.sidebar.width).toBe(240);
    expect(store.getState().regions.panel).toEqual({ ...LAYOUT_DEFAULTS.regions.panel, collapsed: true });
  });
});

describe('tab changes before hydration', () => {
  it('a tab opened while the layout snapshot is outstanding is replayed over the hydrated tabs', async () => {
    const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } });
    const store = createLayoutStore();
    const hydrating = store.getState().hydrate(fake.client, (id) => id === A || id === ('b' as AppSessionId));
    store.getState().openSession('b' as AppSessionId); // a click before layout.get answers
    expect(store.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:b']); // shown at once
    await new Promise((resolve) => setTimeout(resolve, 0)); // layout.list answered; the three reads are outstanding
    expect(fake.pending('layout.get')).toBe(3);
    for (const key of ['regions', 'main.tabs', 'panel.pinned']) await fake.reply('layout.get', { value: key === 'main.tabs' ? persistedMain : null });
    await hydrating;
    expect(store.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:b', 'session:app-a']);
    expect(store.getState().main.panes[0].activeTabId).toBe('session:b');
    store.getState().openSession(A); // after hydration a change applies once, as before
    expect(store.getState().main.panes[0].activeTabId).toBe('session:app-a');
  });
});
