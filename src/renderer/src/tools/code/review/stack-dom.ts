// Reading the drawn stack (UX wave U5b, M4; the execution document's §F): what the stack's model takes from the page, the
// sections' elements, the drawn diff rows of a body and whether a body has settled. Every measure goes through the one
// seam (`reviewLayout`); the rows are told by the attributes `@git-diff-view/react` 0.1.7 puts on them (Decision Log 13
// a): a unified row's gutter `data-line-old-num` and `data-line-new-num`, a split row's `data-line-num` under the side's
// `data-side`. No React here.
import { reviewLayout } from './measure';
import type { StackRow } from './stack-model';

export interface DrawnSection {
  section: HTMLElement;
  header: HTMLElement | null;
  body: HTMLElement | null; // the drawn body, `[data-review-body]`; null for a spacer, a folded section or no body
}

// The scroller's sections by their file's identity, in the stack's order.
export function drawnSections(scroller: HTMLElement): Map<string, DrawnSection> {
  const found = new Map<string, DrawnSection>();
  for (const section of scroller.querySelectorAll<HTMLElement>(':scope > [data-review-file]')) {
    found.set(section.dataset.reviewFile!, {
      section,
      header: section.querySelector<HTMLElement>(':scope > [data-review-file-header]'),
      body: section.querySelector<HTMLElement>(':scope > [data-review-body]'),
    });
  }
  return found;
}

// The lines a row shows, old side first (a unified context row shows both).
function linesOf(row: HTMLElement): { side: 'old' | 'new'; line: number }[] {
  const lines: { side: 'old' | 'new'; line: number }[] = [];
  const push = (side: 'old' | 'new', value: string | undefined) => {
    const line = Number(value);
    if (value && Number.isInteger(line) && !lines.some((known) => known.side === side && known.line === line)) lines.push({ side, line });
  };
  push('old', row.querySelector<HTMLElement>('[data-line-old-num]')?.dataset.lineOldNum);
  push('new', row.querySelector<HTMLElement>('[data-line-new-num]')?.dataset.lineNewNum);
  for (const cell of row.querySelectorAll<HTMLElement>('[data-line-num]')) {
    const side = cell.closest<HTMLElement>('[data-side]')?.dataset.side;
    if (side === 'old' || side === 'new') push(side, cell.dataset.lineNum);
  }
  return lines.sort((a, b) => (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1));
}

// The drawn rows of a body, from its top, in the model's terms; null while the body has not settled (its read or its
// chunk still loading, or the library not yet drawing a block's rows). A row without a line belongs to a line row drawn
// with it, so a place inside it keeps its offset: a hunk's header row to the line under it, a widget or extend row (a
// comment under a line, M5) to the line above it. A body with no diff (a note, "Binary file") has no rows.
export function rowsOf(body: HTMLElement): StackRow[] | null {
  if (body.querySelector('[data-review-loading]')) return null;
  const rows: StackRow[] = [];
  const blocks = body.querySelectorAll<HTMLElement>('[data-review-block]');
  for (let block = 0; block < blocks.length; block++) {
    const tables = blocks[block].querySelectorAll('table');
    if (tables.length === 0) {
      if (blocks[block].querySelector('[role="status"]')) continue; // the block could not be drawn and says so
      return null;
    }
    for (const table of tables) {
      const trs = table.querySelectorAll<HTMLElement>('tr');
      if (trs.length === 0) return null;
      let above: StackRow[] = []; // the line rows last drawn, which a widget or extend row lengthens
      let header: { top: number } | null = null; // a hunk's header waiting for its first line
      for (const tr of trs) {
        const top = reviewLayout.offsetWithin(tr, body);
        const bottom = top + reviewLayout.height(tr);
        const lines = linesOf(tr);
        if (lines.length === 0) {
          if (tr.dataset.state === 'hunk') header = header ?? { top };
          else for (const row of above) row.height = Math.max(row.height, bottom - row.top);
          continue;
        }
        const from = header?.top ?? top;
        header = null;
        above = lines.map(({ side, line }) => ({ block, side, line, top: from, height: bottom - from }));
        rows.push(...above);
      }
    }
  }
  return rows.sort((a, b) => a.top - b.top);
}

// A body whose height is worth keeping (`rowsOf` would answer it): drawn whole, not a Loading line standing in for it, and
// every block drawing its rows or saying why it cannot.
export function settled(body: HTMLElement): boolean {
  if (body.querySelector('[data-review-loading]')) return false;
  for (const block of body.querySelectorAll('[data-review-block]')) if (!block.querySelector('tr') && !block.querySelector('[role="status"]')) return false;
  return true;
}
