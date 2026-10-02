import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type PanelTabRef } from '@shared/ipc/schema/layout';
import { createLayoutStore, persistLayout, useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import {
  A,
  B,
  C,
  heldBridge,
  hydrateHeld,
  mainShowing,
  onChangeCalls,
  panelOf,
  persisted,
  pinIds,
  probeTool,
  type ProbeState,
  ref,
  resetPanelStores,
  spyLayout,
  TestHost,
} from '../test-support/panel';
import type { PanelTool } from './tool';
import { connectPanelHost, panelHost, pendingAdds, registerPanelTool, restoredLogIds, togglePinned, usePanelHost } from './host';

const cleanups: (() => void)[] = [];
const connect = () => cleanups.push(connectPanelHost());
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const show = (id: AppSessionId | null) => act(() => useLayout.setState({ main: id ? mainShowing(id) : LAYOUT_DEFAULTS.main }));
const register = (...tools: PanelTool<ProbeState, unknown>[]) => tools.map((t) => registerPanelTool(t));
beforeEach(() => resetPanelStores());
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((off) => off());
});

describe('panel host registry and instances', () => {
  it('keeps registration order; a later registration replaces the declaration and keeps the instances', () => {
    const one = probeTool('one');
    const two = probeTool('two');
    register(one.tool, two.tool);
    expect(panelHost.tools().map((t) => t.id)).toEqual(['one', 'two']);
    render(<TestHost />);
    let id = '';
    act(() => void (id = panelHost.addTool('one', { appSessionId: A })));
    expect(screen.getByTestId(`body:${id}`)).toBeTruthy();
    const next = probeTool('one', { title: 'One again', render: ({ state }) => <div data-testid={`again:${state.id}`} /> });
    act(() => void registerPanelTool(next.tool));
    expect(panelHost.tools().map((t) => t.id)).toEqual(['one', 'two']);
    expect(screen.getByTestId(`again:${id}`)).toBeTruthy();
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('One again');
    expect(one.probe.created).toHaveLength(1);
    expect(next.probe.created).toHaveLength(0);
  });

  it('a registration’s disposer unregisters only while that registration is current', () => {
    const [off] = register(probeTool('x').tool);
    register(probeTool('x').tool);
    off();
    expect(panelHost.tools().map((t) => t.id)).toEqual(['x']);
  });

  it('mints <toolId>: and eight base36 characters, and throws for an unregistered id, a sessionless unpinned tab and an unpinnable pin', () => {
    register(probeTool('t').tool, probeTool('u', { pinnable: false }).tool);
    expect(panelHost.addTool('t', { appSessionId: A, activate: false })).toMatch(/^t:[0-9a-z]{8}$/);
    expect(() => panelHost.addTool('nope', { appSessionId: A })).toThrow('panel: no tool registered as nope');
    expect(() => panelHost.addTool('t', { appSessionId: null })).toThrow('panel: a tab with no session must be pinned');
    expect(() => panelHost.addTool('u', { appSessionId: A, pin: true })).toThrow('panel: u is not pinnable');
  });

  it('creates state once per tab across re-renders, visibility, session switches under a pin and a pin toggle, and renders the same object', () => {
    connect();
    const { tool, probe } = probeTool('t');
    register(tool);
    const { rerender } = render(<TestHost />);
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: A })));
    for (let i = 0; i < 40; i += 1) rerender(<TestHost />);
    for (let i = 0; i < 3; i += 1) {
      act(() => useLayout.getState().setPanel({ collapsed: true }));
      act(() => useLayout.getState().setPanel({ collapsed: false }));
    }
    act(() => togglePinned(id));
    show(B);
    act(() => panelHost.selectTab(id));
    show(A);
    act(() => togglePinned(id));
    expect(probe.created).toHaveLength(1);
    // Every re-render reaches the tool uncompiled; the React Compiler (the app's build, project renderer-compiled) skips
    // the unchanged ones, so there only some do.
    expect(probe.rendered.length).toBeGreaterThan(process.env.MAWS_REACT_COMPILER === '1' ? 1 : 40);
    expect(probe.rendered.every((state) => state === probe.rendered[0])).toBe(true);
  });

  it('mounts only the selected tool', () => {
    register(probeTool('t').tool);
    render(<TestHost />);
    let first = '';
    let second = '';
    act(() => void (first = panelHost.addTool('t', { appSessionId: A })));
    act(() => void (second = panelHost.addTool('t', { appSessionId: A })));
    expect(screen.queryByTestId(`body:${first}`)).toBeNull();
    expect(screen.getByTestId(`body:${second}`)).toBeTruthy();
  });

  it('renders a tab whose tool is not registered as a placeholder naming it, and closes it', async () => {
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('terminal:aaaaaaaa')], activeTabId: 'terminal:aaaaaaaa' }]]) });
    render(<TestHost />);
    expect(screen.getByRole('tabpanel').textContent).toBe('terminal is not available');
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('terminal');
    await act(async () => void expect(await panelHost.closeTab('terminal:aaaaaaaa')).toBe(true));
    expect(panelOf(A)).toEqual({ tabs: [], activeTabId: null });
  });

  it('unregistering closes every tab of the tool through closeTab: a veto keeps the tab and its instance on the old declaration, an instance-less ref goes', async () => {
    connect();
    const { tool, probe } = probeTool('t');
    const [off] = register(tool);
    useLayout.setState({
      panelPinned: [ref('t:pinned01', true)],
      panelBySession: new Map([
        [A, { tabs: [ref('t:aaaaaaaa')], activeTabId: 't:aaaaaaaa' }],
        [B, { tabs: [ref('t:bbbbbbbb')], activeTabId: null }],
      ]),
    });
    render(<TestHost />);
    expect(probe.created.map((i) => i.instanceId)).toEqual(['t:pinned01', 't:aaaaaaaa']);
    probe.veto = (id) => id === 't:aaaaaaaa';
    act(() => off());
    await settle();
    expect(panelHost.tools()).toEqual([]);
    expect(probe.beforeClose.sort()).toEqual(['t:aaaaaaaa', 't:pinned01']);
    expect(probe.disposed).toEqual(['t:pinned01']);
    expect(pinIds()).toEqual([]);
    expect(panelOf(B)!.tabs).toEqual([]);
    expect(panelOf(A)!.tabs.map((r) => r.id)).toEqual(['t:aaaaaaaa']);
    expect(screen.getByTestId('body:t:aaaaaaaa')).toBeTruthy(); // the old declaration still renders it
    probe.veto = () => false;
    await act(async () => void expect(await panelHost.closeTab('t:aaaaaaaa')).toBe(true));
    expect(probe.disposed).toEqual(['t:pinned01', 't:aaaaaaaa']);
    expect(panelOf(A)!.tabs).toEqual([]);
  });

  it('disposes an instance whose ref left every list once the store changes, without beforeClose (a removed session)', () => {
    connect();
    const { tool, probe } = probeTool('t');
    register(tool);
    let own = '';
    let pin = '';
    act(() => void (own = panelHost.addTool('t', { appSessionId: A, activate: false })));
    act(() => void (pin = panelHost.addTool('t', { appSessionId: A, pin: true, activate: false })));
    act(() => useLayout.getState().dropSession(A));
    expect(probe.disposed).toEqual([own]);
    expect(probe.beforeClose).toEqual([]);
    expect(pinIds()).toEqual([pin]);
  });

  it('a pinned tab’s context follows the shown session and reads no session on the Overview', () => {
    register(probeTool('t').tool);
    render(<TestHost />);
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: A, pin: true })));
    expect(screen.getByTestId(`body:${id}`).textContent).toBe(`t · ${A} · pinned · visible · focus 1`);
    show(B);
    act(() => panelHost.selectTab(id));
    expect(screen.getByTestId(`body:${id}`).textContent).toContain(`t · ${B} · pinned`);
    show(null);
    act(() => panelHost.selectTab(id));
    expect(screen.getByTestId(`body:${id}`).textContent).toContain('t · no session · pinned');
  });

  it('focusRequest counts selections and the collapsed → open transition, not open → collapsed', () => {
    connect();
    register(probeTool('t').tool);
    render(<TestHost />);
    let first = '';
    act(() => void (first = panelHost.addTool('t', { appSessionId: A })));
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    act(() => panelHost.selectTab(first));
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/visible · focus 2$/);
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/hidden · focus 2$/);
    act(() => useLayout.getState().setPanel({ collapsed: false }));
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/visible · focus 3$/);
  });

  it('passive selection keeps a collapsed panel and keyboard focus; user selection reveals it', () => {
    connect();
    register(probeTool('t').tool);
    render(<TestHost />);
    let first = '';
    act(() => void (first = panelHost.addTool('t', { appSessionId: A })));
    act(() => void panelHost.addTool('t', { appSessionId: A }));
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    const keyboard = document.body.appendChild(document.createElement('textarea'));
    keyboard.focus();
    act(() => panelHost.selectTab(first, { focus: false }));
    expect(useLayout.getState().regions.panel.collapsed).toBe(true);
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/hidden · focus 1$/);
    expect(document.activeElement).toBe(keyboard);
    act(() => panelHost.selectTab(first));
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
    expect(screen.getByTestId(`body:${first}`).textContent).toMatch(/visible · focus [23]$/);
    keyboard.remove();
  });

  // W4: the receipt's Review changes added an invisible tab while the panel was hidden (⌘⇧B).
  it('a tool added with activate opens a hidden panel, focused on the new tab; one added without it leaves the panel hidden', () => {
    connect();
    register(probeTool('t', { multiInstance: true }).tool);
    render(<TestHost />);
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    let quiet = '';
    act(() => void (quiet = panelHost.addTool('t', { appSessionId: A, activate: false })));
    expect(useLayout.getState().regions.panel.collapsed).toBe(true);
    let shown = '';
    act(() => void (shown = panelHost.addTool('t', { appSessionId: A })));
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
    expect(screen.getByTestId(`body:${shown}`).textContent).toMatch(/visible · focus \d+$/);
    expect(screen.queryByTestId(`body:${quiet}`)).toBeNull();
  });

  it('connected after hydration (an HMR reload of the module), captures the restored Log set, once', () => {
    register(probeTool('log', { pinnable: false }).tool, probeTool('t').tool);
    useLayout.setState({ panelBySession: new Map([[A, { tabs: [ref('log:aaaaaaaa'), ref('t:aaaaaaaa')], activeTabId: null }]]) });
    connect();
    expect([...restoredLogIds()]).toEqual(['log:aaaaaaaa']);
    cleanups.pop()!();
    act(() => void panelHost.addTool('log', { appSessionId: A, activate: false })); // opened in this launch
    connect();
    expect([...restoredLogIds()]).toEqual(['log:aaaaaaaa']);
  });
});

