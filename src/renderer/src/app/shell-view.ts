import { create } from 'zustand';
import { useLayout, type LayoutState } from '../stores/layout';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { shellGeometry } from './shell-geometry';
import { useWindowWidth } from './regions';

export const useShellView = create<{ sidebarOverlay: boolean; cardsOverlay: boolean }>(() => ({ sidebarOverlay: false, cardsOverlay: false }));
export const WIDE_SURFACES = new Set(['review', 'files', 'browser']);
export function shellGeometryOf(state: LayoutState, width: number) {
  const tabs = surfaceTabs(state, surfaceSession(state));
  return shellGeometry(state.regions, width, tabs.length > 0, tabs.some((tab) => WIDE_SURFACES.has(tab.toolId)));
}
export function useShellGeometry() {
  const width = useWindowWidth();
  const state = useLayout();
  return shellGeometryOf(state, width);
}
export function showSidebar() {
  useLayout.getState().setSidebar({ collapsed: false });
  useShellView.setState({ sidebarOverlay: true });
}
export function toggleSidebar() {
  const state = useLayout.getState();
  const geometry = shellGeometryOf(state, window.innerWidth);
  if (geometry.sidebarAside) useShellView.setState((s) => ({ sidebarOverlay: !s.sidebarOverlay }));
  else state.setSidebar({ collapsed: !state.regions.sidebar.collapsed });
}
