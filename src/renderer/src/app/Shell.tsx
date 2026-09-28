// The shell's frame (C5 execution document, M2): the toolbar across the top and the three regions on a CSS grid whose
// columns are the layout store's widths (`regions.ts`). A collapsed region keeps its column at 0 and stays mounted but
// inert; a maximized panel takes the main column's place while the main region keeps its state offscreen. The sidebar
// and main contents arrive with M3 and M4; until then the main region holds C1's diagnostics strip.
import { PanelRegion } from '../panel/PanelRegion';
import { useLayout } from '../stores/layout';
import { Diagnostics } from './Diagnostics';
import { COLLAPSE_THRESHOLD_PX, gridColumns, SIDEBAR_BOUNDS, sidebarWidth } from './regions';
import { Resizer } from './Resizer';
import { Toolbar } from './Toolbar';

export const SIDEBAR_REGION_ID = 'region-sidebar';
export const MAIN_REGION_ID = 'region-main';

export function Shell() {
  const columns = useLayout((s) => gridColumns(s.regions));
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
        className="col-start-2 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        <Diagnostics />
      </section>
      <PanelRegion />
    </div>
  );
}

function SidebarRegion() {
  const collapsed = useLayout((s) => s.regions.sidebar.collapsed);
  const width = useLayout((s) => sidebarWidth(s.regions));
  const setSidebar = useLayout((s) => s.setSidebar);
  return (
    <section
      id={SIDEBAR_REGION_ID}
      data-region="sidebar"
      aria-label="Sidebar"
      inert={collapsed}
      className={`relative col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg-raised ${collapsed ? '' : 'border-r border-border'}`}
    >
      {!collapsed && (
        <Resizer
          label="Resize sidebar"
          controls={SIDEBAR_REGION_ID}
          value={width}
          min={SIDEBAR_BOUNDS.min}
          max={SIDEBAR_BOUNDS.max}
          defaultValue={SIDEBAR_BOUNDS.default}
          collapseThreshold={COLLAPSE_THRESHOLD_PX}
          onChange={(next) => setSidebar({ width: next })}
          onCollapse={() => setSidebar({ collapsed: true })}
          className="absolute inset-y-0 -right-0.75"
        />
      )}
    </section>
  );
}
