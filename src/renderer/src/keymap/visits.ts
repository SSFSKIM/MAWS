// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M3; Interfaces §D; S2; decisions 12
// to 16): the record's one reader, the step Back and Forward take, and their two handlers. The reader reads the layout
// once per turn of the event loop, in a microtask after the first change, and compares only the navigation projection
// (`places.ts`), so an act that writes the store twice in one run (the Overview's close after a change of the strip) is
// one visit, and a write that changes nothing of the projection is no event. `opened` is what the palette's Recent reads
// (M4): the sessions and artifacts that came to be in front as main tabs, newest first, each once. Nothing here writes
// the strip or stores anything: a step goes through the layout store's own acts (the wave's UC-12).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { useLayout } from '../stores/layout';
import { allTabs, currentSet } from '../stores/layout-model';
import { focusPaneElement } from '../main/pane-dom';
import { registerAction } from './actions-runtime';
import { available } from './shell-navigation';
import { EMPTY_RECORD, gone, PLACES_MAX, placeOf, projectionOf, refocused, samePlace, seen, target, type Place, type PlaceRecord, type Projection } from './places';

export type Opened = { kind: 'session'; appSessionId: AppSessionId } | { kind: 'artifact'; artifactId: string; machine: MachineRef };
export const OPENED_MAX = PLACES_MAX;

export const useVisits = create<{ record: PlaceRecord; opened: readonly Opened[] }>()(() => ({ record: EMPTY_RECORD, opened: [] }));

const sameOpened = (a: Opened, b: Opened) =>
  a.kind === 'session' ? b.kind === 'session' && a.appSessionId === b.appSessionId : b.kind === 'artifact' && a.artifactId === b.artifactId && a.machine === b.machine;

// The session or artifact a main tab shows; none for any other kind of tab.
function openedOf(tabId: string): Opened | null {
  const tab = allTabs(useLayout.getState().main).find((t) => t.id === tabId);
  if (tab?.kind === 'session') return { kind: 'session', appSessionId: tab.appSessionId };
  if (tab?.kind === 'artifact') return { kind: 'artifact', artifactId: tab.artifactId, machine: tab.machine };
  return null;
}

const sameView = (a: Projection, b: Projection) =>
  a.overview === b.overview && JSON.stringify(a.page) === JSON.stringify(b.page) && a.fronts.length === b.fronts.length && a.fronts.every((id, i) => id === b.fronts[i]);

// A step's hand-off of the keyboard (M3's task review and re-review; Decision Log 11 (viii)): from the step until a task
// after its frame, the pane the step put in front is the focused pane. The Overview, closing, gives the keyboard back to
// the element that held it when it opened, which can stand in the other pane of a split; the pane it lands in becomes
// the focused pane (`main/Pane.tsx`). A projection that differs from the one the step left only in `focusedPane` is
// that return, not the person's move: the reader gives the keyboard back to the step's pane. Any other difference (the
// page, the Overview, a pane's tab in front, the tabs: an agent's or the person's act) ends the hand-off, and it is read
// as any change is. The step's own frame for the keyboard belongs to the hand-off: a later step, the person's key or
// press, and any such change cancel it, so a superseded step never takes the keyboard.
let handoff: { meant: Projection; pane: number } | null = null;
let handoffEnds: (() => void) | null = null;

function endHandoff(): void {
  handoff = null;
  handoffEnds?.();
  handoffEnds = null;
}

const sameTabs = (a: Projection, b: Projection) => a.tabs.size === b.tabs.size && [...a.tabs].every((id) => b.tabs.has(id));
const onlyPaneDiffers = (a: Projection, b: Projection) => sameView(a, b) && sameTabs(a, b);

// `focusOnFrame`: a step to a tab, whose pane takes the keyboard on the next frame (a step to the Overview gave it at
// once, and the Overview takes it as it opens).
function startHandoff(meant: Projection, focusOnFrame: boolean): void {
  endHandoff();
  const mine = { meant, pane: meant.focusedPane };
  handoff = mine;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const byPerson = () => endHandoff();
  const frame = requestAnimationFrame(() => {
    if (handoff !== mine) return;
    const now = projectionOf(useLayout.getState());
    if (focusOnFrame && onlyPaneDiffers(now, meant)) focusPaneNow();
    timer = setTimeout(() => {
      if (handoff === mine) endHandoff();
    }, 0);
  });
  window.addEventListener('keydown', byPerson, true);
  window.addEventListener('pointerdown', byPerson, true);
  handoffEnds = () => {
    cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    window.removeEventListener('keydown', byPerson, true);
    window.removeEventListener('pointerdown', byPerson, true);
  };
}

// The projection as the step left it, when the one now differs from it only by a pane that took the keyboard during
// the hand-off; the keyboard and the focused pane are put back on the step's pane. Any other difference ends the
// hand-off and is read as it is.
function heldByStep(next: Projection): Projection {
  if (handoff === null) return next;
  const { meant, pane } = handoff;
  if (!onlyPaneDiffers(next, meant)) {
    endHandoff();
    return next;
  }
  if (next.focusedPane === pane) return next;
  const region = document.getElementById('region-main');
  if (region && available(region)) focusPaneElement(pane as 0 | 1);
  if (currentSet(useLayout.getState().main).focusedPane !== pane) useLayout.getState().focusPane(pane as 0 | 1);
  return meant;
}

