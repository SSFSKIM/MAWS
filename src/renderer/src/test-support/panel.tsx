// Panel host tests (C8a): a probe tool whose every call is recorded, the host mounted as C5's region mounts it (the
// shown session from the focused pane's active tab, `onChange` and `onTogglePinned` bound to the layout store) with
// the two writers spied, and a reset of every store the host reads. Imported only by happy-dom suites.
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import { useMemo } from 'react';
import { vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { queryClient } from '../ipc/query';
import { useGit } from '../stores/git';
import { useSummary } from '../stores/summary';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type LayoutMain, type PanelSessionState, type PanelTabRef, type TabRef } from '@shared/ipc/schema/layout';
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
  const tabs = ids.map(sessionTab);
  return { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId: tabs.at(-1)?.id ?? '' }] } } };
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
  // The summary's Background work reads through TanStack Query, as under App.tsx's provider.
  return (
    <QueryClientProvider client={queryClient}>
      <PanelHost {...props} />
    </QueryClientProvider>
  );
}

// Main as the summary's reads find it in suites that are not about the summary (M2): no repository, nothing persisted,
// no workflow runs. The summary suite installs its own.
const QUIET_ANSWERS: Record<string, CommandResult<CommandName>> = {
  'git.watch': { ok: false, error: { code: 'internal', message: 'not a git repository' } },
  'git.unwatch': { ok: true, value: undefined },
  'layout.get': { ok: true, value: { value: null } },
  'layout.set': { ok: true, value: undefined },
  'fs.workflows': { ok: true, value: { runs: [] } },
};
const quietBridge = {
  invoke: async (name: CommandName) => QUIET_ANSWERS[name] ?? { ok: false, error: { code: 'internal', message: `no answer for ${name} in the panel suites` } },
  on: () => () => {},
} as unknown as MawsBridge;

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
    digests: new Map(),
  });
  // The summary's stores (M2): main answered by the quiet bridge, no git facts held, every section expanded.
  window.maws = quietBridge;
  queryClient.clear();
  useGit.setState({ entries: new Map() });
  useSummary.setState({ collapsed: new Set() });
}

export const panelOf = (id: AppSessionId) => useLayout.getState().panelBySession.get(id);
export const pinIds = () => useLayout.getState().panelPinned.map((r) => r.id);

// ---- a held hydration (M1's barrier pins, M3's Shell suite) --------------------------------------------------------------

// A main process whose `layout.get` answers only once released, recording every `layout.set` (layout.json's writes).
export function heldBridge(values: Record<string, unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sets: { key: string; value: unknown }[] = [];
  const client = {
    async invoke(name: string, input: { key: string; value?: unknown }) {
      if (name === 'layout.list') return { ok: true, value: { keys: Object.keys(values) } };
      if (name === 'engine.sessions') return { ok: true, value: [] }; // the shell's connect reads the engine table
      if (name === 'layout.get') {
        await gate;
        return { ok: true, value: { value: values[input.key] ?? null } };
      }
      if (name === 'layout.set') {
        sets.push({ key: input.key, value: input.value });
        return { ok: true, value: undefined };
      }
      throw new Error(`unexpected ${name}`);
    },
    on: () => () => {},
  } as unknown as MawsBridge;
  // The value a key holds after the recorded writes; undefined when it was never written.
  const written = (key: string): unknown => sets.findLast((s) => s.key === key)?.value;
  return { client, release, sets, written };
}

// layout.json as a relaunch finds it: the renderer's fixed keys, A on screen, then the keys given.
export const persisted = (keys: Record<string, unknown>) => ({ regions: LAYOUT_DEFAULTS.regions, 'main.tabs': mainShowing(A), 'panel.pinned': [], ...keys });

// Hydrates the layout store over a held bridge as `connectShell` does (the sessions store's records are the sessions
// that exist), running `before` while `layout.get` is held.
export async function hydrateHeld(bridge: ReturnType<typeof heldBridge>, before: () => void = () => {}) {
  const hydrating = useLayout.getState().hydrate(bridge.client, (id) => useSessions.getState().records.has(id));
  before();
  bridge.release();
  await act(() => hydrating);
}
