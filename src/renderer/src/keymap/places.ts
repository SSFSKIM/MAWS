// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M3; Interfaces §D; decisions 12
// to 15): the record Back and Forward walk, pure. A place is a main tab, a page beside the sidebar, or the Overview over
// one of these; a side surface, a file open beside the chat and the Settings dialog are not places (the child's
// l7-shell-09). The record lives in the window's memory for the run and is never stored. Its one reader is
// `visits.ts`, which reads the layout through `projectionOf`, the part of it that navigation is and nothing else.
import type { Destination, Strip } from '@shared/ipc/schema/layout';
import type { LayoutState } from '../stores/layout';

export type Under = { kind: 'tab'; id: string } | { kind: 'page'; destination: Destination };
export type Place = Under | { kind: 'overview'; over: Under };
export interface PlaceRecord { entries: readonly Place[]; at: number } // at: the entry the window is at; -1 while empty
export const PLACES_MAX = 50;
export const EMPTY_RECORD: PlaceRecord = { entries: [], at: -1 };

// What the record reads of a layout, and all it reads (decision 12): a layout write that changes none of these (a side
// tab's parameters, a width, a fold) is no event for the record.
export interface Projection {
  page: Destination | null; // the open page
  overview: boolean;
  fronts: readonly string[]; // each pane's tab in front, by pane; '' for an empty pane
  focusedPane: number;
  tabs: ReadonlySet<string>; // every tab id of the strip
}

const frontOfPane = (pane: Strip['panes'][number]): string => pane.tabs.find((tab) => tab.id === pane.activeTabId)?.id ?? '';

export function projectionOf(layout: Pick<LayoutState, 'main' | 'destination' | 'overviewOpen'>): Projection {
  const { main } = layout;
  return {
    page: layout.destination,
    overview: layout.overviewOpen,
    fronts: main.panes.map(frontOfPane),
    focusedPane: main.focusedPane,
    tabs: new Set(main.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id))),
  };
}

// The page, else the focused pane's tab in front (the strip's own reading of it, `activeTab`); the Overview over that
// when it is open; null for an empty pane in front.
export function placeOf(p: Projection): Place | null {
  const front = p.fronts[p.focusedPane] ?? p.fronts[0] ?? '';
  const under: Under | null = p.page !== null ? { kind: 'page', destination: p.page } : front === '' ? null : { kind: 'tab', id: front };
  if (under === null) return null;
  return p.overview ? { kind: 'overview', over: under } : under;
}

// A tab by its id; a page by its kind (its view and filter are the entry's state, not another place); the Overview by
// what it is over.
export function samePlace(a: Place, b: Place): boolean {
  if (a.kind === 'tab') return b.kind === 'tab' && a.id === b.id;
  if (a.kind === 'page') return b.kind === 'page' && a.destination.kind === b.destination.kind;
  return b.kind === 'overview' && samePlace(a.over, b.over);
}

const replaced = (entries: readonly Place[], index: number, place: Place): Place[] => entries.map((entry, i) => (i === index ? place : entry));

// The first rule that applies (Interfaces §D):
// 1. the entry the record is at: it is replaced (a page's view and filter follow), nothing else changes;
// 2. leaving the Overview, or a page, for the place before it is a step back, the entry kept ahead (P5; card K2's
//    answer: Esc was a step back);
// 3. a new visit: what was ahead leaves, the place is appended and the record is at it; past PLACES_MAX the oldest leaves.
export function seen(record: PlaceRecord, place: Place): PlaceRecord {
  const { entries, at } = record;
  const current = entries[at];
  if (current !== undefined && samePlace(current, place)) return { entries: replaced(entries, at, place), at };
  const before = entries[at - 1];
  const leaving = current !== undefined && ((current.kind === 'overview' && samePlace(current.over, place)) || (current.kind === 'page' && place.kind === 'tab'));
  if (leaving && before !== undefined && samePlace(before, place)) return { entries: replaced(entries, at - 1, place), at: at - 1 };
  const next = [...entries.slice(0, at + 1), place].slice(-PLACES_MAX);
  return { entries: next, at: next.length - 1 };
}

// Entries kept in order, two neighbours that are the same place made one (the later entry's value, the newer), with the
// index each kept entry had before; `at` is the new index of the entry it was on, else of the nearest one before it.
function compact(kept: readonly { place: Place; from: number }[], at: number): PlaceRecord {
  const entries: Place[] = [];
  let next = -1;
  for (const { place, from } of kept) {
    if (entries.length > 0 && samePlace(entries.at(-1)!, place)) entries[entries.length - 1] = place;
    else entries.push(place);
    if (from <= at) next = entries.length - 1;
  }
  return { entries, at: next };
}

// A move between the panes of a split (decision 13): the entry the record is at becomes the tab now in front, so the
// record stands on what the person looks at; a neighbour that is then the same place becomes one with it. No entry is
// added and none ahead leaves.
export function refocused(record: PlaceRecord, place: Place): PlaceRecord {
  if (record.entries[record.at] === undefined) return record;
  return compact(record.entries.map((entry, from) => ({ place: from === record.at ? place : entry, from })), record.at);
}

// Tabs that left the strip take their entries with them, and every Overview entry over one (card K1's answer: the strip
// decides what a close shows, and Back follows what was shown).
export function gone(record: PlaceRecord, tabIds: ReadonlySet<string>): PlaceRecord {
  const leaves = (place: Place) => {
    const under = place.kind === 'overview' ? place.over : place;
    return under.kind === 'tab' && tabIds.has(under.id);
  };
  if (!record.entries.some(leaves)) return record;
  return compact(record.entries.flatMap((place, from) => (leaves(place) ? [] : [{ place, from }])), record.at);
}

export function target(record: PlaceRecord, delta: 1 | -1): { place: Place; at: number } | null {
  const at = record.at + delta;
  const place = record.entries[at];
  return place === undefined || at < 0 ? null : { place, at };
}
