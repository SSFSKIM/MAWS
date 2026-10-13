// The selected tab's body (C8a execution document, M1): the instance's `render` with a context built for this render
// from the host's props and stores, or the placeholder of a tool that is not registered. Only the selected tab is
// mounted; a tool keeps whatever view state it would miss (a scroll offset) in its state and restores it on mount.
// P3-G: the body renders inside its tab's X32 scope, so an editor registers with `useEditorHost(useEditorHostScope(), …)`.
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { unavailable } from './copy';
import { EditorHostScopeContext, type EditorHostScope } from './editor-host';
import { instanceOf, panelHost, setTitle, usePanelHost } from './host';
import type { PanelToolContext } from './tool';

export function ToolBody({ tab, appSessionId }: { tab: PanelTabRef; appSessionId: AppSessionId | null }) {
  // The instance map is module state; `version` makes these reads reactive. The declaration and the state are selected
  // as values, not the mutable instance: a re-registration swaps `instance.tool` in place, and the React Compiler
  // memoises on what a render reads, so a body read through the instance would keep the old declaration.
  const tool = usePanelHost((s) => (s.version >= 0 ? instanceOf(tab.id)?.tool : undefined));
  const state = usePanelHost((s) => (s.version >= 0 ? instanceOf(tab.id)?.state : undefined));
  const registered = usePanelHost((s) => s.tools.has(tab.toolId));
  const focusRequest = usePanelHost((s) => s.focus[tab.id] ?? 0);
  const collapsed = useLayout((s) => s.regions.panel.collapsed);
  const session = useSessions((s) => (appSessionId ? (s.records.get(appSessionId) ?? null) : null));
  const status = useSessions((s) => (appSessionId ? (s.engine.get(appSessionId) ?? null) : null));

  if (!tool) {
    // A registered tool's instance is created before paint (PanelHost's layout effect); a placeholder has none.
    return registered ? null : <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{unavailable(tab.toolId)}</p>;
  }
  const scope: EditorHostScope = { surface: 'panel', tabId: tab.id }; // P3-G (X32): what an editor body registers under
  const ctx: PanelToolContext = {
    appSessionId,
    session,
    status,
    pinned: tab.pinned,
    visible: !collapsed,
    focusRequest,
    setTitle: (suffix) => setTitle(tab.id, suffix),
    close: () => void panelHost.closeTab(tab.id),
    openTool: panelHost.addTool,
    editorHost: scope,
  };
  const Render = tool.render;
  return (
    <EditorHostScopeContext.Provider value={scope}>
      <Render state={state} ctx={ctx} />
    </EditorHostScopeContext.Provider>
  );
}
