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

// A step's hand-off of the keyboard (M3's task review): from the step until a task after its frame, the pane the step put
// in front is the focused pane, whatever else takes the keyboard in between. The Overview, closing, gives the keyboard
// back to the element that held it when it opened, which can stand in the other pane of a split; the pane it lands in
// becomes the focused pane (`main/Pane.tsx`). The reader does not take that as the person's move: it gives the keyboard
// back to the step's pane. Nothing of the person's can come in between but a key or a press, which ends the hand-off.
let handoff: { place: Place; pane: number } | null = null;
let handoffEnds: (() => void) | null = null;

function endHandoff(): void {
  handoff = null;
  handoffEnds?.();
  handoffEnds = null;
}

function startHandoff(place: Place, pane: number): void {
  endHandoff();
  handoff = { place, pane };
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const byPerson = () => endHandoff();
  frame = requestAnimationFrame(() => {
    timer = setTimeout(endHandoff, 0);
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

// The projection as the step means it, when it differs from it only by a pane that took the keyboard during the
// hand-off; the keyboard and the focused pane are put back on the step's pane.
function heldByStep(next: Projection): Projection {
  if (handoff === null || next.focusedPane === handoff.pane) return next;
  const meant = { ...next, focusedPane: handoff.pane };
  const place = placeOf(meant);
  if (place === null || !samePlace(place, handoff.place)) return next;
  const { pane } = handoff;
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
// to a tab, on the next frame, as after ⌥⌘] (`stepMainTab`); before the Overview opens over a tab, at once, so the
// element the Overview gives the keyboard back to when it closes is in the pane of the place it is over.
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
  if (layout().overviewOpen) layout().setOverviewOpen(false);
  if (under.kind === 'tab') layout().activateTab(under.id);
  else layout().openDestination(under.destination);
  if (under.kind === 'tab') startHandoff(to.place, currentSet(layout().main).focusedPane);
  else endHandoff();
  if (to.place.kind === 'overview') {
    if (under.kind === 'tab') focusPaneNow();
    layout().setOverviewOpen(true);
  } else if (to.place.kind === 'tab') requestAnimationFrame(focusPaneNow);
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
