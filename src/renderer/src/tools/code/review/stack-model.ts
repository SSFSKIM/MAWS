// The stack's pure model (UX wave U5b, M2; the execution document's Interfaces §F and decisions 6 to 9): every changed
// file of a scope is a section, a header over a body, in the list's order. Here: what each section weighs, the band of
// sections whose bodies are drawn, the place the person is reading (a file, a diff row and the pixels below it, so
// that it survives any change of the heights around it), the fold rule and the order of the hunks across files. The
// model takes heights as numbers and never measures; the stack feeds it from its scroller and its bodies'
// ResizeObservers (M4). No React and no DOM here.
import { hunkAnchor, tooLarge } from './review-model';
import type { StackPlace } from './view-state';

// ---- what a section weighs -------------------------------------------------------------------------------------------

export interface SectionMeasure {
  path: string; // the file's identity in its scope (ReviewFile.path)
  header: number; // the header's height
  body: number | null; // the body's last measured height; null before a first measure
  lines: number; // the body's lines (`bodyLines`), which an estimate is made from
  folded: boolean; // `isFolded`'s answer
}

export interface StackLayout {
  paths: string[];
  tops: number[]; // each section's top in the scroller
  bodyTops: number[]; // each section's body's top: the section's top and its header
  bodies: (number | null)[]; // each body's height in the layout, measured or estimated; null for a folded section, which has none
  total: number; // the scroller's content height
}

// One diff row as the stack measures it inside a drawn body (M4 reads them from the library's `data-line-*` attributes,
// within each `[data-review-block]`). A row is told by its block as well as its side and line: Last turn draws one
// block per edit, and two blocks can hold the same line.
export interface StackRow {
  block: number; // the diff block it is drawn in (one per edit in Last turn, else 0)
  side: 'old' | 'new';
  line: number;
  top: number; // from the body's top
  height: number; // its current height, which bounds an offset restored into it
}

// The diff view's row at its 12 px font (`diffViewFontSize` in the body), for a body not measured yet.
export const ESTIMATED_ROW_PX = 20;

// A body not measured yet, by its line count alone; at least one row ("Binary file", a note, Loading).
export const estimatedBody = (lines: number): number => Math.max(1, lines) * ESTIMATED_ROW_PX;

// A body's lines: its hunks' when they are loaded (each `@@` header a row, as the library draws it where a gap precedes
// a hunk), else its counts' (a scope past its cap before the file is read).
export function bodyLines(file: { hunks: readonly string[] | null; added: number; removed: number }): number {
  if (file.hunks === null) return file.added + file.removed;
  let lines = 0;
  for (const hunk of file.hunks) lines += hunk.split('\n').length;
  return lines;
}

// Three cases and no fourth (§F): an unfolded body weighs its measure, or its estimate before a first one, whether it
// is drawn or a spacer; a folded section weighs its header alone.
export function stackLayout(sections: readonly SectionMeasure[]): StackLayout {
  const layout: StackLayout = { paths: [], tops: [], bodyTops: [], bodies: [], total: 0 };
  for (const section of sections) {
    const body = section.folded ? null : (section.body ?? estimatedBody(section.lines));
    layout.paths.push(section.path);
    layout.tops.push(layout.total);
    layout.bodyTops.push(layout.total + section.header);
    layout.bodies.push(body);
    layout.total += section.header + (body ?? 0);
  }
  return layout;
}

// ---- the band ----------------------------------------------------------------------------------------------------------

export const BAND_VIEWPORTS = 2; // above and below the viewport

// The unfolded sections whose bodies intersect the viewport extended by two viewports above and below it: the bodies
// the stack draws. `tops` and `heights` are the bodies' (`StackLayout.bodyTops`, `.bodies`); a null height is a folded
// section, which is never in the band.
export function bandOf(tops: readonly number[], heights: readonly (number | null)[], scrollTop: number, viewport: number): ReadonlySet<number> {
  const from = scrollTop - BAND_VIEWPORTS * viewport;
  const to = scrollTop + viewport + BAND_VIEWPORTS * viewport;
  const band = new Set<number>();
  for (let i = 0; i < tops.length; i++) {
    const height = heights[i];
    if (height !== null && tops[i] <= to && tops[i] + height >= from) band.add(i);
  }
  return band;
}

// ---- the place ---------------------------------------------------------------------------------------------------------

// The drawn rows of a section's body, in order from its top; null where the body is not drawn (folded, outside the
// band, or not laid out yet).
export type RowsOf = (index: number) => readonly StackRow[] | null;

// The section holding `y`: the last whose top is at or above it.
function sectionAt(layout: StackLayout, y: number): number {
  let at = 0;
  for (let i = 1; i < layout.tops.length && layout.tops[i] <= y; i++) at = i;
  return at;
}

