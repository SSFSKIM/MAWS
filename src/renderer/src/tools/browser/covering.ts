// E4a (Task 3.2): the window's cover as main is told it (E4a execution document, Design §3 "Cover"; Decision Log 20).
// `browser.view.cover { covered: true }` goes out when the first layer that can overlap a pane opens and `false` when the
// last closes; main hides every view placed in this window meanwhile and sends each page's picture for its pane. Cover
// is the window's, with no tab ids: the renderer knows the layers, main knows the placed views.
//
// The layers: the DOM's (`watchCoverLayers` against the panes that own their view), the floating Overview while it is
// open, and the chrome's own holds (the address suggestions, which draw over the frozen page as an omnibox popup does).
// The watch runs only while a pane is mounted; the last pane leaving lifts any cover it had asked for. Any change of the
// notices store refreshes the watch on the next frame (after the toast host rendered it): the toast viewport unmounts
// while toasts are held and remounts as a new element the DOM watch cannot see by itself.
import { ipc } from '../../ipc/client';
import { useLayout } from '../../stores/layout';
import { useNotices } from '../../stores/notices';
import { watchCoverLayers, type CoverWatch, type PaneRect } from './cover';

type RectOf = () => PaneRect | null; // a mounted pane's rect while it owns its view, else null

const panes = new Set<RectOf>();
const holds = new Set<symbol>();
let watch: CoverWatch | null = null;
let offLayout: (() => void) | null = null;
let offNotices: (() => void) | null = null;
let noticesFrame = 0;
let domCovered = false;
let overviewOpen = false;
let told = false; // what main was last told

function sync(): void {
  const covered = panes.size > 0 && (domCovered || overviewOpen || holds.size > 0);
  if (covered === told) return;
  told = covered;
  void ipc.invoke('browser.view.cover', { covered }).then((result) => {
    if (!result.ok) console.warn(`[browser] the cover was refused: ${result.error.message}`);
  });
}

const rects = () => [...panes].flatMap((rectOf) => rectOf() ?? []);

function start(): void {
  overviewOpen = useLayout.getState().overviewOpen;
  offLayout = useLayout.subscribe((state) => {
    if (state.overviewOpen === overviewOpen) return;
    overviewOpen = state.overviewOpen;
    sync();
  });
  offNotices = useNotices.subscribe(() => {
    if (noticesFrame !== 0) return;
    noticesFrame = requestAnimationFrame(() => {
      noticesFrame = 0;
      watch?.refresh();
    });
  });
  watch = watchCoverLayers(rects, (covered) => {
    domCovered = covered;
    sync();
  });
}

function unsubscribe(): void {
  offLayout?.();
  offLayout = null;
  offNotices?.();
  offNotices = null;
  cancelAnimationFrame(noticesFrame);
  noticesFrame = 0;
}

function stop(): void {
  watch?.unwatch();
  watch = null;
  unsubscribe();
  domCovered = false;
  overviewOpen = false;
  sync();
}

// A pane mounted: the watch starts with the first. `refresh` after the pane moved, so the layers are measured against
// its new rect; `release` on unmount.
export function coverPane(rectOf: RectOf): { refresh(): void; release(): void } {
  panes.add(rectOf);
  if (panes.size === 1) start();
  sync();
  return {
    refresh: () => watch?.refresh(),
    release: () => {
      if (!panes.delete(rectOf)) return;
      if (panes.size === 0) stop();
      else watch?.refresh();
    },
  };
}

// A layer of the chrome's own, held until the returned function runs (once).
export function holdCover(): () => void {
  const hold = Symbol('cover');
  holds.add(hold);
  sync();
  return () => {
    if (holds.delete(hold)) sync();
  };
}

// Tests.
export function resetCovering(): void {
  watch?.unwatch();
  watch = null;
  unsubscribe();
  panes.clear();
  holds.clear();
  domCovered = false;
  overviewOpen = false;
  told = false;
}
