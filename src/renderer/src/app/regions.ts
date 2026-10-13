// The region bounds (C5 execution document, M2; residue *Resizers*). Defaults are LAYOUT_DEFAULTS, which are the X7
// width tokens `--sidebar-w` and `--panel-w`. A persisted width outside its bounds renders clamped, and so does one the
// window cannot hold: the side regions never squeeze the main column below MAIN_MIN_WIDTH. The persisted widths stay
// as they are, so a window that grows back shows them again.
import { useSyncExternalStore } from 'react';
import { LAYOUT_DEFAULTS, type LayoutRegions } from '@shared/ipc/schema/layout';

export const SIDEBAR_BOUNDS = { min: 200, max: 480, default: LAYOUT_DEFAULTS.regions.sidebar.width };
export const PANEL_BOUNDS = { min: 280, max: 640, default: LAYOUT_DEFAULTS.regions.panel.width };
export const COLLAPSE_THRESHOLD_PX = 40; // a drag this far past the minimum collapses the region
// The main column's floor. Mockup 01 hides its panel below a 1220 px window and its sidebar below 760 px, which keeps
// its main column between 460 and 540 px at the tokens' widths; 480 is the most the 960 px minimum window can promise
// with both side regions at their minimums (960 - 200 - 280).
export const MAIN_MIN_WIDTH = 480;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface RegionWidths {
  sidebar: number; // the sidebar's rendered width while open (and the width it reopens at)
  sidebarMax: number;
  panel: number; // likewise for the panel
  panelMax: number;
}

// Each side region inside its own bounds and, together, inside the window less the main column's floor. The panel
// yields first: the sidebar may grow into the panel down to the panel's minimum, the panel only into what the sidebar
// leaves. A maximized panel stands in the main column, so the floor is its own and the sidebar is sized against it; so
// does a floating one (P3-G, §D1.3).
export function regionWidths(regions: LayoutRegions, windowWidth: number): RegionWidths {
  const room = windowWidth - MAIN_MIN_WIDTH;
  const panelBeside = !regions.panel.collapsed && !panelInMain(regions);
  const sidebarMax = Math.max(SIDEBAR_BOUNDS.min, Math.min(SIDEBAR_BOUNDS.max, room - (panelBeside ? PANEL_BOUNDS.min : 0)));
  const sidebar = clamp(regions.sidebar.width, SIDEBAR_BOUNDS.min, sidebarMax);
  const panelMax = Math.max(PANEL_BOUNDS.min, Math.min(PANEL_BOUNDS.max, room - (regions.sidebar.collapsed ? 0 : sidebar)));
  const panel = clamp(regions.panel.width, PANEL_BOUNDS.min, panelMax);
  return { sidebar, sidebarMax, panel, panelMax };
}

export const sidebarWidth = (regions: LayoutRegions, windowWidth: number): number => regionWidths(regions, windowWidth).sidebar;
export const panelWidth = (regions: LayoutRegions, windowWidth: number): number => regionWidths(regions, windowWidth).panel;

// P3-G (§D1.3): whether the panel stands in the main column's place, maximized or floating (the main region is at 0 px
// and inert then).
export const panelInMain = (regions: LayoutRegions): boolean => (regions.panel.maximized || regions.panel.floating) && !regions.panel.collapsed;

// `<sidebar> minmax(0, 1fr) <panel>`, a collapsed region at 0; a maximized or floating panel takes the main column's
// place while the main region keeps its state offscreen at 0.
export function gridColumns(regions: LayoutRegions, windowWidth: number): string {
  const widths = regionWidths(regions, windowWidth);
  const sidebar = regions.sidebar.collapsed ? 0 : widths.sidebar;
  if (panelInMain(regions)) return `${sidebar}px 0px minmax(0, 1fr)`;
  const panel = regions.panel.collapsed ? 0 : widths.panel;
  return `${sidebar}px minmax(0, 1fr) ${panel}px`;
}

const onResize = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};

// The window's width, following resizes.
export const useWindowWidth = (): number => useSyncExternalStore(onResize, () => window.innerWidth);
