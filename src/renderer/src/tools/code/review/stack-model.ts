// RED SKELETON (replaced in the green commit): today's model, in which every body weighs what it draws whatever its
// fold, and the place is the scroller's one pixel offset, as ReviewView keeps it.
import type { StackPlace } from './view-state';

export interface SectionMeasure { path: string; header: number; body: number | null; lines: number; folded: boolean }
export interface StackLayout { paths: string[]; tops: number[]; bodyTops: number[]; bodies: (number | null)[]; total: number }
export interface StackRow { side: 'old' | 'new'; line: number; top: number }

export const ESTIMATED_ROW_PX = 20;
export const estimatedBody = (lines: number) => Math.max(1, lines) * ESTIMATED_ROW_PX;

export function stackLayout(sections: readonly SectionMeasure[]): StackLayout {
  const layout: StackLayout = { paths: [], tops: [], bodyTops: [], bodies: [], total: 0 };
  for (const s of sections) {
    const body = s.body ?? estimatedBody(s.lines);
    layout.paths.push(s.path);
    layout.tops.push(layout.total);
    layout.bodyTops.push(layout.total + s.header);
    layout.bodies.push(body);
    layout.total += s.header + body;
  }
  return layout;
}

export function placeAt(layout: StackLayout, scrollTop: number, _rowsOf: (index: number) => readonly StackRow[] | null): StackPlace | null {
  return layout.paths.length ? { path: layout.paths[0], row: null, offset: scrollTop } : null;
}

export function topOfPlace(_layout: StackLayout, place: StackPlace, _rowsOf: (index: number) => readonly StackRow[] | null): { top: number; exact: boolean } | null {
  return { top: place.offset, exact: true };
}
