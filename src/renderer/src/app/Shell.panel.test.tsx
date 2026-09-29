// C8a, M3: the panel host inside C5's real `Shell` (C5's `Shell.test.tsx` is not edited). The region hands the host
// its props exactly as the product does; persistence runs over a fake bridge that records `layout.json`'s writes, and a
// relaunch is a fresh layout store hydrated from those writes. Persistence subscribes before `connectPanelHost`, as in
// `App.tsx`, because the hydration barrier writes inside the hydration notification.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSessionState, PanelTabRef } from '@shared/ipc/schema/layout';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { queryClient } from '../ipc/query';
import { connectPanelHost, instanceIds, panelHost, pendingAdds, registerPanelTool, resetPanelHost } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import type { PanelTool } from '../panel/tool';
import { createLayoutStore, persistLayout, useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import {
  A,
  B,
  heldBridge,
  hydrateHeld,
  mainShowing,
  panelOf,
  persisted,
  pinIds,
  probeTool,
  type ProbeState,
  ref,
  resetPanelStores,
} from '../test-support/panel';
import { Shell } from './Shell';
import { registerSlot, resetSlots } from './slots';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const offs: (() => void)[] = [];
const register = (...tools: PanelTool<ProbeState, unknown>[]) => offs.push(...tools.map((t) => registerPanelTool(t)));
const connect = () => offs.push(connectPanelHost());
// As connectShell does on session.removed (each removal a newer revision: the sessions store keeps a tombstone per id).
let revision = 1000;
const removeA = () => {
  if (useSessions.getState().applyRemoved({ appSessionId: A, revision: (revision += 1) })) useLayout.getState().dropSession(A);
};
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const panel = () => document.querySelector<HTMLElement>('[data-region="panel"]')!;
const stripIds = () => [...panel().querySelectorAll<HTMLElement>('[data-tab-id]')].map((el) => el.dataset.tabId);
const selectedId = () => panel().querySelector('[role="tab"][aria-selected="true"]')?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId ?? null;
const shownSession = () => {
  const tab = activeTab(useLayout.getState().main);
  return tab.kind === 'session' ? tab.appSessionId : null;
};
const sessionTabs = () => useLayout.getState().main.panes.flatMap((p) => p.tabs.filter((t) => t.kind === 'session').map((t) => t.id));

// The product's composition: C8a's host in C5's slot, the whole Shell under TanStack Query's provider (App.tsx).
function renderShell() {
  registerSlot('panelHost', PanelHost);
  return render(
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>,
  );
}

const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

beforeEach(() => {
  setWindowWidth(1440);
  resetPanelStores();
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  resetSlots();
});

describe('shell renders the panel host in the region', () => {
  it('shows the pin first and the session’s selected tab over the summary, and the pin glyph moves the ref as C5’s region does', async () => {
    const user = userEvent.setup();
    register(probeTool('terminal').tool); // `files` stays unregistered: a placeholder tab
    useLayout.setState({
      panelPinned: [ref('terminal:pin00000', true)],
      panelBySession: new Map([[A, { tabs: [ref('files:aaaaaaaa')], activeTabId: 'files:aaaaaaaa' }]]),
    });
    renderShell();
    expect(stripIds()).toEqual(['terminal:pin00000', 'files:aaaaaaaa']);
    expect(selectedId()).toBe('files:aaaaaaaa');
    expect(within(panel()).getByText('Arrives with C8c')).toBeTruthy();
    expect(within(panel()).queryByText(/^Tools stay with this session/)).toBeNull(); // the summary is behind the tab

    await user.click(within(panel()).getByRole('button', { name: 'Pin files' }));
    expect(pinIds()).toEqual(['terminal:pin00000', 'files:aaaaaaaa']);
    expect(panelOf(A)).toEqual({ tabs: [], activeTabId: 'files:aaaaaaaa' });
    expect(stripIds()).toEqual(['terminal:pin00000', 'files:aaaaaaaa']);
  });

  it('a restored tab whose tool registers after hydration gets its instance at the registration', () => {
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('files:aaaaaaaa')], activeTabId: 'files:aaaaaaaa' }]]) });
    renderShell();
    expect(within(panel()).getByText('Arrives with C8c')).toBeTruthy();
    const files = probeTool('files');
    act(() => void register(files.tool));
    expect(files.probe.created).toEqual([{ appSessionId: A, session: expect.objectContaining({ appId: A }), instanceId: 'files:aaaaaaaa', params: undefined }]);
    expect(screen.getByTestId('body:files:aaaaaaaa').textContent).toBe(`files · ${A} · unpinned · visible · focus 0`);
  });

  it('dropSession disposes the removed session’s instances without beforeClose and keeps the pin’s', () => {
    connect();
    const { tool, probe } = probeTool('terminal');
    register(tool);
    useLayout.setState({
      panelPinned: [ref('terminal:pin00000', true)],
      panelBySession: new Map([[A, { tabs: [ref('terminal:aaaaaaaa')], activeTabId: 'terminal:aaaaaaaa' }]]),
    });
    renderShell();
    expect(instanceIds().sort()).toEqual(['terminal:aaaaaaaa', 'terminal:pin00000']);
    act(removeA);
    expect(probe.disposed).toEqual(['terminal:aaaaaaaa']);
    expect(probe.beforeClose).toEqual([]);
    expect(instanceIds()).toEqual(['terminal:pin00000']);
    expect(shownSession()).toBeNull(); // the Overview: the pin alone in the strip
    expect(stripIds()).toEqual(['terminal:pin00000']);
  });

  it('addTool for a session with activate: false while the Overview is focused writes that session’s list and switches nothing', () => {
    const { tool, probe } = probeTool('terminal');
    register(tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)], panelActiveNoSession: 'terminal:pin00000' });
    renderShell();
    const main = useLayout.getState().main;
    let id = '';
    act(() => void (id = panelHost.addTool('terminal', { appSessionId: A, activate: false })));
    expect(panelOf(A)).toEqual({ tabs: [ref(id)], activeTabId: null });
    expect(pinIds()).toEqual(['terminal:pin00000']);
    expect(useLayout.getState().panelActiveNoSession).toBe('terminal:pin00000');
    expect(useLayout.getState().main).toBe(main);
    expect(stripIds()).toEqual(['terminal:pin00000']);
    expect(selectedId()).toBe('terminal:pin00000');
    expect(probe.created.at(-1)).toMatchObject({ appSessionId: A, instanceId: id });
  });

  it('the same call with activate defaulted opens the session’s tab and selects the new tab in its list', () => {
    register(probeTool('terminal').tool);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, panelPinned: [ref('terminal:pin00000', true)], panelActiveNoSession: 'terminal:pin00000' });
    renderShell();
    let id = '';
    act(() => void (id = panelHost.addTool('terminal', { appSessionId: A })));
    expect(shownSession()).toBe(A);
    expect(panelOf(A)).toEqual({ tabs: [ref(id)], activeTabId: id });
    expect(stripIds()).toEqual(['terminal:pin00000', id]);
    expect(selectedId()).toBe(id);
    expect(screen.getByTestId(`body:${id}`).textContent).toBe(`terminal · ${A} · unpinned · visible · focus 1`);
  });

  describe('over a held hydration and a recorded layout.json', () => {
    beforeEach(() => resetPanelStores({ hydrated: false }));

    it('an addTool before hydration writes nothing, lands after it, is persisted, and a relaunch from the writes shows the tab', async () => {
      const bridge = heldBridge(persisted({ 'main.tabs': mainShowing(B) }));
      const stopPersistence = persistLayout(bridge.client);
      connect();
      const terminal = probeTool('terminal');
      register(terminal.tool);
      renderShell();
      let own = '';
      let pin = '';
      await hydrateHeld(bridge, () => {
        own = panelHost.addTool('terminal', { appSessionId: A, activate: false });
        pin = panelHost.addTool('terminal', { appSessionId: null, pin: true, activate: false });
        expect(pendingAdds().map((p) => p.id)).toEqual([own, pin]);
        expect(terminal.probe.created).toEqual([]);
        expect([pinIds(), panelOf(A)]).toEqual([[], undefined]);
      });
      expect(shownSession()).toBe(B);
      expect(panelOf(A)!.tabs).toEqual([ref(own)]);
      expect(pinIds()).toEqual([pin]);
      expect(stripIds()).toEqual([pin]); // B on screen: the pin alone
      expect(bridge.sets.filter((s) => s.key.startsWith('panel.'))).toEqual([]); // not yet: C5's 250 ms write-back
      stopPersistence(); // flushes what is pending
      expect(bridge.written(`panel.${A}`)).toEqual({ tabs: [ref(own)], activeTabId: null });
      expect(bridge.written('panel.pinned')).toEqual([ref(pin, true)]);

      // The relaunch: a fresh store hydrated from layout.json as written, then the Shell over it with A shown.
      const relaunched = createLayoutStore();
      const replay = heldBridge(Object.fromEntries(bridge.sets.map((s) => [s.key, s.value])));
      replay.release();
      await relaunched.getState().hydrate(replay.client, (id) => useSessions.getState().records.has(id));
      cleanup();
      resetPanelHost();
      register(probeTool('terminal').tool);
      const { panelPinned, panelBySession } = relaunched.getState();
      useLayout.setState({ panelPinned, panelBySession, main: mainShowing(A), hydrated: true });
      renderShell();
      expect(stripIds()).toEqual([pin, own]);
      expect(instanceIds().sort()).toEqual([own, pin].sort());
    });

    it('a pending add for a session removed before the barrier lands nothing under either activation or as a pin; a sessionless pin lands', async () => {
      const bridge = heldBridge(persisted({ 'main.tabs': mainShowing(B) }));
      const stopPersistence = persistLayout(bridge.client);
      connect();
      const terminal = probeTool('terminal');
      const info = probeTool('session-info', { multiInstance: false });
      register(terminal.tool, info.tool);
      renderShell();
      let kept = '';
      await hydrateHeld(bridge, () => {
        panelHost.addTool('terminal', { appSessionId: A, activate: false });
        panelHost.addTool('terminal', { appSessionId: A });
        panelHost.addTool('session-info', { appSessionId: A, pin: true });
        kept = panelHost.addTool('terminal', { appSessionId: null, pin: true, activate: false });
        removeA();
      });
      stopPersistence();
      expect(terminal.probe.created.map((i) => i.instanceId)).toEqual([kept]);
      expect(info.probe.created).toEqual([]);
      expect(instanceIds()).toEqual([kept]);
      expect(sessionTabs()).toEqual([`session:${B}`]); // no tab opened for A
      expect(panelOf(A)).toBeUndefined();
      expect(bridge.written(`panel.${A}`)).toBeUndefined();
      expect(bridge.written('panel.pinned')).toEqual([ref(kept, true)]);
      expect(stripIds()).toEqual([kept]);
    });

    it('a restored pinned log that B selected is pruned from the strip and from panel.pinned once A is shown, and panel.B names a surviving ref', async () => {
      const bridge = heldBridge(
        persisted({
          'panel.pinned': [ref('log:pinned00', true), ref('t:pin00000', true)],
          [`panel.${A}`]: { tabs: [ref('t:aaaaaaaa')], activeTabId: 't:aaaaaaaa' },
          [`panel.${B}`]: { tabs: [], activeTabId: 'log:pinned00' },
        }),
      );
      const stopPersistence = persistLayout(bridge.client);
      connect();
      register(probeTool('log', { pinnable: false }).tool, probeTool('t').tool);
      renderShell();
      await hydrateHeld(bridge);
      expect(shownSession()).toBe(A);
      expect(stripIds()).toEqual(['t:pin00000', 't:aaaaaaaa']);
      expect(instanceIds()).not.toContain('log:pinned00');
      stopPersistence();
      expect(bridge.written('panel.pinned')).toEqual([ref('t:pin00000', true)]);
      expect(bridge.written(`panel.${B}`)).toEqual({ tabs: [], activeTabId: 't:pin00000' });
      // The prune writes the shown list back once through onChange; A's own tab and selection are unchanged.
      expect(bridge.written(`panel.${A}`)).toEqual({ tabs: [ref('t:aaaaaaaa')], activeTabId: 't:aaaaaaaa' });
    });

    it('a pending singleton replacing a restored pinned ref carries A’s, B’s and the no-session selection to the new id, opening nothing', async () => {
      const bridge = heldBridge(
        persisted({
          'main.tabs': LAYOUT_DEFAULTS.main, // the Overview: no session shown
          'panel.pinned': [ref('session-info:restored', true), ref('t:pin00000', true)],
          [`panel.${A}`]: { tabs: [], activeTabId: 'session-info:restored' },
          [`panel.${B}`]: { tabs: [ref('t:bbbbbbbb')], activeTabId: 'session-info:restored' },
        }),
      );
      // The no-session selection is transient (no layout key): a pin selected on the Overview earlier in this launch.
      useLayout.setState({ panelActiveNoSession: 'session-info:restored' });
      const stopPersistence = persistLayout(bridge.client);
      connect();
      const info = probeTool('session-info', { multiInstance: false });
      register(info.tool, probeTool('t').tool);
      renderShell();
      let id = '';
      await hydrateHeld(bridge, () => void (id = panelHost.addTool('session-info', { appSessionId: A, params: 'p', activate: false })));
      stopPersistence();
      expect(bridge.written('panel.pinned')).toEqual([ref(id, true), ref('t:pin00000', true)]);
      expect((bridge.written(`panel.${A}`) as PanelSessionState).activeTabId).toBe(id);
      expect((bridge.written(`panel.${B}`) as PanelSessionState).activeTabId).toBe(id);
      expect(useLayout.getState().panelActiveNoSession).toBe(id);
      expect(sessionTabs()).toEqual([]);
      expect(stripIds()).toEqual([id, 't:pin00000']);
      expect(selectedId()).toBe(id);
      expect(info.probe.created).toEqual([expect.objectContaining({ instanceId: id, params: 'p' })]);
    });
  });

  it('closing a pin from the strip while B selected it leaves B on a surviving ref, and layout.json’s panel.B agrees', async () => {
    const user = userEvent.setup();
    const bridge = heldBridge({});
    bridge.release();
    const stopPersistence = persistLayout(bridge.client); // the store is hydrated: this state is the baseline
    connect();
    const p = probeTool('p');
    register(p.tool, probeTool('q').tool);
    const pins: PanelTabRef[] = [ref('p:pin00000', true), ref('q:pin00001', true)];
    useLayout.setState({
      panelPinned: pins,
      panelBySession: new Map([
        [A, { tabs: [], activeTabId: 'p:pin00000' }],
        [B, { tabs: [], activeTabId: 'p:pin00000' }],
      ]),
    });
    renderShell();
    await user.click(within(panel()).getByRole('button', { name: 'Close p' }));
    await settle();
    expect(p.probe.disposed).toEqual(['p:pin00000']);
    expect(stripIds()).toEqual(['q:pin00001']);
    expect(selectedId()).toBe('q:pin00001');
    expect(panelOf(B)!.activeTabId).toBe('q:pin00001');
    stopPersistence();
    expect(bridge.written('panel.pinned')).toEqual([ref('q:pin00001', true)]);
    expect(bridge.written(`panel.${A}`)).toEqual({ tabs: [], activeTabId: 'q:pin00001' });
    expect(bridge.written(`panel.${B}`)).toEqual({ tabs: [], activeTabId: 'q:pin00001' });
  });
});
