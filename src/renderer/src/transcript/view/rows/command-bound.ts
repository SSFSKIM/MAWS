// Where a closed command output is cut (UX wave U3b, M1; the architect's ruling R19 on the drawn example, and the branch
// panel's finding 3): closed, an output is never drawn taller than its bound, whatever it holds and whenever it finishes
// loading. Where its first two drawn lines are text lines, the bound is the bottom of the second, so the closed state
// shows two lines whole whatever they hold (a paragraph's two lines at about 36 px; a heading and the line under it, 4 px
// apart, at about 40 px). Where what it draws is taller than that without being text lines (an image, a rule, a table's
// frame before its text), the bound is two lines of the output's own type. Read from the line boxes and the whole height
// the drawing measures, at mount and on any change of its size; an output no taller than its bound is shown whole, with
// no bound and no "Show more". A range measures a line's text by the font's box, shorter than the line: each fragment is
// grown by its half-leading to the line box of its own element's type before its line is read.
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

/** A text fragment as a range measures it: its client rect, which is the font's box (14.5 px of 12 px type), not the
 *  line's, and the line height of the type of the element that holds its text. */
export interface TextFragment extends LineBox { lineHeight: number }

/** The drawn lines of a set of text fragments: each grown to its line box by its half-leading, (line height − its
 *  height) / 2 above and below (none where its line is no taller than it), then grouped into lines. */
export function textLines(fragments: readonly TextFragment[]): LineBox[] {
  return lineBoxes(fragments.filter((box) => box.bottom > box.top).map(({ top, bottom, lineHeight }) => {
    const leading = Math.max(0, (lineHeight - (bottom - top)) / 2);
    return { top: top - leading, bottom: bottom + leading };
  }));
}

/** One line of an element's own type, in pixels: its computed line height (a font's normal line where none is set). */
export function lineHeightOf(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 0;
}

/** The first drawn lines of an element's text, from its top edge, up to a third: each text node's line fragments (a
 *  range over a whole element would give its block boxes too, each as tall as its lines), each grown to a line of its
 *  parent element's type; none where a range cannot measure. */
export function drawnLineBoxes(element: HTMLElement): LineBox[] {
  if (typeof document.createRange !== 'function') return [];
  const origin = element.getBoundingClientRect().top - element.scrollTop;
  const fragments: TextFragment[] = [];
  const lineHeights = new Map<HTMLElement, number>(); // read once per element
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    if (typeof range.getClientRects !== 'function') return [];
    const parent = node.parentElement ?? element;
    let lineHeight = lineHeights.get(parent);
    if (lineHeight === undefined) lineHeights.set(parent, (lineHeight = lineHeightOf(parent)));
    for (const rect of range.getClientRects()) fragments.push({ top: rect.top - origin, bottom: rect.bottom - origin, lineHeight });
    if (textLines(fragments).length > 2) break; // a third line is all the bound needs to know of; text is drawn in order
  }
  return textLines(fragments);
}
