// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M3; Interfaces §D; B7): the record
// Back and Forward walk, as a table of cases over `seen`, `refocused`, `gone` and `target`, and the projection it reads.
import { describe, expect, it } from 'vitest';
import { EMPTY_STRIP, type Destination, type Strip, type TabRef } from '@shared/ipc/schema/layout';
import { EMPTY_RECORD, gone, PLACES_MAX, placeOf, projectionOf, refocused, samePlace, seen, target, type Place, type PlaceRecord } from './places';

const tab = (id: string): Place => ({ kind: 'tab', id });
const page = (destination: Destination): Place => ({ kind: 'page', destination });
const customize = (view: 'mine' | 'discover' = 'mine'): Destination => ({ kind: 'customize', view, show: 'all' });
const over = (place: Place): Place => {
  if (place.kind === 'overview') throw new Error('the Overview is over a tab or a page');
  return { kind: 'overview', over: place };
};
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(tab) as [Place, Place, Place, Place];
const P = page(customize());
const record = (entries: Place[], at = entries.length - 1): PlaceRecord => ({ entries, at });
const walk = (...places: Place[]) => places.reduce(seen, EMPTY_RECORD);
// A step as the window takes it: the position moves, then the reader sees the place it moved to.
const step = (from: PlaceRecord, delta: 1 | -1): PlaceRecord => {
  const to = target(from, delta)!;
  return seen({ ...from, at: to.at }, to.place);
};

describe('the record of places', () => {
  it('walks A11: A, B, Customize; back twice, forward once; nothing before the first or after the last', () => {
    const r = walk(A, B, P);
    expect(r).toEqual(record([A, B, P]));
    expect(target(r, -1)).toEqual({ place: B, at: 1 });
    const back = step(r, -1);
    expect(back).toEqual(record([A, B, P], 1));
    const twice = step(back, -1);
    expect(twice).toEqual(record([A, B, P], 0));
    expect(target(twice, -1)).toBeNull();
    const forward = step(twice, 1);
    expect(forward).toEqual(record([A, B, P], 1));
    expect(target(r, 1)).toBeNull();
    expect(target(EMPTY_RECORD, -1)).toBeNull();
    expect(target(EMPTY_RECORD, 1)).toBeNull();
  });

  it('drops what was ahead when a new place is seen after a step back', () => {
    expect(seen(record([A, B, C], 0), D)).toEqual(record([A, D]));
  });

  it('keeps fifty entries: the fifty-first drops the oldest', () => {
    const places = Array.from({ length: PLACES_MAX + 1 }, (_, i) => tab(`t${i}`));
    const r = walk(...places);
    expect(r.entries).toHaveLength(PLACES_MAX);
    expect(r.entries[0]).toEqual(tab('t1'));
    expect(r.entries.at(-1)).toEqual(tab(`t${PLACES_MAX}`));
    expect(r.at).toBe(PLACES_MAX - 1);
  });

  it('rule 1: the place it is at again replaces the entry, so a page’s view follows, and nothing else changes', () => {
    const later = page(customize('discover'));
    expect(seen(record([A, P]), later)).toEqual(record([A, later]));
    expect(seen(record([A, B], 1), B)).toEqual(record([A, B]));
    expect(seen(record([A, B, C], 1), B)).toEqual(record([A, B, C], 1)); // what is ahead stays
  });

  it('rule 2: the Overview closed onto the place it was opened over is a step back, the entry kept ahead', () => {
    expect(seen(record([A, over(A)]), A)).toEqual(record([A, over(A)], 0));
    expect(seen(record([A, P, over(P)]), P)).toEqual(record([A, P, over(P)], 1));
  });

  it('rule 2: a page closed onto the tab before it is a step back; onto another tab, a new visit', () => {
    expect(seen(record([A, P]), A)).toEqual(record([A, P], 0));
    expect(seen(record([A, P]), B)).toEqual(record([A, P, B]));
  });

  it('a tab clicked while on a tab is a new visit, never a step back', () => {
    expect(seen(record([A, B]), A)).toEqual(record([A, B, A]));
    expect(seen(record([A, over(B)]), A)).toEqual(record([A, over(B), A])); // the Overview over another place: no step back either
  });

  it('refocused: the entry it is at becomes the place, and a neighbour that is then the same place becomes one with it', () => {
    expect(refocused(record([A, B]), C)).toEqual(record([A, C]));
    expect(refocused(record([A, B]), A)).toEqual(record([A], 0));
    expect(refocused(record([A, B, C], 1), C)).toEqual(record([A, C], 1));
    expect(refocused(record([A, B, C], 1), D)).toEqual(record([A, D, C], 1)); // nothing ahead leaves
    expect(refocused(EMPTY_RECORD, A)).toEqual(EMPTY_RECORD); // no entry is added
  });

  it('gone: a closed tab’s entries and the Overview entries over it leave, and neighbours that became the same are one', () => {
    expect(gone(record([A, B, over(B), C]), new Set(['b']))).toEqual(record([A, C]));
    expect(gone(record([A, B, A]), new Set(['b']))).toEqual(record([A], 0));
    expect(gone(record([A, B, over(A), A, C], 4), new Set(['b']))).toEqual(record([A, over(A), A, C], 3));
    expect(gone(record([P, A, P]), new Set(['a']))).toEqual(record([P], 0)); // a page by its kind
  });

  it('gone: the position stays on its entry when it survives, else moves to the nearest entry before it that does', () => {
    expect(gone(record([A, B, C], 0), new Set(['b']))).toEqual(record([A, C], 0));
    expect(gone(record([A, B, C], 2), new Set(['c']))).toEqual(record([A, B], 1));
    expect(gone(record([A, B, over(B), C], 2), new Set(['b']))).toEqual(record([A, C], 0));
    expect(gone(record([A, B, C], 0), new Set(['a']))).toEqual(record([B, C], -1)); // none before it
    expect(gone(record([A]), new Set(['a']))).toEqual(EMPTY_RECORD);
    const kept = record([A, B]);
    expect(gone(kept, new Set(['z']))).toEqual(kept); // the control: a tab the record never held takes nothing out
  });

  it('samePlace: a tab by its id, a page by its kind, the Overview by what it is over', () => {
    expect(samePlace(A, tab('a'))).toBe(true);
    expect(samePlace(A, B)).toBe(false);
    expect(samePlace(P, page(customize('discover')))).toBe(true);
    expect(samePlace(P, page({ kind: 'library' }))).toBe(false);
    expect(samePlace(over(A), over(tab('a')))).toBe(true);
    expect(samePlace(over(A), A)).toBe(false);
    expect(samePlace(over(A), over(P))).toBe(false);
  });
});

