// The ranges of its resulting document a transaction wrote, for the decoration plugins that redraw only what an edit
// touched (the comment display, the code highlighter). Each step's range is mapped through the steps after it, which
// is quadratic in the number of steps: past MAX_MAPPED_STEPS (the binding's rebind of a tab is one transaction with a
// step per block, 1,455 at 200 pages) the answer is null and the caller redraws the whole document, which is linear
// (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, the scale gate).
import type { Transaction } from '@tiptap/pm/state';

export const MAX_MAPPED_STEPS = 64;

/** `[from, to)` in `tr.doc` for every step (a mark or attribute step, whose map is empty, by its own range), or null when there are too many steps to map. */
export function touchedRanges(tr: Transaction): Array<[number, number]> | null {
  if (tr.steps.length > MAX_MAPPED_STEPS) return null;
  const out: Array<[number, number]> = [];
  const size = tr.doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  tr.steps.forEach((step, index) => {
    const rest = tr.mapping.slice(index + 1);
    const push = (start: number, end: number) => {
      const from = clamp(rest.map(start, -1));
      out.push([from, Math.max(from, clamp(rest.map(end, 1)))]);
    };
    let mapped = false;
    tr.mapping.maps[index]!.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      mapped = true;
      push(newStart, newEnd);
    });
    if (mapped) return;
    const { from, to, pos } = step as { from?: unknown; to?: unknown; pos?: unknown };
    if (typeof from === 'number' && typeof to === 'number') push(from, to);
    else if (typeof pos === 'number') push(pos, pos + 1);
  });
  return out;
}
