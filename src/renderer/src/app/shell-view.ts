import { create } from 'zustand';
import { useLayout, type LayoutState } from '../stores/layout';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { isWideColumn, shellGeometry } from './shell-geometry';
import { useWindowWidth } from './regions';

export const useShellView = create<{ sidebarOverlay: boolean; cardsOverlay: boolean }>(() => ({ sidebarOverlay: false, cardsOverlay: false }));
export { WIDE_SURFACES } from './shell-geometry';
// A column is wide while a reading tool is among the tabs in view; its width is the one remembered for that class.
export function shellGeometryOf(state: LayoutState, width: number) {
  const tabs = surfaceTabs(state, surfaceSession(state));
  return shellGeometry(state.regions, width, tabs.length > 0, isWideColumn(tabs), state.panelWidths);
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