describe('the navigation projection', () => {
  const session = (id: string): TabRef => ({ id, kind: 'session', appSessionId: `m/${id}` as never, pinned: false });
  const split: Strip = {
    ...EMPTY_STRIP,
    panes: [{ tabs: [session('a'), session('c')], activeTabId: 'a' }, { tabs: [session('b')], activeTabId: 'b' }],
    focusedPane: 1,
  };

  it('reads the page, the Overview, each pane’s tab in front, the focused pane and the strip’s tabs, and nothing else', () => {
    const p = projectionOf({ main: split, destination: null, overviewOpen: false });
    expect(p).toEqual({ page: null, overview: false, fronts: ['a', 'b'], focusedPane: 1, tabs: new Set(['a', 'c', 'b']) });
    expect(projectionOf({ main: EMPTY_STRIP, destination: customize(), overviewOpen: true })).toEqual({ page: customize(), overview: true, fronts: [''], focusedPane: 0, tabs: new Set() });
  });

  it('places the page, else the focused pane’s tab in front, under the Overview when it is open; nothing for an empty pane', () => {
    const at = (layout: Partial<Parameters<typeof projectionOf>[0]>) => placeOf(projectionOf({ main: split, destination: null, overviewOpen: false, ...layout }));
    expect(at({})).toEqual(B);
    expect(at({ overviewOpen: true })).toEqual(over(B));
    expect(at({ destination: customize() })).toEqual(P);
    expect(at({ destination: customize(), overviewOpen: true })).toEqual(over(P));
    expect(at({ main: EMPTY_STRIP })).toBeNull();
    expect(at({ main: EMPTY_STRIP, overviewOpen: true })).toBeNull();
  });
});
