import type { Doc } from '../../../yjs';
import type { DeckThread } from '../../threads';
import { readFlat } from '../../model';

/** Only ambiguous quotes need another identity cue; use the element's stable place, never its internal id. */
export function targetNumber(doc: Doc, threads: readonly DeckThread[], target: DeckThread): number | undefined {
  if (!threads.some((t) => t.slideId === target.slideId && t.elementId !== target.elementId && t.quote === target.quote)) return undefined;
  const index = readFlat(doc, target.slideId, false).findIndex((e) => e.id === target.elementId);
  return index < 0 ? undefined : index + 1;
}

/** Keep 28px hit-target spacing; on the bottom edge stack upward, then into an adjacent column. */
export function separatePins(points: readonly { x: number; y: number }[], height: number): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [];
  for (const point of points) {
    const clashes = (p: { x: number; y: number }) => placed.some((q) => Math.abs(p.x - q.x) < 28 && Math.abs(p.y - q.y) < 28);
    let next = { ...point };
    for (let offset = 28; clashes(next); offset += 28) {
      const rows = Math.max(1, Math.floor(height / 28));
      const row = (offset / 28) % rows;
      const column = Math.floor(offset / 28 / rows);
      next = { x: point.x - column * 28, y: point.y + row * 28 <= height ? point.y + row * 28 : point.y - (rows - row) * 28 };
    }
    placed.push(next);
  }
  return placed;
}
