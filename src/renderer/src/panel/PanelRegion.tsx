// The right region (C5 execution document, M2; residue *Right-panel region*): its width (with the resizer on its left
// edge), collapse and maximize, a header strip with the region's own controls, and the `panelHost` slot below it. The
// host is handed the session the focused pane shows and that session's effective panel tabs (the global pins first,
// D-10); its changes are split back by pin into `panel.pinned` and `panel.<appSessionId>`. What a panel tab is and how
// it renders is C8's. P3-G (§D1): the fourth state, floating: the divider dragged past the panel's maximum, ⌥⌘B or the
// Float button floats it (the panel stands in the main column as maximized does and hands its host `maximized`, X5 as
// amended) and the floating card draws the shown session over the panel body.
import type { AppSessionId } from '@shared/graph/ids';
import { runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { FloatIcon, IconButton, MaximizeIcon, PanelIcon, RestoreIcon } from '../app/IconButton';
import { COLLAPSE_THRESHOLD_PX, PANEL_BOUNDS, regionWidths, useWindowWidth } from '../app/regions';
import { Resizer } from '../app/Resizer';
import { useSlot } from '../app/slots';
import { FloatingCardLayer } from '../shell/FloatingCard'; // P3-G
import { floatPanel } from '../shell/floating'; // P3-G

export const PANEL_REGION_ID = 'region-panel';
const HEADER_HEIGHT_PX = 40; // the bar's `h-10`; the floating card never covers it

export function PanelRegion() {
  const { collapsed, maximized, floating } = useLayout((s) => s.regions.panel);
  const windowWidth = useWindowWidth();
  const width = useLayout((s) => regionWidths(s.regions, windowWidth).panel);
  const max = useLayout((s) => regionWidths(s.regions, windowWidth).panelMax);
  const persisted = useLayout((s) => s.regions.panel.width);
  const setPanel = useLayout((s) => s.setPanel);

  return (
    <section
      id={PANEL_REGION_ID}
      data-region="panel"
      aria-label="Panel"
      inert={collapsed}
      className={`relative col-start-3 row-start-2 flex min-h-0 min-w-0 bg-bg-raised ${collapsed ? '' : 'border-l border-border'}`}
    >
      {!collapsed && !maximized && !floating && (
        <Resizer
          label="Resize right panel"
          controls={PANEL_REGION_ID}
          value={width}
          min={PANEL_BOUNDS.min}
          max={max}
          defaultValue={PANEL_BOUNDS.default}
          grow={-1}
          collapseThreshold={COLLAPSE_THRESHOLD_PX}
          restoreValue={persisted}
          onChange={(next) => setPanel({ width: next })}
          onCollapse={(restore) => setPanel({ collapsed: true, width: restore })}
          expandThreshold={COLLAPSE_THRESHOLD_PX}
          onExpand={(restore) => floatPanel({ width: restore })}
          className="absolute inset-y-0 -left-0.75"
        />
      )}
      {/* The contents clip here, not on the region, so the resizer can straddle the region's edge. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border px-2">
          <IconButton
            label={floating ? 'Dock session' : 'Float session over panel'}
            action="panel.float"
            pressed={floating}
            onClick={() => runAction('panel.float')}
          >
            <FloatIcon />
          </IconButton>
          <IconButton
            label={maximized ? 'Restore right panel' : 'Maximize right panel'}
            action="panel.maximize"
            pressed={maximized}
            onClick={() => runAction('panel.maximize')}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </IconButton>
          <IconButton label="Hide right panel" action="panel.toggle" onClick={() => runAction('panel.toggle')}>
            <PanelIcon />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Host maximized={maximized || floating} />
        </div>
      </div>
      {floating && !collapsed && <FloatingCardLayer top={HEADER_HEIGHT_PX} />}
    </section>
  );
}

function Host({ maximized }: { maximized: boolean }) {
  const Panel = useSlot('panelHost');
  const tab = useLayout((s) => activeTab(s.main));
  const appSessionId: AppSessionId | null = sessionOfTab(tab);
  const pinned = useLayout((s) => s.panelPinned);
  const own = useLayout((s) => (appSessionId ? s.panelBySession.get(appSessionId) : undefined));
  const activeNoSession = useLayout((s) => s.panelActiveNoSession);
  const tabs = own ? [...pinned, ...own.tabs] : pinned;
  // A session's selection lives in its own key; with no session in view, the transient pin selection.
  const activeTabId = appSessionId ? (own?.activeTabId ?? null) : activeNoSession;

  return (
    // The slot's component is registered once at composition and read from a store, not created during render.
    // eslint-disable-next-line react-hooks/static-components
    <Panel
      appSessionId={appSessionId}
      tabs={tabs}
      activeTabId={activeTabId}
      maximized={maximized}
      onChange={(next) => useLayout.getState().setPanelTabs(appSessionId, next)}
      onTogglePinned={(tabId) => {
        const tab = tabs.find((t) => t.id === tabId);
        // A pin moves a tab between the session's own key and the global one, so it needs a session to move to or from.
        if (tab && appSessionId) useLayout.getState().setPanelTabPinned(appSessionId, tabId, !tab.pinned);
      }}
      onToggleMaximize={() => runAction('panel.maximize')}
    />
  );
}
