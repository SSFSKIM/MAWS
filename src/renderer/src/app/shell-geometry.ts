import type { LayoutRegions } from '@shared/ipc/schema/layout';

// UX2: the approved mockup's 240px sidebar, content-sized surfaces, and temporary narrow-window yielding.
// Rendering never writes the user's remembered widths or collapse preference.
export function shellGeometry(regions: LayoutRegions, width: number, hasSurface: boolean, wide: boolean) {
  const open = hasSurface && !regions.panel.collapsed;
  const sidebarAside = width < 700 || (width < 1100 && open);
  const sidebar = regions.sidebar.collapsed || sidebarAside ? 0 : Math.min(480, Math.max(200, regions.sidebar.width));
  const sheet = width < 700 && open;
  const mainHidden = open && (regions.panel.maximized || regions.panel.floating);
  const room = width - sidebar;
  const panelMax = Math.max(280, room - 360);
  // Preserve a person's resized width. The previous default (380) adopts the new content-based default.
  const automatic = wide ? Math.round(room * 0.6) : 420;
  const preferred = regions.panel.width === 380 ? automatic : regions.panel.width;
  const panel = !open ? 0 : mainHidden ? room : sheet ? Math.max(280, width - 24) : Math.max(280, Math.min(panelMax, preferred));
  const columns = mainHidden ? `${sidebar}px 0px minmax(0, 1fr)` : `${sidebar}px minmax(0, 1fr) ${sheet ? 0 : panel}px`;
  // A normal surface owns the full-height right column; sheets and expanded surfaces leave the chrome across the window.
  const chrome = sheet || mainHidden ? width : width - panel;
  return { sidebar, sidebarAside, sheet, mainHidden, panel, panelMax, columns, chrome };
}
