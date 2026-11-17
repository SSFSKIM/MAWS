// A folder that does not fit is cut at its start (UX wave U6b-3a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md,
// decision 8 and M2 decision 9; Decision Log 6, notes 10 and 11; Decision Log 8): the part nearest the file stays. The
// cut is made on the text by measured widths, never by a writing-direction trick of CSS, which reorders a dot or a slash
// at the cut. U6b-3b's result rows use the same function.
export type Measure = (text: string) => number;
type RawMeasure = (font: string, text: string) => number;

const ELLIPSIS = '…';
const LEAST = '00'; // a room of two characters of the font, below which the folder is not drawn

// The folder as a row draws it in `room` (in the units `measure` answers): whole when it fits; else '…' and the longest
// end of it that fits, begun at a segment's start where one fits and otherwise at any character; null when two
// characters of the font do not fit, or nothing does.
export function folderFromEnd(folder: string, room: number, measure: Measure): string | null {
  if (measure(LEAST) > room) return null; // first: a narrow folder that fits a smaller room is still not drawn there
  if (measure(folder) <= room) return folder;
  const fits = (start: number) => measure(ELLIPSIS + folder.slice(start)) <= room;
  let last = 0; // the start of the folder's last segment
  for (let start = 1; start < folder.length; start += 1) {
    if (folder[start - 1] !== '/') continue;
    if (fits(start)) return ELLIPSIS + folder.slice(start);
    last = start;
  }
  // Inside the last segment: the smallest start that fits, by halving (a shorter end is never wider).
  let low = last + 1;
  let high = folder.length - 1;
  if (low > high || !fits(high)) return null;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid + 1;
  }
  return ELLIPSIS + folder.slice(low);
}

// The canvas a font is measured with; none where the page has no 2D canvas (a test's DOM), where every width is 0.
let context: OffscreenCanvasRenderingContext2D | null | undefined;
function canvasMeasure(font: string, text: string): number {
  if (context === undefined) context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (context === null) return 0;
  context.font = font;
  return context.measureText(text).width;
}

let raw: RawMeasure = canvasMeasure;

// Decision Log 8: each distinct string is measured once per font, and only when a drawn row asks for it. Past
// WIDTHS_MAX strings of one font (a run that has drawn the folders of many repositories) that font's widths are
// forgotten together and measured again as rows ask.
const WIDTHS_MAX = 20_000;
const widths = new Map<string, Map<string, number>>(); // by font, then by string

// A measure in `font` (a CSS font shorthand).
export function measureIn(font: string): Measure {
  return (text) => {
    let known = widths.get(font);
    if (known === undefined) widths.set(font, (known = new Map()));
    let width = known.get(text);
    if (width === undefined) {
      if (known.size >= WIDTHS_MAX) known.clear();
      width = raw(font, text);
      known.set(text, width);
    }
    return width;
  };
}

/** Tests only: measure with `next` (null: the canvas again), every width measured before forgotten. */
export function measureWith(next: RawMeasure | null): void {
  raw = next ?? canvasMeasure;
  widths.clear();
}
