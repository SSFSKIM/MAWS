import type { LayoutRegions, PanelTabRef, PanelWidths } from '@shared/ipc/schema/layout';

// UX wave U8b (O-09, X-165): the side column remembers two widths, one while it shows a reading tool and one otherwise.
export const WIDE_SURFACES = new Set(['review', 'files', 'browser']);
export const isWideColumn = (inView: readonly PanelTabRef[]): boolean => inView.some((tab) => WIDE_SURFACES.has(tab.toolId));
// The automatic width of a column for any other tool (a reading tool's is 60 % of the room).
export const NARROW_AUTOMATIC_WIDTH = 360;

// UX2: the approved mockup's 240px sidebar, content-sized surfaces, and temporary narrow-window yielding.
// Rendering never writes the user's remembered widths or collapse preference. UX wave U8b: the column's preferred width
// is the one remembered for its class (`widths`), or the automatic one; `regions.panel.width` is build F's and not read.
export function shellGeometry(regions: LayoutRegions, width: number, hasSurface: boolean, wide: boolean, widths: Pick<PanelWidths, 'wide' | 'narrow'>) {
  const open = hasSurface && !regions.panel.collapsed;
  const sidebarAside = width < 700 || (width < 1100 && open);
  const sidebar = regions.sidebar.collapsed || sidebarAside ? 0 : Math.min(480, Math.max(200, regions.sidebar.width));
  const sheet = width < 700 && open;
  const mainHidden = open && (regions.panel.maximized || regions.panel.floating);
  const room = width - sidebar;
  const panelMax = Math.max(280, room - 360);
  const automatic = wide ? Math.round(room * 0.6) : NARROW_AUTOMATIC_WIDTH;
  const preferred = (wide ? widths.wide : widths.narrow) ?? automatic;
  const panel = !open ? 0 : mainHidden ? room : sheet ? Math.max(280, width - 24) : Math.max(280, Math.min(panelMax, preferred));
  const columns = mainHidden ? `${sidebar}px 0px minmax(0, 1fr)` : `${sidebar}px minmax(0, 1fr) ${sheet ? 0 : panel}px`;
  // A normal surface owns the full-height right column; sheets and expanded surfaces leave the chrome across the window.
  const chrome = sheet || mainHidden ? width : width - panel;
  return { sidebar, sidebarAside, sheet, mainHidden, panel, panelMax, columns, chrome };
}
