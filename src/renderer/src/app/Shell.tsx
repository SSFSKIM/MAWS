// UX2: one chrome row; optional content-sized surfaces; cards live over main, never in an empty panel column.
// UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M5 decisions 2 and 4): a
// page is a grid item over the second and third columns of the third row, in every geometry. What it covers is off
// screen by one mechanism, mounted, invisible and inert: the main area (a wrapper around `MainArea`, not the main region,
// which holds the Overview's layer, drawn over the page), the card column and the side column (`PanelRegion`'s own). The
// grid's tracks, the main area's padding and the card column's place (`placed`) do not change, so each keeps its box and
// its scroll. The title bar and the banner row span every column. The Settings dialog is mounted here once.
import { useEffect } from 'react';
import { BannerHost } from './BannerHost';
import { MainArea } from '../main/MainArea';
import { MarkupLayer } from '../markup/MarkupLayer';
import { CommandPalette } from '../palette/CommandPalette';
import { KeyboardShortcuts } from '../keymap/KeyboardShortcuts';
import { PanelRegion } from '../panel/PanelRegion';
import { FloatingSummary } from '../panel/summary/Summary';
import { activeTab, currentSet } from '../stores/layout-model';
import { Sidebar } from '../sidebar/Sidebar';
import { pageOpen, useLayout } from '../stores/layout';
import { DestinationPage } from '../destination/DestinationPage';
import { OverviewHost } from '../destination/OverviewHost';
import { SettingsDialog } from '../destination/SettingsDialog';
import { COLLAPSE_THRESHOLD_PX, SIDEBAR_BOUNDS } from './regions';
import { CARD_COLUMN_ROOM } from './shell-geometry';
import { useCardColumn, useShellGeometry, useShellView } from './shell-view';
import { Resizer } from './Resizer';
import { ToastHost } from './ToastHost';
import { Toolbar } from './Toolbar';
import { holdCover } from '../tools/browser/covering';
import { useDragAccepted } from '../shell/transfer';

export const SIDEBAR_REGION_ID = 'region-sidebar';
export const MAIN_REGION_ID = 'region-main';

export function Shell() {
  const geometry = useShellGeometry();
  const { session, room, placed, shown: cards } = useCardColumn(); // UX wave U8b (§C.2): the card column's one source
  const page = useLayout(pageOpen); // UX wave U7b
  const active = useLayout((s) => activeTab(s.main)?.id);
  const overlay = useShellView((s) => s.sidebarOverlay);
  const split = useLayout((s) => currentSet(s.main).panes.length === 2);
  const edgeDrag = useDragAccepted('edge');
  // Let the split target reach the main region's outer edge; keep cards mounted for a lossless cancel.
  const yieldCards = edgeDrag && !split;
  // Wide cards reserve a column below; explicitly opened narrow cards overlay main's native pages.
  const cardsCover = cards && !yieldCards && room < CARD_COLUMN_ROOM;
  useEffect(() => cardsCover ? holdCover() : undefined, [cardsCover]);
  // UX wave U7b: an in-app browser's native views yield for as long as a page covers the panes that place them.
  useEffect(() => page ? holdCover() : undefined, [page]);
  // The sidebar drawn over a narrow window goes with what it opened: a tab, a page (which changes no tab) or Settings.
  const destination = useLayout((s) => s.destination);
  const settingsOpen = useLayout((s) => s.settings !== null);
  useEffect(() => { useShellView.setState({ sidebarOverlay: false }); }, [active, destination, settingsOpen]);
  return (
    <div data-shell className="relative grid h-full grid-rows-[var(--toolbar-h)_auto_minmax(0,1fr)] bg-bg text-fg" style={{ gridTemplateColumns: geometry.columns }}>
      <Toolbar />
      <BannerHost className={`${page ? 'col-span-3' : 'col-span-2'} row-start-2`} />
      {geometry.sidebarAside && overlay && <button aria-label="Close sidebar overlay" onClick={() => useShellView.setState({ sidebarOverlay: false })} className="absolute inset-0 top-(--toolbar-h) z-30 bg-fg/10" />}
      <SidebarRegion />
      <section id={MAIN_REGION_ID} data-region="main" aria-label="Main" inert={!page && (geometry.mainHidden || geometry.sheet)} className="relative col-start-2 row-start-3 flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={placed && !yieldCards && room >= CARD_COLUMN_ROOM ? { paddingRight: 304 } : undefined}>
          <div data-behind-page inert={page} className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${page ? 'invisible' : ''}`}>
            <MainArea />
          </div>
          <OverviewHost />
        </div>
        {placed && <aside data-region="cards" aria-label="Session cards" hidden={yieldCards} inert={!cards} className={`absolute top-3 right-3 bottom-3 z-20 w-70 overflow-y-auto ${cards ? '' : 'invisible'}`}><FloatingSummary appSessionId={session} /></aside>}
      </section>
      <DestinationPage />
      <ToastHost />
      <PanelRegion />
      <MarkupLayer />
      <CommandPalette />
      <KeyboardShortcuts />
      <SettingsDialog />
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