// One read (Interfaces §D, the reader's four steps): tabs that left take their entries; a change of the focused pane
// alone points the entry at the tab now in front; any other change of the projection is `seen`.
function read(last: Projection, next: Projection): void {
  let { record, opened } = useVisits.getState();
  const left = new Set([...last.tabs].filter((id) => !next.tabs.has(id)));
  if (left.size > 0) record = gone(record, left);
  const place = placeOf(next);
  if (sameView(last, next)) {
    if (last.focusedPane !== next.focusedPane && place !== null) record = refocused(record, place);
  } else if (place !== null) {
    record = seen(record, place);
    const before = placeOf(last);
    const came = place.kind === 'tab' && !(before !== null && samePlace(before, place)) ? openedOf(place.id) : null;
    if (came !== null) opened = [came, ...opened.filter((o) => !sameOpened(o, came))].slice(0, OPENED_MAX);
  }
  if (record !== useVisits.getState().record || opened !== useVisits.getState().opened) useVisits.setState({ record, opened });
}

// A step (decision 15), in one synchronous run: the position first, then the layout written whole through the store's
// own acts, so the reader's next read finds the projection equal to the entry it stands at and records nothing. The
// Settings dialog closes; the Overview is set both ways (finding 5). The pane in front takes the keyboard: after a step
// to a tab, on the next frame, as after ⌥⌘] (`stepMainTab`), unless the hand-off ended before it; before the Overview
// opens over a tab, at once, so the element the Overview gives the keyboard back to when it closes is in the pane of the
// place it is over. The hand-off starts from the projection the step's writes left.
function step(delta: 1 | -1): void {
  const { record } = useVisits.getState();
  const to = target(record, delta);
  if (to === null) return;
  const layout = () => useLayout.getState();
  const under = to.place.kind === 'overview' ? to.place.over : to.place;
  // A tab that left the strip in this turn, before the reader dropped its entries: the step shows nothing and moves
  // nothing, and the read that follows the close takes the entry out.
  if (under.kind === 'tab' && !allTabs(layout().main).some((tab) => tab.id === under.id)) return;
  useVisits.setState({ record: { ...record, at: to.at } });
  layout().closeSettings();
  // From one Overview entry to another the Overview stays open, the same panel with the keyboard: only what it is over
  // changes (showing a tab or a page leaves it open). Closed and opened again in one run it would stay mounted, its focus
  // on opening would not run again, and the pane primed for it would keep the keyboard behind it.
  const keepsOverview = to.place.kind === 'overview' && layout().overviewOpen;
  if (layout().overviewOpen && !keepsOverview) layout().setOverviewOpen(false);
  if (under.kind === 'tab') layout().activateTab(under.id);
  else layout().openDestination(under.destination);
  if (to.place.kind === 'overview' && !keepsOverview) {
    if (under.kind === 'tab') focusPaneNow();
    layout().setOverviewOpen(true);
  }
  if (under.kind === 'tab') startHandoff(projectionOf(layout()), to.place.kind === 'tab');
  else endHandoff();
}

function focusPaneNow(): void {
  const region = document.getElementById('region-main');
  if (region && available(region)) focusPaneElement(currentSet(useLayout.getState().main).focusedPane);
}

// The ends by registration (decision 16): `go.back` has a handler while there is an entry before, `go.forward` while
// there is one after, so the menu's items, the palette and the chords are disabled at the ends.
function connectHandlers(): () => void {
  const offs: Partial<Record<'go.back' | 'go.forward', () => void>> = {};
  const sync = () => {
    const { record } = useVisits.getState();
    for (const [id, delta] of [['go.back', -1], ['go.forward', 1]] as const) {
      const want = target(record, delta) !== null;
      if (want && !offs[id]) offs[id] = registerAction(id, () => step(delta));
      if (!want && offs[id]) {
        offs[id]();
        delete offs[id];
      }
    }
  };
  sync();
  const off = useVisits.subscribe(sync);
  return () => {
    off();
    for (const dispose of Object.values(offs)) dispose();
  };
}

// The reader, the step and the two handlers; mounted once from App.tsx after the layout's persistence is connected. The
// record starts with this run: nothing is read before the layout is hydrated, and the first read makes the restored
// place the record's first entry, which opens nothing.
export function connectVisits(): () => void {
  useVisits.setState({ record: EMPTY_RECORD, opened: [] });
  let last: Projection | null = null;
  let pending = false;
  let live = true;
  const take = () => {
    pending = false;
    const state = useLayout.getState();
    if (!live || !state.hydrated) return;
    const next = heldByStep(projectionOf(state));
    if (last === null) {
      const place: Place | null = placeOf(next);
      if (place !== null) useVisits.setState({ record: seen(EMPTY_RECORD, place) });
    } else read(last, next);
    last = next;
  };
  take();
  const offLayout = useLayout.subscribe(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(take);
  });
  const offHandlers = connectHandlers();
  return () => {
    live = false;
    offLayout();
    offHandlers();
    endHandoff();
  };
}
