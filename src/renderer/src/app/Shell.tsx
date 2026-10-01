// The shell's frame (C5 execution document, M2): the toolbar across the top and the three regions on a CSS grid whose
// columns are the layout store's widths (`regions.ts`). A collapsed region keeps its column at 0 and stays mounted but
// inert; a maximized panel takes the main column's place while the main region keeps its state offscreen. The sidebar
// is M3's, the main region's panes M4's (C1's diagnostics strip is now the content of the Diagnostics tab). W5: the main
// region opens with the top bar, and the floating Overview moves over the panes beneath it.
import { MainArea } from '../main/MainArea';
import { TopBar } from '../main/TopBar';
import { OverviewLayer } from '../overview/OverviewPanel';
import { CommandPalette } from '../palette/CommandPalette';
import { PanelRegion } from '../panel/PanelRegion';
import { Sidebar } from '../sidebar/Sidebar';
import { useLayout } from '../stores/layout';
import { COLLAPSE_THRESHOLD_PX, gridColumns, regionWidths, SIDEBAR_BOUNDS, useWindowWidth } from './regions';
import { Resizer } from './Resizer';
import { ToastHost } from './ToastHost';
import { Toolbar } from './Toolbar';

export const SIDEBAR_REGION_ID = 'region-sidebar';
export const MAIN_REGION_ID = 'region-main';

export function Shell() {
  const windowWidth = useWindowWidth();
  const columns = useLayout((s) => gridColumns(s.regions, windowWidth));
  const mainHidden = useLayout((s) => s.regions.panel.maximized && !s.regions.panel.collapsed);

  return (
    <div className="grid h-full grid-rows-[var(--toolbar-h)_minmax(0,1fr)] bg-bg text-fg" style={{ gridTemplateColumns: columns }}>
      <Toolbar />
      <SidebarRegion />
      <section
        id={MAIN_REGION_ID}
        data-region="main"
        aria-label="Main"
        inert={mainHidden}
        className="relative col-start-2 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        <TopBar />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <MainArea />
          <OverviewLayer />
        </div>
        <ToastHost />
      </section>
      <PanelRegion />
      <CommandPalette />
    </div>
  );
}

function SidebarRegion() {
  const collapsed = useLayout((s) => s.regions.sidebar.collapsed);
  const windowWidth = useWindowWidth();
  const width = useLayout((s) => regionWidths(s.regions, windowWidth).sidebar);
  const max = useLayout((s) => regionWidths(s.regions, windowWidth).sidebarMax);
  const persisted = useLayout((s) => s.regions.sidebar.width);
  const setSidebar = useLayout((s) => s.setSidebar);
  return (
    <section
      id={SIDEBAR_REGION_ID}
      data-region="sidebar"
      aria-label="Sidebar"
      inert={collapsed}
      className={`relative col-start-1 row-start-2 flex min-h-0 min-w-0 bg-bg-raised ${collapsed ? '' : 'border-r border-border'}`}
    >
      {/* The contents clip here, not on the region, so the resizer can straddle the region's edge. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Sidebar />
      </div>
      {!collapsed && (
        <Resizer
          label="Resize sidebar"
          controls={SIDEBAR_REGION_ID}
          value={width}
          min={SIDEBAR_BOUNDS.min}
          max={max}
          defaultValue={SIDEBAR_BOUNDS.default}
          collapseThreshold={COLLAPSE_THRESHOLD_PX}
          restoreValue={persisted}
          onChange={(next) => setSidebar({ width: next })}
          onCollapse={(restore) => setSidebar({ collapsed: true, width: restore })}
          className="absolute inset-y-0 -right-0.75"
        />
      )}
    </section>
  );
}
