// E4a (Task 3.2): one mounted pane's side of `browser.view.place` (E4a execution document, Design §3; Decision Log 22
// and 39). Main keeps one owner per tab, by the token each pane mints at mount; a report with `claim` makes its pane the
// owner, any other pane's report is ignored. This controller decides what one pane sends:
//
// - `claiming`: the pane wants the view (mount, "Show here", the owner letting go). Its next real rect goes out with
//   `claim: true`; a rect under 1 px sends nothing, since a claim with no rect records nothing in main.
// - `owner`: it holds the view, or has claimed and waits for main's echo. Each changed rect goes out; a rect under 1 px
//   goes out as `null`, which releases the view, and the pane claims again when it has room.
// - `elsewhere`: another pane owns the tab; the pane sends nothing and offers "Show here".
//
// What main last said arrives as the tab's `placedIn` through `browser.tabs.changed`, which can trail a claim this pane
// just sent: until the echo names this pane, an owner it already saw before claiming (or none) is stale, and only a
// third pane's name means a later claim won.
import type { CommandInput } from '@shared/ipc/schema';
import type { PaneRect } from './cover';

export type PlacementMode = 'claiming' | 'owner' | 'elsewhere';
export type PlaceReport = CommandInput<'browser.view.place'>;

// The pane's rect in whole CSS px of the window's content area (each edge rounded, so neighbours keep meeting), or null
// when the pane is under 1 px either way (a collapsed panel keeps its column at 0; a maximized panel hides the main area).
export function paneRect({ left, top, right, bottom }: Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>): PaneRect | null {
  const x = Math.round(left);
  const y = Math.round(top);
  const width = Math.round(right) - x;
  const height = Math.round(bottom) - y;
  return width < 1 || height < 1 ? null : { x, y, width, height };
}

const same = (a: PaneRect | null, b: PaneRect | null) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

export interface PlacementOptions {
  tabId: string;
  paneId: string;
  surface: 'panel' | 'main';
  owner: string | null; // the tab's `placedIn.paneId` when the pane mounted
  measure(): PaneRect | null;
  send(report: PlaceReport): void;
  onMode(mode: PlacementMode): void;
}

export class Placement {
  private mode: PlacementMode = 'claiming';
  private seen: string | null; // the owner `placedIn` last named
  private claimedOver: { owner: string | null } | null = null; // a claim sent and not yet echoed: the owner seen then
  private sent: PaneRect | null = null; // the rect main holds from this pane

  constructor(private readonly options: PlacementOptions) {
    this.seen = options.owner;
  }

  // Sends what the pane's rect now calls for.
  report(): void {
    if (this.mode === 'elsewhere') return;
    const rect = this.options.measure();
    if (this.mode === 'claiming') {
      if (rect === null) return;
      this.claimedOver = { owner: this.seen };
      this.sent = rect;
      this.setMode('owner');
      this.send(rect, true);
      return;
    }
    if (same(rect, this.sent)) return;
    if (rect === null) {
      this.release();
      this.setMode('claiming');
      return;
    }
    this.sent = rect;
    this.send(rect, false);
  }

  // The tab's `placedIn` as main last listed it.
  observe(owner: string | null): void {
    if (owner === this.seen) return;
    this.seen = owner;
    if (owner === this.options.paneId) {
      this.claimedOver = null;
      if (this.mode !== 'owner') this.setMode('owner');
      this.report();
      return;
    }
    if (this.claimedOver) {
      if (owner === null || owner === this.claimedOver.owner) return; // from before the claim landed
      this.claimedOver = null;
      this.sent = null;
      this.setMode('elsewhere');
      return;
    }
    this.sent = null;
    if (owner === null) {
      this.setMode('claiming');
      this.report();
    } else {
      this.setMode('elsewhere');
    }
  }

  // "Show here": claim the view back.
  showHere(): void {
    this.claimedOver = null;
    this.setMode('claiming');
    this.report();
  }

  // Unmount: an owner lets go.
  dispose(): void {
    if (this.mode === 'owner') this.release();
  }

  // The rect this pane holds the view at, for the cover's intersection rule; null unless it owns it.
  ownedRect(): PaneRect | null {
    return this.mode === 'owner' ? this.sent : null;
  }

  private release(): void {
    this.sent = null;
    this.claimedOver = null;
    this.send(null, false);
  }

  private send(rect: PaneRect | null, claim: boolean): void {
    const { tabId, paneId, surface } = this.options;
    this.options.send({ tabId, paneId, surface, rect, claim });
  }

  private setMode(mode: PlacementMode): void {
    this.mode = mode;
    this.options.onMode(mode);
  }
}