describe('panel host transitions', () => {
  it('closeTab awaits beforeClose: a veto keeps the tab, true disposes it and removes the ref, and a second caller gets the same promise', async () => {
    const { tool, probe } = probeTool('t');
    register(tool);
    render(<TestHost />);
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: A })));
    probe.veto = () => true;
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = panelHost.closeTab(id);
      second = panelHost.closeTab(id);
    });
    expect(second).toBe(first);
    await act(async () => void expect(await first).toBe(false));
    expect(probe.beforeClose).toEqual([id]);
    expect(panelOf(A)!.tabs.map((r) => r.id)).toEqual([id]);
    expect(probe.disposed).toEqual([]);
    probe.veto = () => false;
    await act(async () => void expect(await panelHost.closeTab(id)).toBe(true));
    expect(panelOf(A)!.tabs).toEqual([]);
    expect(probe.disposed).toEqual([id]);
  });

  it('a beforeClose that throws keeps the tab', async () => {
    const { tool, probe } = probeTool('t');
    register(tool);
    const id = panelHost.addTool('t', { appSessionId: A });
    probe.throwOnClose = true;
    const errors = console.error;
    console.error = () => {};
    try {
      expect(await panelHost.closeTab(id)).toBe(false);
    } finally {
      console.error = errors;
    }
    expect(panelOf(A)!.tabs.map((r) => r.id)).toEqual([id]);
  });

  it('closing the active tab selects the next to its right, then the last, then the summary', async () => {
    register(probeTool('t').tool);
    render(<TestHost />);
    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 3; i += 1) ids.push(panelHost.addTool('t', { appSessionId: A }));
    });
    const [x, y, z] = ids;
    act(() => panelHost.selectTab(y));
    await act(() => panelHost.closeTab(y));
    expect(panelOf(A)!.activeTabId).toBe(z);
    await act(() => panelHost.closeTab(z));
    expect(panelOf(A)!.activeTabId).toBe(x);
    await act(() => panelHost.closeTab(x));
    expect(panelOf(A)!.activeTabId).toBeNull();
    expect(screen.getByRole('tabpanel').textContent).toContain('Tools stay with this session.');
  });

  it('a single-instance addTool re-targets the tab in the target’s list or the pins, never one in another session’s list', () => {
    const { tool, probe } = probeTool('s', { multiInstance: false });
    register(tool);
    const a = panelHost.addTool('s', { appSessionId: A, params: 1, activate: false });
    expect(panelHost.addTool('s', { appSessionId: A, params: 2, activate: false })).toBe(a);
    expect(probe.opens).toEqual([{ id: a, params: 2 }]);
    const b = panelHost.addTool('s', { appSessionId: B, params: 3, activate: false });
    expect(b).not.toBe(a);
    const pin = panelHost.addTool('s', { appSessionId: C, pin: true, activate: false });
    expect(panelHost.addTool('s', { appSessionId: C, params: 4, activate: false })).toBe(pin);
    expect(probe.opens).toEqual([
      { id: a, params: 2 },
      { id: pin, params: 4 },
    ]);
    expect(probe.created.map((i) => [i.instanceId, i.params])).toEqual([
      [a, 1],
      [b, 3],
      [pin, undefined],
    ]);
  });

  it('re-targeting a restored single-instance tab never shown creates its state first, then opens it, under both activation modes', () => {
    const { tool, probe } = probeTool('s', { multiInstance: false });
    register(tool);
    useLayout.setState({
      panelBySession: new Map([
        [B, { tabs: [ref('s:bbbbbbbb')], activeTabId: null }],
        [C, { tabs: [ref('s:cccccccc')], activeTabId: null }],
      ]),
    });
    render(<TestHost />);
    const spies = spyLayout();
    const main = useLayout.getState().main;
    act(() => void expect(panelHost.addTool('s', { appSessionId: B, params: 'p1', activate: false })).toBe('s:bbbbbbbb'));
    expect(probe.created).toEqual([expect.objectContaining({ appSessionId: B, instanceId: 's:bbbbbbbb', params: undefined })]);
    expect(probe.opens).toEqual([{ id: 's:bbbbbbbb', params: 'p1' }]);
    expect(spies.openSession).not.toHaveBeenCalled();
    expect(useLayout.getState().main).toBe(main);
    expect(panelOf(B)!.activeTabId).toBeNull();

    act(() => void expect(panelHost.addTool('s', { appSessionId: C, params: 'p2' })).toBe('s:cccccccc'));
    expect(probe.created.at(-1)).toEqual(expect.objectContaining({ appSessionId: C, instanceId: 's:cccccccc', params: undefined }));
    expect(probe.opens.at(-1)).toEqual({ id: 's:cccccccc', params: 'p2' });
    expect(spies.openSession.mock.calls).toEqual([[C]]);
    expect(panelOf(C)!.activeTabId).toBe('s:cccccccc');
    expect(screen.getByTestId('body:s:cccccccc')).toBeTruthy();
    show(B);
    expect(probe.created).toHaveLength(2); // showing the sessions creates no second instance
  });

  it('activate: false writes a target not shown through updatePanelTabs with the pins passed through, and switches nothing', () => {
    register(probeTool('t').tool);
    useLayout.setState({ panelPinned: [ref('t:pin00000', true)] });
    render(<TestHost />);
    const spies = spyLayout();
    const main = useLayout.getState().main;
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: B, activate: false })));
    expect(spies.updatePanelTabs).toHaveBeenCalledTimes(1);
    const [target, fn, opts] = spies.updatePanelTabs.mock.calls[0];
    expect(target).toBe(B);
    expect(fn([ref('t:pin00000', true)])).toEqual([ref('t:pin00000', true), { id, toolId: 't', pinned: false }]);
    expect(opts).toBeUndefined();
    expect(useLayout.getState().main).toBe(main);
    expect(spies.openSession).not.toHaveBeenCalled();
    expect(pinIds()).toEqual(['t:pin00000']);
    expect(panelOf(B)).toEqual({ tabs: [{ id, toolId: 't', pinned: false }], activeTabId: null });
    expect(panelOf(A)).toBeUndefined();
  });

  it('activate for a target not shown opens the session once, then selects the new tab in its list', () => {
    register(probeTool('t').tool);
    render(<TestHost />);
    const spies = spyLayout();
    let id = '';
    act(() => void (id = panelHost.addTool('t', { appSessionId: B })));
    expect(spies.openSession.mock.calls).toEqual([[B]]);
    const write = spies.updatePanelTabs.mock.calls.findIndex(([target]) => target === B);
    expect(spies.openSession.mock.invocationCallOrder[0]).toBeLessThan(spies.updatePanelTabs.mock.invocationCallOrder[write]);
    expect(panelOf(B)!.activeTabId).toBe(id);
    expect(screen.getByTestId(`body:${id}`).textContent).toContain(`t · ${B} · unpinned · visible · focus 1`);
  });

  describe('the hydration barrier', () => {
    beforeEach(() => resetPanelStores({ hydrated: false }));

    it('holds an addTool made before hydration and lands it after the restored refs, a restored singleton replaced in place', async () => {
      connect();
      const terminal = probeTool('terminal');
      const info = probeTool('session-info', { multiInstance: false });
      register(terminal.tool, info.tool);
      const bridge = heldBridge(
        persisted({
          'panel.pinned': [ref('terminal:restpin0', true)],
          [`panel.${A}`]: { tabs: [ref('session-info:restored'), ref('other:aaaaaaaa')], activeTabId: 'other:aaaaaaaa' },
        }),
      );
      let t = '';
      let s = '';
      await hydrateHeld(bridge, () => {
        t = panelHost.addTool('terminal', { appSessionId: A, pin: true, params: { cwd: '/x' }, activate: false });
        s = panelHost.addTool('session-info', { appSessionId: A, params: 'p', activate: false });
        expect(t).toMatch(/^terminal:[0-9a-z]{8}$/);
        expect(s).toMatch(/^session-info:[0-9a-z]{8}$/);
        expect(pendingAdds().map((p) => p.id)).toEqual([t, s]);
        expect(terminal.probe.created).toEqual([]);
        expect(pinIds()).toEqual([]);
        expect(panelOf(A)).toBeUndefined();
      });
      expect(pinIds()).toEqual(['terminal:restpin0', t]);
      expect(panelOf(A)).toEqual({ tabs: [ref(s), ref('other:aaaaaaaa')], activeTabId: 'other:aaaaaaaa' });
      expect(terminal.probe.created).toEqual([expect.objectContaining({ appSessionId: A, instanceId: t, params: { cwd: '/x' } })]);
      expect(info.probe.created).toEqual([expect.objectContaining({ appSessionId: A, instanceId: s, params: 'p' })]);
      expect(info.probe.opens).toEqual([]);
      expect(pendingAdds()).toEqual([]);
    });

    it('with persistence subscribed before the host, a pending pinned add is written at the barrier and restores into a fresh store', async () => {
      const bridge = heldBridge({ regions: LAYOUT_DEFAULTS.regions, 'main.tabs': LAYOUT_DEFAULTS.main }); // a first launch: no panel.pinned yet
      const stopPersistence = persistLayout(bridge.client);
      connect();
      register(probeTool('terminal').tool);
      let id = '';
      await hydrateHeld(bridge, () => void (id = panelHost.addTool('terminal', { appSessionId: null, pin: true })));
      stopPersistence(); // flushes what is pending
      const pinned = bridge.sets.filter((s) => s.key === 'panel.pinned');
      expect(pinned.at(-1)!.value).toEqual([{ id, toolId: 'terminal', pinned: true }]);
      const fresh = createLayoutStore();
      const replay = heldBridge(Object.fromEntries(bridge.sets.map((s) => [s.key, s.value])));
      replay.release();
      await fresh.getState().hydrate(replay.client, () => true);
      expect(fresh.getState().panelPinned).toEqual([{ id, toolId: 'terminal', pinned: true }]);
    });

    it.each([
      ['an empty panel.A', [] as PanelTabRef[]],
      ['a restored session-info in panel.A', [ref('session-info:restored')]],
    ])('two pre-hydration calls for a singleton share one id: createState takes the first params, open the second (%s)', async (_, tabs) => {
      connect();
      const { tool, probe } = probeTool('session-info', { multiInstance: false });
      register(tool);
      const bridge = heldBridge(persisted({ [`panel.${A}`]: { tabs, activeTabId: null } }));
      let one = '';
      await hydrateHeld(bridge, () => {
        one = panelHost.addTool('session-info', { appSessionId: A, params: 'p1', activate: false });
        expect(panelHost.addTool('session-info', { appSessionId: A, params: 'p2', activate: false })).toBe(one);
      });
      expect(probe.created).toEqual([expect.objectContaining({ instanceId: one, params: 'p1' })]);
      expect(probe.opens).toEqual([{ id: one, params: 'p2' }]);
      expect(panelOf(A)!.tabs).toEqual([ref(one)]);
    });

    it('a pending singleton pin shares its id with a later call from another session, whose params and activation apply at the barrier', async () => {
      connect();
      const { tool, probe } = probeTool('session-info', { multiInstance: false });
      register(tool);
      const bridge = heldBridge(persisted({}));
      const spies = spyLayout();
      let id = '';
      await hydrateHeld(bridge, () => {
        id = panelHost.addTool('session-info', { appSessionId: A, pin: true, activate: false });
        expect(panelHost.addTool('session-info', { appSessionId: B, params: 'p' })).toBe(id);
      });
      expect(pinIds()).toEqual([id]);
      expect(probe.created).toEqual([expect.objectContaining({ instanceId: id, params: undefined })]);
      expect(probe.opens).toEqual([{ id, params: 'p' }]);
      expect(spies.openSession.mock.calls).toEqual([[B]]);
      expect(panelOf(B)!.activeTabId).toBe(id);
    });

    it('drops a pending add whose target session was removed before the barrier, under either activation and as a pin; a sessionless pin lands', async () => {
      connect();
      const terminal = probeTool('terminal');
      const info = probeTool('session-info', { multiInstance: false });
      register(terminal.tool, info.tool);
      const bridge = heldBridge(persisted({}));
      const spies = spyLayout();
      let kept = '';
      await hydrateHeld(bridge, () => {
        panelHost.addTool('terminal', { appSessionId: A, activate: false });
        panelHost.addTool('terminal', { appSessionId: A });
        panelHost.addTool('session-info', { appSessionId: A, pin: true });
        kept = panelHost.addTool('terminal', { appSessionId: null, pin: true, activate: false });
        // as connectShell does on session.removed
        if (useSessions.getState().applyRemoved({ appSessionId: A, revision: 99 })) useLayout.getState().dropSession(A);
      });
      expect(terminal.probe.created.map((i) => i.instanceId)).toEqual([kept]);
      expect(info.probe.created).toEqual([]);
      expect(spies.openSession).not.toHaveBeenCalled();
      expect(pinIds()).toEqual([kept]);
      expect(panelOf(A)).toBeUndefined();
      expect(pendingAdds()).toEqual([]);
    });

    it('prunes restored log refs once, through one onChange, when their list is first shown, and keeps a log opened after the barrier', async () => {
      connect();
      const log = probeTool('log', { pinnable: false });
      const t = probeTool('t');
      register(log.tool, t.tool);
      const bridge = heldBridge(
        persisted({
          [`panel.${A}`]: { tabs: [ref('log:aaaaaaaa'), ref('t:aaaaaaaa'), ref('log:bbbbbbbb')], activeTabId: 'log:aaaaaaaa' },
          [`panel.${B}`]: { tabs: [ref('log:cccccccc')], activeTabId: null },
          [`panel.${C}`]: { tabs: [ref('t:cccccccc')], activeTabId: null },
        }),
      );
      await hydrateHeld(bridge);
      expect([...restoredLogIds()].sort()).toEqual(['log:aaaaaaaa', 'log:bbbbbbbb', 'log:cccccccc']);
      render(<TestHost />);
      expect(onChangeCalls).toEqual([{ appSessionId: A, next: { tabs: [ref('t:aaaaaaaa')], activeTabId: 't:aaaaaaaa' } }]);
      expect(screen.queryByRole('tab', { name: /log/ })).toBeNull();
      expect(panelOf(B)!.tabs).toEqual([ref('log:cccccccc')]); // not shown yet
      expect(log.probe.created).toEqual([]);
      show(C);
      expect(onChangeCalls).toHaveLength(1); // C held no restored log
      show(B);
      expect(onChangeCalls.at(-1)).toEqual({ appSessionId: B, next: { tabs: [], activeTabId: null } });
      expect(restoredLogIds().size).toBe(0);

      show(A);
      let fresh = '';
      act(() => void (fresh = panelHost.addTool('log', { appSessionId: A })));
      act(() => panelHost.showSummary());
      act(() => panelHost.selectTab(fresh));
      show(B);
      show(A);
      act(() => useLayout.getState().setPanel({ collapsed: true }));
      act(() => useLayout.getState().setPanel({ collapsed: false }));
      expect(panelOf(A)!.tabs.map((r) => r.id)).toEqual(['t:aaaaaaaa', fresh]);
      expect(log.probe.created.map((i) => i.instanceId)).toEqual([fresh]);
      expect(log.probe.disposed).toEqual([]);
      expect(screen.getByTestId(`body:${fresh}`)).toBeTruthy();
    });

    it('a restored pinned log that B selected, pruned when A is first shown, repairs B, and A’s onChange carries A’s own replacement', async () => {
      connect();
      register(probeTool('log', { pinnable: false }).tool, probeTool('t').tool);
      const bridge = heldBridge(
        persisted({
          'panel.pinned': [ref('log:pinned00', true), ref('t:pin00000', true)],
          [`panel.${A}`]: { tabs: [ref('t:aaaaaaaa')], activeTabId: 'log:pinned00' },
          [`panel.${B}`]: { tabs: [ref('t:bbbbbbbb')], activeTabId: 'log:pinned00' },
        }),
      );
      await hydrateHeld(bridge);
      const spies = spyLayout();
      render(<TestHost />);
      expect(onChangeCalls).toEqual([{ appSessionId: A, next: { tabs: [ref('t:pin00000', true), ref('t:aaaaaaaa')], activeTabId: 't:pin00000' } }]);
      expect(spies.updatePanelTabs.mock.calls).toHaveLength(1);
      const [target, fn, opts] = spies.updatePanelTabs.mock.calls[0];
      const refs = [ref('t:x')];
      expect([target, fn(refs), opts]).toEqual([B, refs, { activeTabId: 't:pin00000' }]);
      expect(fn(refs)).toBe(refs);
      expect(panelOf(B)!.activeTabId).toBe('t:pin00000');
      expect(pinIds()).toEqual(['t:pin00000']);
    });

    it('a pending singleton replacing a restored pinned ref moves A’s, B’s and the no-session selection to the new id, activating nothing', async () => {
      connect();
      const { tool, probe } = probeTool('session-info', { multiInstance: false });
      register(tool, probeTool('t').tool);
      const bridge = heldBridge(
        persisted({
          'panel.pinned': [ref('session-info:restored', true), ref('t:pin00000', true)],
          [`panel.${A}`]: { tabs: [], activeTabId: 'session-info:restored' },
          [`panel.${B}`]: { tabs: [ref('t:bbbbbbbb')], activeTabId: 'session-info:restored' },
          [`panel.${C}`]: { tabs: [], activeTabId: 't:pin00000' },
        }),
      );
      useLayout.setState({ panelActiveNoSession: 'session-info:restored' }); // as a pin selected on the Overview before the relaunch
      const spies = spyLayout();
      let id = '';
      await hydrateHeld(bridge, () => void (id = panelHost.addTool('session-info', { appSessionId: A, params: 'p', activate: false })));
      expect(pinIds()).toEqual([id, 't:pin00000']);
      expect(panelOf(A)!.activeTabId).toBe(id);
      expect(panelOf(B)!.activeTabId).toBe(id);
      expect(panelOf(C)!.activeTabId).toBe('t:pin00000');
      expect(useLayout.getState().panelActiveNoSession).toBe(id);
      expect(probe.created).toEqual([expect.objectContaining({ instanceId: id, params: 'p' })]);
      expect(spies.openSession).not.toHaveBeenCalled();
      expect(usePanelHost.getState().focus[id]).toBeUndefined();
    });

    it('replacing a restored ref in A’s own list migrates A’s selection alone', async () => {
      connect();
      register(probeTool('session-info', { multiInstance: false }).tool, probeTool('t').tool);
      const bridge = heldBridge(
        persisted({
          'panel.pinned': [ref('t:pin00000', true)],
          [`panel.${A}`]: { tabs: [ref('t:aaaaaaaa'), ref('session-info:restored')], activeTabId: 'session-info:restored' },
          [`panel.${B}`]: { tabs: [], activeTabId: 't:pin00000' },
        }),
      );
      const spies = spyLayout();
      let id = '';
      await hydrateHeld(bridge, () => void (id = panelHost.addTool('session-info', { appSessionId: A, activate: false })));
      expect(panelOf(A)).toEqual({ tabs: [ref('t:aaaaaaaa'), ref(id)], activeTabId: id });
      expect(panelOf(B)!.activeTabId).toBe('t:pin00000');
      expect(spies.updatePanelTabs.mock.calls.filter(([target]) => target === B)).toEqual([]);
    });

    it('a reservation that lands on another reservation’s tab at the barrier resolves to that tab for selectTab and closeTab', async () => {
      connect();
      const { tool, probe } = probeTool('session-info', { multiInstance: false });
      register(tool);
      const bridge = heldBridge(persisted({ 'panel.pinned': [ref('session-info:restored', true)] }));
      let first = '';
      let second = '';
      await hydrateHeld(bridge, () => {
        // Two scopes (A's own list; the pins, from B), so two reservations; both reach the one restored pin.
        first = panelHost.addTool('session-info', { appSessionId: A, params: 'p1', activate: false });
        second = panelHost.addTool('session-info', { appSessionId: B, pin: true, params: 'p2', activate: false });
        expect(second).not.toBe(first);
      });
      expect(pinIds()).toEqual([first]);
      expect(probe.created).toEqual([expect.objectContaining({ instanceId: first, params: 'p1' })]);
      expect(probe.opens).toEqual([{ id: first, params: 'p2' }]);
      act(() => panelHost.selectTab(second));
      expect(panelOf(A)!.activeTabId).toBe(first);
      await act(async () => void expect(await panelHost.closeTab(second)).toBe(true));
      expect(pinIds()).toEqual([]);
      expect(probe.disposed).toEqual([first]);
    });
  });

  describe('selection repair when a pin leaves', () => {
    const setup = () => {
      connect();
      const pin = probeTool('p');
      const [off] = register(pin.tool, probeTool('q').tool);
      useLayout.setState({
        panelPinned: [ref('p:pin00000', true), ref('q:pin00001', true)],
        panelBySession: new Map([
          [A, { tabs: [ref('q:aaaaaaaa')], activeTabId: 'p:pin00000' }],
          [B, { tabs: [ref('q:bbbbbbbb')], activeTabId: 'p:pin00000' }],
          [C, { tabs: [], activeTabId: 'q:pin00001' }],
        ]),
      });
      render(<TestHost />);
      return { off, spies: spyLayout() };
    };

    it.each(['close', 'unregister', 'unpin'] as const)('%s of a pin selected in A (shown) and B (not shown) moves B through one identity updatePanelTabs', async (how) => {
      const { off, spies } = setup();
      if (how === 'close') await act(() => panelHost.closeTab('p:pin00000'));
      if (how === 'unregister') {
        act(() => off());
        await settle();
      }
      if (how === 'unpin') act(() => togglePinned('p:pin00000'));
      const toB = spies.updatePanelTabs.mock.calls.filter(([target]) => target === B);
      expect(toB).toHaveLength(1);
      const refs = [ref('q:x')];
      expect(toB[0][1](refs)).toBe(refs);
      expect(toB[0][2]).toEqual({ activeTabId: 'q:pin00001' });
      expect(panelOf(B)!.activeTabId).toBe('q:pin00001');
      expect(spies.updatePanelTabs.mock.calls.filter(([target]) => target === C)).toEqual([]);
      expect(panelOf(C)!.activeTabId).toBe('q:pin00001');
      expect([...useLayout.getState().panelBySession.keys()]).toEqual([A, B, C]);
      expect(panelOf(A)!.activeTabId).toBe(how === 'unpin' ? 'p:pin00000' : 'q:pin00001');
    });

    it.each([
      ['the next to the right', [ref('q:pin00001', true), ref('p:pin00000', true), ref('q:pin00002', true)], 'q:pin00002'],
      ['else the last', [ref('q:pin00001', true), ref('p:pin00000', true)], 'q:pin00001'],
      ['else the summary', [ref('p:pin00000', true)], null],
    ])('B’s selection falls to %s', async (_, pins, expected) => {
      connect();
      register(probeTool('p').tool, probeTool('q').tool);
      useLayout.setState({
        panelPinned: pins,
        panelBySession: new Map([
          [A, { tabs: [], activeTabId: null }],
          [B, { tabs: [], activeTabId: 'p:pin00000' }],
        ]),
      });
      render(<TestHost />);
      await act(() => panelHost.closeTab('p:pin00000'));
      expect(panelOf(B)!.activeTabId).toBe(expected);
    });

    it.each(['close', 'unregister'] as const)(
      '%s of a pin selected in B while the shown session holds no list creates no list and moves B through one identity updatePanelTabs',
      async (how) => {
        connect();
        const [off] = register(probeTool('p').tool, probeTool('q').tool);
        useLayout.setState({
          panelPinned: [ref('p:pin00000', true), ref('q:pin00001', true)],
          panelBySession: new Map([[B, { tabs: [], activeTabId: 'p:pin00000' }]]),
        });
        render(<TestHost />); // A is shown and has no list of its own
        const spies = spyLayout();
        if (how === 'close') await act(() => panelHost.closeTab('p:pin00000'));
        else {
          act(() => off());
          await settle();
        }
        expect([...useLayout.getState().panelBySession.keys()]).toEqual([B]);
        const toB = spies.updatePanelTabs.mock.calls.filter(([target]) => target === B);
        expect(toB).toHaveLength(1);
        const refs = [ref('q:x')];
        expect(toB[0][1](refs)).toBe(refs);
        expect(toB[0][2]).toEqual({ activeTabId: 'q:pin00001' });
        expect(panelOf(B)!.activeTabId).toBe('q:pin00001');
        expect(pinIds()).toEqual(['q:pin00001']);
      },
    );
  });
});
