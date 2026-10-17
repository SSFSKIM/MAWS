// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench"): what
// Insert puts on a board. C's factory (`newElement`, its markup through the dialect's loader) makes every element at a
// slide's sizes; a board is any size, so the design adapts that element before C's validated writer inserts it: the
// text kinds (and a table) drop their slide font size, so the board's screen defaults (board-css.ts: 16 px body, 24 px
// h2) apply; every element fits within 80 % of the board, its aspect kept, centred on the board. C's defaults for decks
// are untouched.
import type { ElementIR } from '../../slides/ir';
import { escText } from '../../slides/serialize';
import { newElement, type NewKind } from '../../slides/writers-elements';

/** How much of the board's width and height a new element may take. */
const FILL = 0.8;
/** A text kind's height at the board's screen type, for centring (C centres its slide-type estimate). */
const SCREEN_HEIGHT: Partial<Record<NewKind, number>> = { text: 24, heading: 30, bullets: 72, numbers: 72 };
const TABLE_ROW = 40;

const pxOf = (v: string | undefined): number | null => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};
const px = (n: number) => `${Math.round(n)}px`;

/** A new element of `kind` for a board of `size` (module header). */
export function boardElement(kind: NewKind, size: { w: number; h: number }): ElementIR {
  const c = { x: size.w / 2, y: size.h / 2 };
  const room = { w: size.w * FILL, h: size.h * FILL };
  const el = newElement(kind, c);
  if (el.tag === 'x-connector') {
    const [x1, y1, x2, y2] = (['x1', 'y1', 'x2', 'y2'] as const).map((k) => Number(el.attrs[k]));
    const f = Math.min(1, room.w / Math.max(Math.abs(x2! - x1!), 1), room.h / Math.max(Math.abs(y2! - y1!), 1));
    const at = (v: number, centre: number) => String(Math.round(centre + (v - centre) * f));
    return { ...el, attrs: { ...el.attrs, x1: at(x1!, c.x), y1: at(y1!, c.y), x2: at(x2!, c.x), y2: at(y2!, c.y) } };
  }
  const style = { ...el.style };
  const left = pxOf(style.left);
  const top = pxOf(style.top);
  if (left === null || top === null) return el; // C places every other kind by left/top px; nothing to adapt otherwise
  // C's factory centres its nominal box on the point it is given: twice the offset is the box
  const nominal = { w: 2 * (c.x - left), h: 2 * (c.y - top) };
  const table = el.tag === 'table';
  const screen = SCREEN_HEIGHT[kind] ?? (table ? TABLE_ROW * el.children.length : undefined);
  if (screen !== undefined) delete style['font-size'];
  const f = Math.min(1, room.w / nominal.w, screen !== undefined ? Infinity : room.h / nominal.h);
  const w = nominal.w * f;
  const h = screen ?? nominal.h * f;
  if (style.width !== undefined) style.width = px(w);
  if (style.height !== undefined) style.height = px(h);
  style.left = px(c.x - Math.round(w) / 2);
  style.top = px(c.y - Math.round(h) / 2);
  return { ...el, style };
}

/**
 * Plain text pasted on a board (the task review's fix wave): C's paste places plain text at a slide's sizes (left 560,
 * width 800, 40 px), off a phone's edge; on a board it is the markup of a text box as Insert makes one there (screen
 * type, fitted, centred), a line per pasted line, for C's validated paste (`pasteElements`) to load and insert.
 */
export function boardTextMarkup(text: string, size: { w: number; h: number }): string {
  const lines = text.trim().split(/\r?\n/);
  const { style } = boardElement('text', size);
  const top = Math.round(size.h / 2 - (lines.length * SCREEN_HEIGHT.text!) / 2);
  return `<p style="position:absolute; left:${style.left}; top:${top}px; width:${style.width}">${lines.map(escText).join('<br>')}</p>`;
}
