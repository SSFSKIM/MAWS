// The `#panel` harness page (C8a execution document, M1; Interfaces *Harness bootstrap*): the product's panel host in
// C5's real `PanelRegion`, inside C5's grid, over the two fake sessions of the harness scenario, with C9's real
// Terminal tool and stub tools standing in for the other siblings' tools. The page composes itself as `App.tsx` does,
// in this order: the slot, the shell actions (the region's maximize and hide), `persistLayout`, `connectPanelHost`
// (persistence first: the barrier writes inside the hydration notification), then hydration over the profile's real
// layout.json, all inside TanStack Query's provider. It never calls `connectShell`: nothing answers `session.list`
// here, so it seeds the stores itself. Run it under `MAWS_SESSION_SOURCE=stub:test/fixtures/panel/harness-sessions.json`
// (ruling O1), so main knows A and B. C9's page probes live in the C9 blocks (the stand-in fold, ruling O2).
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { gridColumns, useWindowWidth } from '../../app/regions';
import { registerShellActions } from '../../app/shell-actions';
import { registerSlot } from '../../app/slots';
import { ipc } from '../../ipc/client';
import { queryClient } from '../../ipc/query';
import { runAction } from '../../keymap/actions-runtime';
import { connectPanelHost, instanceIds, instanceOf, isRestoredLog, panelHost, pendingAdds, registerPanelTool, togglePinned, usePanelHost } from '../../panel/host';
import { PanelHost } from '../../panel/PanelHost';
import { PanelRegion } from '../../panel/PanelRegion';
import { persistLayout, useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { useSettings } from '../../stores/settings';
import { useHarnessTheme } from '../terminal/useHarnessTheme';
import type { FakeSessionId, PanelHarnessApi } from './api';
import { FAKE_IDS, FAKE_RECORDS, fakeId, seedFakeSessions } from './fakeSessions';
import { stubProbe, stubTool } from './stubTool';
// C9 start
import { openTerminal, TERMINAL_TOOL_ID, terminalTool } from '../../tools/terminal';
import { adoptTerminals, connectTerminalProbes, createPanelTerminalsApi, inputGuard, keysApi, TerminalControls, TerminalDebugRows, terminalOf } from './terminalProbes';
// C9 end

// Registered once per page load, never on an effect's cleanup: a registration's disposer closes its tool's tabs.
const disposers = new Map<string, () => void>();

function registerHarnessTools(): void {
  const tools = [
    terminalTool, // C9's, registered here as App.tsx registers it (the stand-in fold, ruling O2)
    stubTool('harness-stub', { title: 'Stub' }), // the harness-only probe tool
    stubTool('session-info', { title: 'Session info', multiInstance: false }),
    stubTool('log', { title: 'Log', menu: false, pinnable: false }), // the transient case
  ];
  for (const tool of tools) {
    if (disposers.has(tool.id) || panelHost.tools().some((t) => t.id === tool.id)) continue; // a real tool of that id wins
    disposers.set(tool.id, registerPanelTool(tool as Parameters<typeof registerPanelTool>[0]));
  }
}

let hydration: Promise<string[]> | null = null;

function bootstrap(): () => void {
  registerSlot('panelHost', PanelHost);
  registerHarnessTools();
  const offs = [
    registerShellActions(),
    persistLayout(ipc),
    connectPanelHost(),
    connectTerminalProbes(), // C9: after the shell's actions, so the page's `tab.next` wins
  ];
  // Once per load (StrictMode replays effects; a second hydrate would replace the panel lists again).
  hydration ??= (async () => {
    seedFakeSessions();
    // C9: the host's ptys are re-adopted before the layout hydrates, so a restored Terminal tab finds its shell.
    const adopted = await adoptTerminals((appSessionId) => FAKE_RECORDS.has(appSessionId as AppSessionId));
    await useLayout.getState().hydrate(ipc, (id) => useSessions.getState().records.has(id));
    // A first launch shows A; a relaunch shows what the profile's main.tabs held.
    const layout = useLayout.getState();
    if (!layout.main.panes.some((p) => p.tabs.some((t) => t.kind === 'session'))) layout.openSession(fakeId('A'));
    return adopted;
  })();
  return () => offs.reverse().forEach((off) => off());
}

const shownSession = (): AppSessionId | null => sessionOfTab(activeTab(useLayout.getState().main));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function tabTitle(tabId: string, toolId: string): string {
  const { tools, titles } = usePanelHost.getState();
  const title = (tools.get(toolId) ?? instanceOf(tabId)?.tool)?.title ?? toolId;
  const suffix = titles[tabId];
  return suffix ? `${title} · ${suffix}` : title;
}

const api: PanelHarnessApi = {
  switchSession(id) {
    if (id === null) useLayout.getState().activateTab('overview');
    else useLayout.getState().openSession(fakeId(id));
  },
  addTool(toolId, opts = {}) {
    const appSessionId = opts.appSessionId === undefined ? shownSession() : opts.appSessionId === null ? null : fakeId(opts.appSessionId);
    return panelHost.addTool(toolId, { appSessionId, params: opts.params, pin: opts.pin, activate: opts.activate });
  },
  selectTab: (tabId) => (tabId === null || tabId === 'review' ? panelHost.showSummary() : panelHost.selectTab(tabId)),
  closeTab: (tabId) => panelHost.closeTab(tabId),
  pin: (tabId) => togglePinned(tabId),
  showSummary: () => panelHost.showSummary(),
  tabs() {
    const layout = useLayout.getState();
    const shown = shownSession();
    const active = shown ? (layout.panelBySession.get(shown)?.activeTabId ?? null) : layout.panelActiveNoSession;
    return layout
      .effectivePanelTabs(shown)
      .filter((t) => !isRestoredLog(t.id))
      .map((t) => ({
        id: t.id,
        toolId: t.toolId,
        pinned: t.pinned,
        active: t.id === active,
        title: tabTitle(t.id, t.toolId),
        selected: t.id === active,
        home: shown, // a pin is in every session's list, a session's own tab in the shown one's
        terminalId: terminalOf(t.id),
      }));
  },
  stub: (toolId) =>
    stubProbe(toolId, () => {
      disposers.get(toolId)?.();
      disposers.delete(toolId);
    }),
  maximize: (on) => useLayout.getState().setPanel(on ? { maximized: true, collapsed: false } : { maximized: false }),
  collapse: (on) => useLayout.getState().setPanel(on ? { collapsed: true, maximized: false } : { collapsed: false }),
  setTheme: (theme) => void useSettings.getState().setTheme(theme),
  hydrated: () =>
    new Promise<void>((resolve) => {
      if (useLayout.getState().hydrated) return resolve();
      const off = useLayout.subscribe((s) => {
        if (!s.hydrated) return;
        off();
        resolve();
      });
    }),
  // C9 start
  async ready() {
    const adopted = await (hydration ?? Promise.resolve([]));
    await nextFrame(); // the restored tabs' instances are created before paint
    return adopted;
  },
  session: shownSession,
  sessions: { A: fakeId('A'), B: fakeId('B') },
  inputGuard,
  // C9 end
};

// C9 start
const terminalsApi = createPanelTerminalsApi({
  ready: () => api.ready(),
  addTerminal: (command) => api.addTool(TERMINAL_TOOL_ID, command ? { params: { command } } : {}),
  selectTab: api.selectTab,
  closeTab: api.closeTab,
});
// C9 end

export function PanelHarness() {
  const windowWidth = useWindowWidth();
  const columns = useLayout((s) => gridColumns(s.regions, windowWidth));

  useEffect(() => bootstrap(), []);
  useEffect(() => {
    window.__maws_harness = {
      panel: api,
      // C9 start
      page: 'panel',
      terminals: terminalsApi,
      keys: keysApi,
      openTerminal,
      // C9 end
    };
    window.openTerminal = openTerminal; // C9: the console entry for C10's attach path
    return () => {
      delete window.__maws_harness;
      delete window.openTerminal;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="grid h-full grid-rows-[var(--toolbar-h)_minmax(0,1fr)] bg-bg text-fg" style={{ gridTemplateColumns: columns }}>
        <Controls />
        <DebugStrip />
        <main className="col-start-2 row-start-2 flex min-w-0 items-center justify-center border-r border-border text-ui text-fg-muted">
          <MainTitle />
        </main>
        <PanelRegion />
      </div>
    </QueryClientProvider>
  );
}

const buttonClass = 'rounded-sm border border-border px-2 py-0.5 text-ui hover:bg-bg-hover aria-pressed:bg-bg-active aria-pressed:text-fg';

function Controls() {
  const shown = useLayout((s) => sessionOfTab(activeTab(s.main)));
  const collapsed = useLayout((s) => s.regions.panel.collapsed);
  const { resolvedTheme, setTheme } = useHarnessTheme();
  return (
    <header className="col-span-3 row-start-1 flex min-w-0 items-center gap-2 overflow-x-auto border-b border-border bg-bg-raised px-3 text-fg-muted">
      <span className="text-ui font-medium text-fg">#panel</span>
      <div role="group" aria-label="session" className="flex gap-1">
        {FAKE_IDS.map((id) => (
          <button key={id} type="button" aria-pressed={shown === fakeId(id)} className={buttonClass} onClick={() => api.switchSession(id as FakeSessionId)}>
            Session {id}
          </button>
        ))}
        <button type="button" aria-pressed={shown === null} className={buttonClass} onClick={() => api.switchSession(null)}>
          Overview
        </button>
      </div>
      <TerminalControls /> {/* C9 */}
      <span className="flex-1" />
      <button type="button" className={buttonClass} onClick={() => runAction('panel.toggle')}>
        {collapsed ? 'Show panel' : 'Hide panel'}
      </button>
      <button type="button" className={buttonClass} onClick={() => void setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
        theme: {resolvedTheme ?? '…'}
      </button>
    </header>
  );
}

function MainTitle() {
  const tab = useLayout((s) => activeTab(s.main));
  const title = useSessions((s) => {
    const id = sessionOfTab(tab);
    return id ? (s.records.get(id)?.title.text ?? id) : 'Overview';
  });
  return <p>{title}</p>;
}

// What the host holds: the instance map's ids and the persisted lists as C5's store holds them.
function DebugStrip() {
  const instances = usePanelHost((s) => (s.version >= 0 ? instanceIds().join(', ') : ''));
  const pinned = useLayout((s) => s.panelPinned.map((t) => t.id).join(', '));
  // One string per snapshot: a selector must not return a fresh array on every read.
  const lists = useLayout((s) =>
    FAKE_IDS.map((id) => {
      const own = s.panelBySession.get(fakeId(id));
      return `panel.${id}: [${own?.tabs.map((t) => t.id).join(', ') ?? ''}] active ${own?.activeTabId ?? 'none'}`;
    }).join('\n'),
  );
  const noSession = useLayout((s) => s.panelActiveNoSession);
  const hydrated = useLayout((s) => s.hydrated);
  return (
    <aside aria-label="Debug" className="col-start-1 row-start-2 min-w-0 overflow-auto border-r border-border bg-bg-raised p-3 font-mono text-ui-sm text-fg-muted">
      <p>{hydrated ? 'hydrated' : `hydrating · ${pendingAdds().length} pending`}</p>
      <p data-testid="debug-instances">instances: [{instances}]</p>
      <p data-testid="debug-pinned">panel.pinned: [{pinned}]</p>
      {lists.split('\n').map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p>no-session selection: {noSession ?? 'none'}</p>
      <TerminalDebugRows /> {/* C9 */}
    </aside>
  );
}
