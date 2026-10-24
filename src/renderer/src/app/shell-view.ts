import { create } from 'zustand';
import { useLayout } from '../stores/layout';
import { surfaceSession, surfaceTabs } from '../panel/surface-model';
import { shellGeometry } from './shell-geometry';
import { useWindowWidth } from './regions';

export const useShellView = create<{ sidebarOverlay: boolean; cardsOverlay: boolean }>(() => ({ sidebarOverlay: false, cardsOverlay: false }));
export const WIDE_SURFACES = new Set(['review', 'files', 'browser', 'artifacts']);
export function useShellGeometry() {
  const width = useWindowWidth();
  const state = useLayout();
  const tabs = surfaceTabs(state, surfaceSession(state));
  return shellGeometry(state.regions, width, tabs.length > 0, tabs.some((tab) => WIDE_SURFACES.has(tab.toolId)));
}
export function showSidebar() {
  useLayout.getState().setSidebar({ collapsed: false });
  useShellView.setState({ sidebarOverlay: true });
}
export function toggleSidebar() {
  const state = useLayout.getState();
  const tabs = surfaceTabs(state, surfaceSession(state));
  const geometry = shellGeometry(state.regions, window.innerWidth, tabs.length > 0, tabs.some((tab) => WIDE_SURFACES.has(tab.toolId)));
  if (geometry.sidebarAside) useShellView.setState((s) => ({ sidebarOverlay: !s.sidebarOverlay }));
  else state.setSidebar({ collapsed: !state.regions.sidebar.collapsed });
}
