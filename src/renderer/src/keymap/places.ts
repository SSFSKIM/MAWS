// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M3; Interfaces §D): the record
// Back and Forward walk. Stub until the build: the tests come first.
import type { Destination } from '@shared/ipc/schema/layout';
import type { LayoutState } from '../stores/layout';

export type Under = { kind: 'tab'; id: string } | { kind: 'page'; destination: Destination };
export type Place = Under | { kind: 'overview'; over: Under };
export interface PlaceRecord { entries: readonly Place[]; at: number }
export const PLACES_MAX = 50;
export const EMPTY_RECORD: PlaceRecord = { entries: [], at: -1 };

export interface Projection {
  page: Destination | null;
  overview: boolean;
  fronts: readonly string[];
  focusedPane: number;
  tabs: ReadonlySet<string>;
}

export function projectionOf(_layout: Pick<LayoutState, 'main' | 'destination' | 'overviewOpen'>): Projection {
  return { page: null, overview: false, fronts: [], focusedPane: 0, tabs: new Set() };
}
export const placeOf = (_p: Projection): Place | null => null;
export const samePlace = (_a: Place, _b: Place): boolean => false;
export const seen = (record: PlaceRecord, _place: Place): PlaceRecord => record;
export const refocused = (record: PlaceRecord, _place: Place): PlaceRecord => record;
export const gone = (record: PlaceRecord, _tabIds: ReadonlySet<string>): PlaceRecord => record;
export const target = (_record: PlaceRecord, _delta: 1 | -1): { place: Place; at: number } | null => null;
