// Where a closed command output is cut (UX wave U3b, M1; the architect's ruling R19 on the drawn example): at the bottom
// of its second DRAWN line, so the closed state shows two lines whole whatever they hold (a paragraph's two lines at
// 36 px; a heading and the line under it, 4 px apart, at 40 px). Read from the line boxes the drawing measures, at mount
// and when its width changes; an output that draws two lines or fewer is shown whole, with no bound and no "Show more".
export interface LineBox { top: number; bottom: number }

/** The closed bound, from the output's top: the bottom of its second drawn line; null where it draws two lines or fewer. */
export function closedBound(lines: readonly LineBox[]): number | null {
  return lines.length > 2 ? lines[1]!.bottom : null;
}

/** The drawn lines of a set of fragments (a range's client rects): fragments whose middle lies within a line are that line. */
export function lineBoxes(fragments: readonly LineBox[]): LineBox[] {
  const lines: LineBox[] = [];
  for (const fragment of [...fragments].filter((box) => box.bottom > box.top).sort((a, b) => a.top - b.top)) {
    const last = lines.at(-1);
    const middle = (fragment.top + fragment.bottom) / 2;
    if (last !== undefined && middle >= last.top && middle <= last.bottom) last.bottom = Math.max(last.bottom, fragment.bottom);
    else lines.push({ top: fragment.top, bottom: fragment.bottom });
  }
  return lines;
}

/** The first drawn lines of an element's text, from its top edge, up to a third: each text node's line fragments (a
 *  range over a whole element would give its block boxes too, each as tall as its lines); none where a range cannot
 *  measure. */
export function drawnLineBoxes(element: HTMLElement): LineBox[] {
  if (typeof document.createRange !== 'function') return [];
  const origin = element.getBoundingClientRect().top - element.scrollTop;
  const fragments: LineBox[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    if (typeof range.getClientRects !== 'function') return [];
    for (const rect of range.getClientRects()) fragments.push({ top: rect.top - origin, bottom: rect.bottom - origin });
    if (lineBoxes(fragments).length > 2) break; // a third line is all the bound needs to know of; text is drawn in order
  }
  return lineBoxes(fragments);
}
