// Parking (E4c execution document, Design §9; Decision Log 7, 36, 43): a tab the agent reaches while no pane shows it.
// E4a creates a view with no bounds (a 0 x 0 viewport) and attaches it to no window until a pane places it, and a
// released view sits hidden in its last window; on either, Playwright's hit-target check and screenshots cannot work.
// Task 0.3 and Task 2.4's probes measured the remedy (`findings-e4c-unplaced.txt`, `findings-e4c-released.txt`): out of
// any window at 1280 x 800 the page works (snapshot, click, viewport screenshot), never-placed and released alike, and the
// size alone is enough: the page reads visible through Playwright's attach-time focus emulation, not through the view's
// native visibility, which therefore stays E4a's.
//
// The rule: while a tab has a view, no pane places it, and the agent holds it or has a request on it (pending or
// queued), the view is parked (E4a's `ViewManager.park`, an E4c block); a pane's claim supersedes the parking (its rect
// applies as to any unplaced view), and the tab is unparked when the agent lets go with nothing pending. Unparking
// leaves the view where it is, hidden and out of any window, as E4a keeps a never-placed view; the next pane's placement
// sizes it. A covered tab is still placed and is never parked: an action waits for the cover (Design §6).
import type { TabEntry, TabStore } from '../tabs';
import type { ViewManager } from '../view';
import type { TabControls } from './control';

export const PARKED_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };

export interface ParkingDeps {
  store: Pick<TabStore, 'all' | 'onUpdated' | 'onViewCreated' | 'onViewDestroying'>;
  views: Pick<ViewManager, 'park'>;
  controls: Pick<TabControls, 'onChange' | 'pending'>;
}

export class Parking {
  private readonly parkedTabs = new WeakSet<TabEntry>();
  private readonly unhook: (() => void)[];

  constructor(private readonly deps: ParkingDeps) {
    const { store, controls } = deps;
    this.unhook = [
      store.onUpdated((entry) => this.update(entry)), // placedIn, control, a view made or gone
      store.onViewCreated((entry) => this.update(entry)),
      store.onViewDestroying((entry) => void this.parkedTabs.delete(entry)), // a new view is parked afresh
      controls.onChange((entry) => this.update(entry)), // the pending count
    ];
    for (const entry of store.all()) this.update(entry);
  }

  parked(entry: TabEntry): boolean {
    return this.parkedTabs.has(entry);
  }

  dispose(): void {
    for (const unhook of this.unhook.splice(0)) unhook();
  }

  private update(entry: TabEntry): void {
    const wanted = entry.view !== null && entry.placement === null && (entry.tab.control === 'agent' || this.deps.controls.pending(entry) > 0);
    if (!wanted) {
      this.parkedTabs.delete(entry);
      return;
    }
    if (this.parkedTabs.has(entry)) return;
    this.parkedTabs.add(entry);
    this.deps.views.park(entry, PARKED_BOUNDS);
  }
}
