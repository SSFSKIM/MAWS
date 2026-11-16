// Where a closed command output is cut (UX wave U3b, M1; the architect's ruling R19 on the drawn example, and the branch
// panel's finding 3): closed, an output is never drawn taller than its bound, whatever it holds and whenever it finishes
// loading. Where its first two drawn lines are text lines, the bound is the bottom of the second, so the closed state
// shows two lines whole whatever they hold (a paragraph's two lines at 36 px; a heading and the line under it, 4 px
// apart, at 40 px). Where what it draws is taller than that without being text lines (an image, a rule, a table's frame
// before its text), the bound is two lines of the output's own type. Read from the line boxes and the whole height the
// drawing measures, at mount and on any change of its size; an output no taller than its bound is shown whole, with no
// bound and no "Show more".
export interface LineBox { top: number; bottom: number }

/**
 * The closed bound, from the output's top, or null where it is shown whole. `lines` are its first drawn text lines,
 * `height` the whole height it draws, `lineHeight` its type's. The first two lines count as its first two drawn lines
 * when nothing taller than a line is drawn before or between them; otherwise the bound is two lines of its type. It is
 * cut where it holds a third text line or draws more than half a line past the bound (a frame's padding and border are
 * not cut away).
 */
export function closedBound(lines: readonly LineBox[], height: number, lineHeight: number): number | null {
  const [first, second] = lines;
  const textFirst = first !== undefined && second !== undefined && first.top <= lineHeight && second.top - first.bottom <= lineHeight;
  const bound = textFirst ? second.bottom : 2 * lineHeight;
  return lines.length > 2 || height > bound + lineHeight / 2 ? bound : null;
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

/** One line of an element's own type, in pixels: its computed line height (a font's normal line where none is set). */
export function lineHeightOf(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 0;
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
