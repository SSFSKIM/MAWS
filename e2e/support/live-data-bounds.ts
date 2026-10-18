// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, M4: owner controls at wide and narrow widths): the
// judgement of whether the source sheet's live query block lies wholly on screen, over measurements the spec takes in
// the page (live-data.ts `unclipped`). Pure and import-free, so test/support/live-data-bounds.test.ts runs it under Node.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BlockMeasure {
  scrollWidth: number; // the block's
  clientWidth: number;
  sheet: Rect; // the sheet the block sits in
  viewport: { width: number; height: number };
  controls: { name: string; box: Rect; scrollWidth: number; clientWidth: number }[];
}

const SLACK = 1; // px of subpixel rounding

/** What keeps the block from being wholly visible: none when every control lies inside the sheet and the window, on
 * both axes, with its text unclipped, and the block does not scroll sideways. */
export function boundsProblems(m: BlockMeasure): string[] {
  const problems: string[] = [];
  if (m.scrollWidth > m.clientWidth + SLACK) problems.push(`the block scrolls sideways (${m.scrollWidth} > ${m.clientWidth})`);
  const right = Math.min(m.sheet.right, m.viewport.width);
  const bottom = Math.min(m.sheet.bottom, m.viewport.height);
  const left = Math.max(m.sheet.left, 0);
  const top = Math.max(m.sheet.top, 0);
  for (const { name, box, scrollWidth, clientWidth } of m.controls) {
    if (box.left < left - SLACK || box.right > right + SLACK) problems.push(`${name} overflows sideways`);
    if (box.top < top - SLACK) problems.push(`${name} rises above the visible sheet`);
    if (box.bottom > bottom + SLACK) problems.push(`${name} falls below the visible sheet`);
    if (scrollWidth > clientWidth + SLACK) problems.push(`${name} clips its text`);
  }
  return problems;
}
