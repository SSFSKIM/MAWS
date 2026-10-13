// E4a (Task 3.2): the window's cover as main is told it (E4a execution document, Design §3 "Cover"; Decision Log 20).
// `browser.view.cover { covered: true }` goes out when the first layer that can overlap a pane opens and `false` when the
// last closes; main hides every view placed in this window meanwhile and sends each page's picture for its pane. Cover
// is the window's, with no tab ids: the renderer knows the layers, main knows the placed views.
//
// The layers: the DOM's (`watchCoverLayers` against the panes that own their view), the floating Overview while it is
// open over a main area on screen (P3-G: a floating or maximized panel stands in main's place, main at 0 px, so the
// Overview it holds draws nothing and the panel's page stays live; docking finds it open and covering again), and the
// chrome's own holds (the address suggestions, which draw over the frozen page as an omnibox popup does).
// The watch runs only while a pane is mounted; the last pane leaving lifts any cover it had asked for. Any change of the
// notices store refreshes the watch on the next frame (after the toast host rendered it): the toast viewport unmounts
// while toasts are held and remounts as a new element the DOM watch cannot see by itself.
import { panelInMain } from '../../app/regions';
import { ipc } from '../../ipc/client';
import { useLayout, type LayoutState } from '../../stores/layout';
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
let overviewShown = false; // the Overview open over main on screen
let told = false; // what main was last told
let answered: Promise<void> = Promise.resolve(); // P3-G: main's answer to the last `covered: true`

function sync(): void {
  const covered = panes.size > 0 && (domCovered || overviewShown || holds.size > 0);
  if (covered === told) return;
  told = covered;
  const answer = ipc.invoke('browser.view.cover', { covered }).then((result) => {
    if (!result.ok) console.warn(`[browser] the cover was refused: ${result.error.message}`);
  });
  if (covered) answered = answer;
}

const rects = () => [...panes].flatMap((rectOf) => rectOf() ?? []);

const overviewShownIn = (state: LayoutState): boolean => state.overviewOpen && !panelInMain(state.regions);

function start(): void {
  overviewShown = overviewShownIn(useLayout.getState());
  offLayout = useLayout.subscribe((state) => {
    const shown = overviewShownIn(state);
    if (shown === overviewShown) return;
    overviewShown = shown;
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
  overviewShown = false;
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

// P3-G (the M4 review's ruling 4): once main has answered the window's cover (at once when nothing is covered), so
// Mark-up draws its overlay only after the request reached main.
export function coverAcknowledged(): Promise<void> {
  return told ? answered : Promise.resolve();
}

// Tests.
export function resetCovering(): void {
  watch?.unwatch();
  watch = null;
  unsubscribe();
  panes.clear();
  holds.clear();
  domCovered = false;
  overviewShown = false;
  told = false;
  answered = Promise.resolve();
}
