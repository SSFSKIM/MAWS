// Panel host tests (C8a): a probe tool whose every call is recorded, the host mounted as C5's region mounts it (the
// shown session from the focused pane's active tab, `onChange` and `onTogglePinned` bound to the layout store) with
// the two writers spied, and a reset of every store the host reads. Imported only by happy-dom suites.
import { useMemo } from 'react';
import { vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type LayoutMain, type PanelSessionState, type PanelTabRef, type TabRef } from '@shared/ipc/schema/layout';
import { record } from '../../../../test/support/builders';
import { resetPanelHost } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import type { PanelHostProps } from '../panel/host-slot';
import type { PanelTool, PanelToolInit } from '../panel/tool';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';

export const A = 'app-a' as AppSessionId;
export const B = 'app-b' as AppSessionId;
export const C = 'app-c' as AppSessionId;

export interface ProbeState {
  id: string;
  init: PanelToolInit<unknown>;
}

export interface Probe {
  created: PanelToolInit<unknown>[];
  opens: { id: string; params: unknown }[];
  disposed: string[];
  beforeClose: string[];
  rendered: ProbeState[];
  veto: (id: string) => boolean; // beforeClose answers false for these
  throwOnClose: boolean;
}

// A tool that records createState, open, beforeClose, dispose and every render; its body prints the context.
export function probeTool(id: string, over: Partial<PanelTool<ProbeState, unknown>> = {}): { tool: PanelTool<ProbeState, unknown>; probe: Probe } {
  const probe: Probe = { created: [], opens: [], disposed: [], beforeClose: [], rendered: [], veto: () => false, throwOnClose: false };
  const tool: PanelTool<ProbeState, unknown> = {
    id,
    title: id,
    icon: () => null,
    pinnable: true,
    multiInstance: true,
    createState(init) {
      probe.created.push(init);
      return { id: init.instanceId, init };
    },
    open(state, params) {
      probe.opens.push({ id: state.id, params });
    },
    async beforeClose(state) {
      probe.beforeClose.push(state.id);
      if (probe.throwOnClose) throw new Error('refused');
      return !probe.veto(state.id);
    },
    dispose(state) {
      probe.disposed.push(state.id);
    },
    render: function ProbeBody({ state, ctx }) {
      probe.rendered.push(state);
      return (
        <div data-testid={`body:${state.id}`}>
          {`${id} · ${ctx.appSessionId ?? 'no session'} · ${ctx.pinned ? 'pinned' : 'unpinned'} · ${ctx.visible ? 'visible' : 'hidden'} · focus ${ctx.focusRequest}`}
        </div>
      );
    },
    ...over,
  };
  return { tool, probe };
}

export const ref = (id: string, pinned = false): PanelTabRef => ({ id, toolId: id.split(':')[0], pinned });
export const sessionTab = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
export const mainShowing = (...ids: AppSessionId[]): LayoutMain => {
  const tabs = [LAYOUT_DEFAULTS.main.panes[0].tabs[0], ...ids.map(sessionTab)];
  return { ...LAYOUT_DEFAULTS.main, panes: [{ tabs, activeTabId: tabs.at(-1)!.id }] };
};

// The host as C5's region hands it its props, with `onChange` recorded per call.
export const onChangeCalls: { appSessionId: AppSessionId | null; next: PanelSessionState }[] = [];
export function TestHost() {
  const main = useLayout((s) => s.main);
  const appSessionId = useMemo(() => sessionOfTab(activeTab(main)), [main]);
  const pinned = useLayout((s) => s.panelPinned);
  const own = useLayout((s) => (appSessionId ? s.panelBySession.get(appSessionId) : undefined));
  const activeNoSession = useLayout((s) => s.panelActiveNoSession);
  const props: PanelHostProps = {
    appSessionId,
    tabs: own ? [...pinned, ...own.tabs] : pinned,
    activeTabId: appSessionId ? (own?.activeTabId ?? null) : activeNoSession,
    maximized: false,
    onChange(next) {
      onChangeCalls.push({ appSessionId, next });
      useLayout.getState().setPanelTabs(appSessionId, next);
    },
    onTogglePinned(tabId) {
      const tab = props.tabs.find((t) => t.id === tabId);
      if (tab && appSessionId) useLayout.getState().setPanelTabPinned(appSessionId, tabId, !tab.pinned);
    },
    onToggleMaximize() {},
  };
  return <PanelHost {...props} />;
}

const ORIGINAL = (() => {
  const { updatePanelTabs, openSession, setPanelTabs } = useLayout.getState();
  return { updatePanelTabs, openSession, setPanelTabs };
})();

// Spies on the layout store's writers the host uses, still doing what they do.
export function spyLayout() {
  const updatePanelTabs = vi.fn(ORIGINAL.updatePanelTabs);
  const openSession = vi.fn(ORIGINAL.openSession);
  const setPanelTabs = vi.fn(ORIGINAL.setPanelTabs);
  useLayout.setState({ updatePanelTabs, openSession, setPanelTabs });
  return { updatePanelTabs, openSession, setPanelTabs };
}

export function resetPanelStores(opts: { hydrated?: boolean } = {}): void {
  resetPanelHost();
  onChangeCalls.splice(0);
  useLayout.setState({
    ...ORIGINAL,
    regions: LAYOUT_DEFAULTS.regions,
    main: mainShowing(A),
    panelPinned: [],
    panelBySession: new Map(),
    panelActiveNoSession: null,
    hydrated: opts.hydrated ?? true,
  });
  useSessions.setState({
    records: new Map([A, B, C].map((id) => [id, record(id)])),
    engine: new Map(),
  });
}

export const panelOf = (id: AppSessionId) => useLayout.getState().panelBySession.get(id);
export const pinIds = () => useLayout.getState().panelPinned.map((r) => r.id);
