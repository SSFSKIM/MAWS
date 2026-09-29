// The slot component C8a registers into C5's `panelHost` slot (C8a execution document, M1): the strip above the
// selected tool's body, or the resting summary when no tab is selected. What the strip is about to show is decided
// here: restored Log refs are dropped before it renders them (and pruned from the store once), and a tab appearing for
// the first time gets its instance (`createState` with the shown session and no params).
import { useLayoutEffect } from 'react';
import { ensureShownInstances, isRestoredLog, pruneRestoredLogs, setMountedHost, usePanelHost } from './host';
import type { PanelHostProps } from './host-slot';
import { Summary } from './summary/Summary';
import { TabStrip } from './TabStrip';
import { ToolBody } from './ToolBody';

export const PANEL_BODY_ID = 'panel-host-body';

export function PanelHost({ appSessionId, tabs, activeTabId, onChange, onTogglePinned }: PanelHostProps) {
  const tools = usePanelHost((s) => s.tools);
  const shown = tabs.filter((t) => !isRestoredLog(t.id));
  const active = shown.find((t) => t.id === activeTabId) ?? null;

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
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip appSessionId={appSessionId} tabs={shown} activeTabId={active?.id ?? null} onChange={onChange} bodyId={PANEL_BODY_ID} />
      <div id={PANEL_BODY_ID} role="tabpanel" aria-label={active ? undefined : 'Session overview'} className="min-h-0 flex-1 overflow-auto">
        {active ? <ToolBody key={active.id} tab={active} appSessionId={appSessionId} /> : <Summary appSessionId={appSessionId} />}
      </div>
    </div>
  );
}
