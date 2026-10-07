// E4a (Task 3.2): the pane, where a tab's page shows (E4a execution document, Design §3 "The renderer's half" and §4 "The
// pane"). The page itself is a native view main lays exactly over this element; the pane tells main where it is
// (`placement.ts` decides what one pane sends) and draws what the view cannot:
//
// - the placement reports: a ResizeObserver on the element (its own size, within the frame), the layout store on the
//   next animation frame after any change of the regions or the main area (moves a ResizeObserver misses: the sidebar
//   collapsing, a split moving, the panel resizing from its other edge; once per frame while the Resizer drags), and
//   the window's resize; `null` on unmount;
// - the cover: the pane joins the window's cover (`covering.ts`) with the rect it owns the view at, and draws the page's
//   picture under a layer while main has the view hidden;
// - the renderer-drawn pages by the tab's state: another pane owns it, the view could not be created, the renderer
//   crashed, the load failed, the tab never navigated, the tab is suspended.
//
// A pane shows one tab: another tab is another mount with its own token (the caller keys it by tab).
import { useEffect, useRef, useState } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { useLayout } from '../../stores/layout';
import { place } from './actions';
import { BROWSER_COPY } from './copy';
import { coverPane } from './covering';
import { CrashPage, ViewFailedPage } from './pages/CrashPage';
import { EmptyState, SuspendedPage } from './pages/EmptyState';
import { ErrorPage } from './pages/ErrorPage';
import { ShownElsewhere } from './pages/ShownElsewhere';
import { paneRect, Placement, type PlacementMode } from './placement';
import { onShowRequest, useBrowser } from './store';

const PANE = 'relative h-full w-full overflow-hidden bg-bg';

export interface BrowserPaneProps {
  tab: BrowserTab | null; // null: the session has no tab to show
  surface: 'panel' | 'main';
  gone?: boolean; // a main tab whose tab main no longer knows (Decision Log 21)
  onOwns?(owns: boolean): void; // whether this pane holds the page's view (the chrome's commands follow it)
}

export function BrowserPane({ tab, surface, gone = false, onOwns }: BrowserPaneProps) {
  if (tab === null) {
    return (
      <div data-browser-pane="" className={PANE}>
        <EmptyState notice={gone ? BROWSER_COPY.tabGone : undefined} />
      </div>
    );
  }
  return <PlacedPane key={tab.tabId} tab={tab} surface={surface} onOwns={onOwns} />;
}

function PlacedPane({ tab, surface, onOwns }: { tab: BrowserTab; surface: 'panel' | 'main'; onOwns?(owns: boolean): void }) {
  const element = useRef<HTMLDivElement>(null);
  const placement = useRef<Placement | null>(null);
  const [mode, setMode] = useState<PlacementMode>('claiming');
  const { tabId } = tab;
  const owner = tab.placedIn?.paneId ?? null;
  const [ownerAtMount] = useState(owner);

  useEffect(() => {
    const pane = element.current;
    if (!pane) return;
    let cover: ReturnType<typeof coverPane> | null = null;
    const control = new Placement({
      tabId,
      paneId: crypto.randomUUID(),
      surface,
      owner: ownerAtMount,
      measure: () => paneRect(pane.getBoundingClientRect()),
      send: (report) => {
        place(report);
        cover?.refresh();
      },
      onMode: setMode,
    });
    placement.current = control;
    cover = coverPane(() => control.ownedRect());
    control.report();

    const report = () => control.report();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    resize?.observe(pane);
    let frame = 0;
    const offLayout = useLayout.subscribe((state, previous) => {
      if ((state.regions === previous.regions && state.main === previous.main) || frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        control.report();
      });
    });
    window.addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      offLayout();
      window.removeEventListener('resize', report);
      control.dispose();
      cover.release();
      placement.current = null;
    };
  }, [tabId, surface, ownerAtMount]);

  useEffect(() => placement.current?.observe(owner), [owner]);
  // the overflow menu's "Open in tab" or "Show in panel" naming this pane's tab and surface: as "Show here"
  useEffect(
    () =>
      onShowRequest((request) => {
        if (request.tabId === tabId && request.surface === surface) placement.current?.showHere();
      }),
    [tabId, surface],
  );
  useEffect(() => onOwns?.(mode === 'owner'), [mode, onOwns]);
  useEffect(() => () => onOwns?.(false), [onOwns]);

  return (
    <div ref={element} data-browser-pane="" className={PANE}>
      {mode === 'elsewhere' ? <ShownElsewhere onShowHere={() => placement.current?.showHere()} /> : <TabPage tab={tab} />}
    </div>
  );
}

// What the pane draws for the tab's state; nothing over a live page but its picture while a layer covers it.
function TabPage({ tab }: { tab: BrowserTab }) {
  const placeholder = useBrowser((s) => s.placeholders.get(tab.tabId) ?? null);
  if (tab.failed) return <ViewFailedPage tabId={tab.tabId} message={tab.failed.message} />;
  if (tab.crashed) return <CrashPage tabId={tab.tabId} reason={tab.crashed.reason} />;
  if (tab.loadError) return <ErrorPage tabId={tab.tabId} loadError={tab.loadError} />;
  if (tab.url === '') return <EmptyState />;
  if (tab.suspended) return <SuspendedPage tab={tab} />;
  if (tab.covered && placeholder) return <img alt="" src={placeholder} className="pointer-events-none absolute inset-0 size-full object-cover object-top-left" />;
  return null;
}
