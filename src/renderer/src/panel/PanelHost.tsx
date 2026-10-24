// The slot component C8a registers into C5's `panelHost` slot (C8a execution document, M1): the strip above the
// selected tool's body, or the resting summary when no tab is selected. What the strip is about to show is decided
// here: restored Log refs are dropped before it renders them (and pruned from the store once), and a tab appearing for
// the first time gets its instance (`createState` with the shown session and, P4-B3, the params its tool persisted).
import { useLayoutEffect } from 'react';
import { useLayout } from '../stores/layout';
import { surfaceTabs } from './surface-model';
import { PanelHeader } from './PanelHeader';
import { closeSurface } from './SurfaceRow';
import { ensureShownInstances, isRestoredLog, pruneRestoredLogs, setMountedHost, usePanelHost } from './host';
import type { PanelHostProps } from './host-slot';
// Summary cards live over main; the panel never reserves a summary column.
import { TabStrip } from './TabStrip';
import { ToolBody } from './ToolBody';

export const PANEL_BODY_ID = 'panel-host-body';

export function PanelHost({ appSessionId, tabs, activeTabId, onChange, onTogglePinned }: PanelHostProps) {
  const tools = usePanelHost((s) => s.tools);
  const shown = tabs.filter((t) => !isRestoredLog(t.id));
  const state = useLayout();
  const visible = surfaceTabs(state, appSessionId).filter((tab) => shown.some((t) => t.id === tab.id));

  useLayoutEffect(() => {
    setMountedHost({ appSessionId, onChange, onTogglePinned });
    return () => setMountedHost(null);
  }, [appSessionId, onChange, onTogglePinned]);

  // Before paint: prune what must not show, then give every shown tab of a registered tool its instance (a tool that
  // registers later than the tab appeared gets it here too, since `tools` changes).
  useLayoutEffect(() => {
    const visible = tabs.filter((t) => !isRestoredLog(t.id)); // before the prune forgets which ids were restored Logs
    pruneRestoredLogs({ appSessionId, tabs, activeTabId, onChange });
    ensureShownInstances(visible, appSessionId);
  }, [appSessionId, tabs, activeTabId, onChange, tools]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5" data-surface-stack>
      {visible.map((active, index) => (
        <section key={active.toolId} aria-label={tools.get(active.toolId)?.title ?? active.toolId} data-surface={active.toolId} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-raised">
          <PanelHeader tabs={shown} activeTabId={active.id} hide={() => closeSurface(active.toolId)} secondary={index > 0} navigation={tools.get(active.toolId)?.multiInstance && <TabStrip inline toolId={active.toolId} appSessionId={appSessionId} tabs={shown.filter((tab) => tab.toolId === active.toolId)} activeTabId={active.id} onChange={(next) => onChange({ tabs: shown, activeTabId: next.activeTabId })} bodyId={`${PANEL_BODY_ID}-${active.toolId}`} />} />
          <div id={`${PANEL_BODY_ID}-${active.toolId}`} role="tabpanel" aria-label={tools.get(active.toolId)?.title ?? active.toolId} className="min-h-0 flex-1 overflow-auto wrap-anywhere">
            <ToolBody key={active.id} tab={active} appSessionId={appSessionId} />
          </div>
          {index > 0 && <span className="sr-only">Second surface</span>}
        </section>
      ))}
    </div>
  );
}
