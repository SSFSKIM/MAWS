// UX2: one chrome row; optional content-sized surfaces; cards live over main, never in an empty panel column.
import { useEffect } from 'react';
import { BannerHost } from './BannerHost';
import { MainArea } from '../main/MainArea';
import { OverviewLayer } from '../overview/OverviewPanel';
import { MarkupLayer } from '../markup/MarkupLayer';
import { CommandPalette } from '../palette/CommandPalette';
import { KeyboardShortcuts } from '../keymap/KeyboardShortcuts';
import { PanelRegion } from '../panel/PanelRegion';
import { FloatingSummary } from '../panel/summary/Summary';
import { activeTab, currentSet, sessionOfTab } from '../stores/layout-model';
import { Sidebar } from '../sidebar/Sidebar';
import { useLayout } from '../stores/layout';
import { COLLAPSE_THRESHOLD_PX, SIDEBAR_BOUNDS, useWindowWidth } from './regions';
import { useShellGeometry, useShellView } from './shell-view';
import { Resizer } from './Resizer';
import { ToastHost } from './ToastHost';
import { Toolbar } from './Toolbar';
import { holdCover } from '../tools/browser/covering';
import { useDragAccepted } from '../shell/transfer';
import { useSessions } from '../stores/sessions';

export const SIDEBAR_REGION_ID = 'region-sidebar';
export const MAIN_REGION_ID = 'region-main';

export function Shell() {
  const geometry = useShellGeometry();
  const width = useWindowWidth();
  const session = useLayout((s) => sessionOfTab(activeTab(s.main)));
  const hasSession = useSessions((s) => session !== null && s.records.has(session));
  const active = useLayout((s) => activeTab(s.main)?.id);
  const collapsed = useLayout((s) => s.regions.panel.collapsed);
  const overlay = useShellView((s) => s.sidebarOverlay);
  const cardsOverlay = useShellView((s) => s.cardsOverlay);
  const split = useLayout((s) => currentSet(s.main).panes.length === 2);
  const edgeDrag = useDragAccepted('edge');
  // Let the split target reach the main region's outer edge; keep cards mounted for a lossless cancel.
  const yieldCards = edgeDrag && !split;
  const room = width - geometry.sidebar;
  const cards = hasSession && session !== null && geometry.panel === 0 && !collapsed && (room >= 960 || cardsOverlay);
  // Wide cards reserve a column below; explicitly opened narrow cards overlay main's native pages.
  const cardsCover = cards && !yieldCards && room < 960;
  useEffect(() => cardsCover ? holdCover() : undefined, [cardsCover]);
  useEffect(() => { useShellView.setState({ sidebarOverlay: false }); }, [active]);
  return (
    <div data-shell className="relative grid h-full grid-rows-[var(--toolbar-h)_auto_minmax(0,1fr)] bg-bg text-fg" style={{ gridTemplateColumns: geometry.columns }}>
      <Toolbar />
      <BannerHost className="col-span-2 row-start-2" />
      {geometry.sidebarAside && overlay && <button aria-label="Close sidebar overlay" onClick={() => useShellView.setState({ sidebarOverlay: false })} className="absolute inset-0 top-(--toolbar-h) z-30 bg-fg/10" />}
      <SidebarRegion />
      <section id={MAIN_REGION_ID} data-region="main" aria-label="Main" inert={geometry.mainHidden || geometry.sheet} className="relative col-start-2 row-start-3 flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={cards && !yieldCards && room >= 960 ? { paddingRight: 304 } : undefined}>
          <MainArea />
          <OverviewLayer />
        </div>
        {cards && <aside data-region="cards" aria-label="Session cards" hidden={yieldCards} className="absolute top-3 right-3 bottom-3 z-20 w-70 overflow-y-auto"><FloatingSummary appSessionId={session} /></aside>}
      </section>
      <ToastHost />
      <PanelRegion />
      <MarkupLayer />
      <CommandPalette />
      <KeyboardShortcuts />
    </div>
  );
}

function SidebarRegion() {
  const geometry = useShellGeometry();
  const overlay = useShellView((s) => s.sidebarOverlay);
  const persisted = useLayout((s) => s.regions.sidebar.width);
  const setSidebar = useLayout((s) => s.setSidebar);
  const floating = geometry.sidebarAside && overlay;
  // The dismiss layer spans the content: native views must yield along with the DOM beneath it.
  useEffect(() => floating ? holdCover() : undefined, [floating]);
  const hidden = geometry.sidebar === 0 && !floating;
  const width = floating ? Math.min(320, Math.max(240, persisted)) : geometry.sidebar;
  return (
    <section id={SIDEBAR_REGION_ID} data-region="sidebar" aria-label="Sidebar" inert={hidden}
      onKeyDown={(event) => { if (floating && event.key === 'Escape') { event.stopPropagation(); useShellView.setState({ sidebarOverlay: false }); } }}
      className={`${floating ? 'absolute inset-y-0 top-(--toolbar-h) left-0 z-40 shadow-float' : 'relative col-start-1 row-start-3'} flex min-h-0 min-w-0 bg-bg ${hidden ? 'overflow-hidden' : 'border-r border-border'}`} style={floating ? { width } : undefined}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><Sidebar /></div>
      {!hidden && !floating && <Resizer label="Resize sidebar" controls={SIDEBAR_REGION_ID} value={width} min={SIDEBAR_BOUNDS.min} max={SIDEBAR_BOUNDS.max} defaultValue={240} collapseThreshold={COLLAPSE_THRESHOLD_PX} restoreValue={persisted}
        onChange={(next) => setSidebar({ width: next })} onCollapse={(restore) => setSidebar({ collapsed: true, width: restore })} className="absolute inset-y-0 -right-0.75" />}
    </section>
  );
}
