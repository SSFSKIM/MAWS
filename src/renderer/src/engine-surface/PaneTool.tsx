// The `plugin-pane` panel tool (R2; X5): one tab per pane a plugin opened (`$.ui.open`), its body the plugin's Pane
// drawing through SurfaceSite, or Claude Desktop's placeholder until the plugin draws (c95e4d2cf-BLkI1oZK.js:10025-10047).
// Tabs come and go with the engine's roster (panes.ts), never from the "+" tool list; the panel's "+" lists the open
// panes under "Plugin panes". Showing a tab tells the engine which pane the surface shows (`session.ui.paneShow`); the
// keyboard moving into its body or out of it says so (`session.ui.paneFocus`); the person's close asks the engine
// (`session.ui.close`), which a plugin may refuse, and a pane the engine closed closes its tab without asking.
import { useEffect, useRef, type FocusEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { Icon } from '../app/IconButton';
import type { PanelTool, PanelToolContext } from '../panel/tool';
import { panesClient, usePaneRoster } from './pane-roster';
import { useCells } from './cells';
import { SurfaceSite } from './SurfaceSite';

export const PLUGIN_PANE_TOOL = 'plugin-pane';

export const PANE_COPY = {
  title: 'Plugin pane',
  menu: 'Plugin panes',
  empty: 'Nothing to show yet',
  notDrawn: (plugin: string) => `${plugin} has not drawn in this pane`,
  closed: 'This pane has closed',
} as const;

export interface PluginPaneParams {
  paneId: string;
}

export interface PluginPaneState {
  appSessionId: AppSessionId | null;
  paneId: string | null; // null: a tab restored from layout, which names no pane
}

// Tabs whose pane left the roster (or never was one): they close without asking the engine.
const gone = new WeakSet<PluginPaneState>();
export const markGone = (state: PluginPaneState): void => void gone.add(state);
// The last focus request each tab's body acted on (one counter per tab, kept across the body's unmounts).
const focusSeen = new WeakMap<PluginPaneState, number>();

const COLUMNS = 60;
const ROWS = 20;

function Placeholder({ plugin }: { plugin: string }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <p className="m-0 text-ui text-fg-muted">{PANE_COPY.empty}</p>
      <p className="m-0 text-ui-sm text-fg-faint">{PANE_COPY.notDrawn(plugin)}</p>
    </div>
  );
}

function PaneBody({ state, ctx }: { state: PluginPaneState; ctx: PanelToolContext }) {
  const roster = usePaneRoster(state.appSessionId);
  const pane = roster?.panes.find((p) => p.id === state.paneId) ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const { columns, rows } = useCells(ref, { columns: COLUMNS, rows: ROWS });
  const client = panesClient();
  const { appSessionId, paneId } = state;

  // a restored tab names no pane: it goes as soon as it is seen
  useEffect(() => {
    if (paneId !== null) return;
    markGone(state);
    ctx.close();
  }, [paneId, state, ctx]);

  // on screen: the engine's shown pane is this one
  const shownId = roster?.shownId ?? null;
  const present = pane !== null;
  useEffect(() => {
    if (appSessionId === null || paneId === null || !present || shownId === paneId) return;
    void client.invoke('session.ui.paneShow', { appSessionId, id: paneId });
    // asked once per showing of the tab; a later move of the engine's shown pane is the roster's to follow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSessionId, paneId, present]);

  // selected (or asked to by a focus request): the body takes the keyboard
  useEffect(() => {
    if (ctx.focusRequest <= (focusSeen.get(state) ?? 0)) return;
    focusSeen.set(state, ctx.focusRequest);
    ref.current?.focus({ preventScroll: true });
  }, [ctx.focusRequest, state]);

  const focusedId = roster?.focusedId ?? null;
  const onFocus = () => {
    if (appSessionId === null || paneId === null || focusedId === paneId) return;
    void client.invoke('session.ui.paneFocus', { appSessionId, id: paneId });
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (appSessionId === null || ref.current?.contains(event.relatedTarget as Node | null) || focusedId !== paneId) return;
    void client.invoke('session.ui.paneFocus', { appSessionId, id: null });
  };

  if (pane === null) return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{PANE_COPY.closed}</p>;
  return (
    <div ref={ref} tabIndex={-1} data-plugin-pane={pane.id} className="flex h-full min-h-0 flex-col outline-none" onFocus={onFocus} onBlur={onBlur}>
      <SurfaceSite
        appSessionId={appSessionId}
        component="Pane"
        instanceId={pane.id}
        props={{ title: pane.title, isFocused: focusedId === pane.id, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} }}
        engine={<Placeholder plugin={pane.plugin} />}
        frame={(tree) => <div className="flex min-h-0 flex-1 flex-col p-3 text-ui text-fg [&>*]:flex-1">{tree}</div>}
        client={client}
      />
    </div>
  );
}

function PaneIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6h11M5 4.5h.01" />
    </Icon>
  );
}

export const pluginPaneTool: PanelTool<PluginPaneState, PluginPaneParams | undefined> = {
  id: PLUGIN_PANE_TOOL,
  title: PANE_COPY.title,
  icon: PaneIcon,
  pinnable: false,
  multiInstance: true,
  menu: false, // offered under "Plugin panes" in the "+" menu, one per open pane, never as a tool to add
  createState: ({ appSessionId, params }) => {
    const state: PluginPaneState = { appSessionId, paneId: params?.paneId ?? null };
    if (params === undefined) markGone(state);
    return state;
  },
  // the person's close: the engine runs the plugins' `ui.close` hooks, which may keep the pane; a session no longer
  // attached has no pane to keep, so its tab just goes
  async beforeClose(state) {
    if (gone.has(state) || state.appSessionId === null || state.paneId === null) return true;
    const result = await panesClient().invoke('session.ui.close', { appSessionId: state.appSessionId, id: state.paneId });
    return !result.ok || result.value.closed;
  },
  dispose: () => {},
  render: PaneBody,
};
