// The region bounds (C5 execution document, M2; residue *Resizers*). Defaults are LAYOUT_DEFAULTS, which are the X7
// width tokens `--sidebar-w` and `--panel-w`. A persisted width outside its bounds renders clamped.
import { LAYOUT_DEFAULTS, type LayoutRegions } from '@shared/ipc/schema/layout';

export const SIDEBAR_BOUNDS = { min: 200, max: 480, default: LAYOUT_DEFAULTS.regions.sidebar.width };
export const PANEL_BOUNDS = { min: 280, max: 640, default: LAYOUT_DEFAULTS.regions.panel.width };
export const COLLAPSE_THRESHOLD_PX = 40; // a drag this far past the minimum collapses the region

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value));

export const sidebarWidth = (regions: LayoutRegions): number => clamp(regions.sidebar.width, SIDEBAR_BOUNDS);
export const panelWidth = (regions: LayoutRegions): number => clamp(regions.panel.width, PANEL_BOUNDS);

// `<sidebar> minmax(0, 1fr) <panel>`, a collapsed region at 0; a maximized panel takes the main column's place while
// the main region keeps its state offscreen at 0.
export function gridColumns(regions: LayoutRegions): string {
  const sidebar = regions.sidebar.collapsed ? 0 : sidebarWidth(regions);
  if (regions.panel.maximized && !regions.panel.collapsed) return `${sidebar}px 0px minmax(0, 1fr)`;
  const panel = regions.panel.collapsed ? 0 : panelWidth(regions);
  return `${sidebar}px minmax(0, 1fr) ${panel}px`;
}
