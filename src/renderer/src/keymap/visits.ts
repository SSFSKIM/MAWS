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
// Settings dialog closes; the Overview is set both ways (finding 5).
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
  if (to.place.kind === 'overview') layout().setOverviewOpen(true);
  else if (to.place.kind === 'tab') focusPaneInFront();
}

// After a step to a tab the pane in front takes the keyboard, as after ⌥⌘] (`stepMainTab`).
function focusPaneInFront(): void {
  requestAnimationFrame(() => {
    const region = document.getElementById('region-main');
    if (region && available(region)) focusPaneElement(currentSet(useLayout.getState().main).focusedPane);
  });
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
    const next = projectionOf(state);
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
  };
}