// Where the person is reading (§F, the live place): the section at the scroller's top edge, the diff row at that edge
// and the pixels below that row's top; with no row there (a folded or undrawn body, or the edge in the header) the
// offset is from the section's top. Null for an empty stack.
export function placeAt(layout: StackLayout, scrollTop: number, rowsOf: RowsOf): StackPlace | null {
  if (layout.paths.length === 0) return null;
  const index = sectionAt(layout, scrollTop);
  const path = layout.paths[index];
  const body = layout.bodies[index];
  const inBody = scrollTop - layout.bodyTops[index];
  const rows = body !== null && inBody >= 0 && inBody < body ? rowsOf(index) : null;
  let row: StackRow | null = null;
  for (const candidate of rows ?? []) {
    if (candidate.top > inBody) break;
    row = candidate;
  }
  if (row === null) return { path, row: null, offset: scrollTop - layout.tops[index] };
  return { path, row: { block: row.block, side: row.side, line: row.line }, offset: inBody - row.top };
}

// The scroller's top that puts a place at the top edge again, under whatever heights the layout now has. `exact` is
// false while the place's row cannot be found yet because its body is not drawn: the stack then stands at the
// section's top and applies the place again once the body draws (a reveal not reached yet). A row gone from a drawn
// body, or a section folded since, falls back to the section's top. The offset into the row is bounded by the row's
// current height, so a row that shrank (a zoom out, a wider wrapped diff) keeps the place in it. Null when the stack
// no longer lists the file.
export function topOfPlace(layout: StackLayout, place: StackPlace, rowsOf: RowsOf): { top: number; exact: boolean } | null {
  const index = layout.paths.indexOf(place.path);
  if (index === -1) return null;
  const top = layout.tops[index];
  const body = layout.bodies[index];
  if (place.row === null) return { top: top + Math.min(place.offset, layout.bodyTops[index] - top + (body ?? 0)), exact: true };
  if (body === null) return { top, exact: true };
  const rows = rowsOf(index);
  if (rows === null) return { top, exact: false };
  const { block, side, line } = place.row;
  const row = rows.find((candidate) => candidate.block === block && candidate.side === side && candidate.line === line);
  if (!row) return { top, exact: true };
  return { top: layout.bodyTops[index] + row.top + Math.min(place.offset, Math.max(0, row.height - 1)), exact: true };
}

// ---- folding -----------------------------------------------------------------------------------------------------------

export type FoldChoice = 'open' | 'closed';

// The fold rule (§F, decision 9): the person's own choice, else folded when marked Viewed (a mark that still holds),
// else unfolded when a mark dropped because the file changed (past the cap too: the change is what the person has not
// seen), else folded when the scope is past its cap.
export function isFolded(input: { choice: FoldChoice | undefined; viewed: boolean; dropped: boolean; pastCap: boolean }): boolean {
  if (input.choice !== undefined) return input.choice === 'closed';
  if (input.viewed) return true;
  return !input.dropped && input.pastCap;
}

// "Collapse all" reads "Expand all" while every file is folded (and then sets `open` on every file).
export const everyFolded = (folded: readonly boolean[]): boolean => folded.length > 0 && folded.every(Boolean);

// ---- the hunk order ----------------------------------------------------------------------------------------------------

export interface StackHunk {
  path: string;
  index: number; // the hunk's index in its file, across the file's blocks
  block: number; // the diff block it is drawn in (one per edit in Last turn, else one)
  anchor: { side: 'old' | 'new'; line: number }; // the row it opens at (`hunkAnchor`)
}

// What "Showing hunk n of m" counts and ↑ and ↓ move through (§F): the hunks of every loaded file that is not marked
// Viewed and not past the per-file cap, in stack order, crossing files. A folded file's hunks count (a jump unfolds it);
// a file whose hunks are not read yet (null) has none.
export function hunkOrder(files: readonly { path: string; hunks: readonly string[] | null; blocks: readonly number[]; viewed: boolean }[]): StackHunk[] {
  const order: StackHunk[] = [];
  for (const file of files) {
    if (file.hunks === null || file.viewed || tooLarge({ hunks: file.hunks })) continue;
    let block = 0;
    let end = file.blocks[0] ?? file.hunks.length;
    file.hunks.forEach((hunk, index) => {
      while (index >= end && block < file.blocks.length - 1) end += file.blocks[++block];
      order.push({ path: file.path, index, block, anchor: hunkAnchor(hunk) });
    });
  }
  return order;
}

// Where a hunk jump's reveal goes (§F): the hunk's first row, in its own block, at the top edge.
export const hunkPlace = (hunk: StackHunk): StackPlace => ({ path: hunk.path, row: { block: hunk.block, ...hunk.anchor }, offset: 0 });
