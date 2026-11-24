// The host's hover around a figure (P3-E2 M3; parent §2 "Views": hover adds event handlers around the output, never a
// script inside it). A discrete mark carries its value in `data-tip` and is its own hit target; the points of a line,
// an area or a scatter sit in the figure's one `data-hover="nearest"` layer, searched here for the point nearest the
// pointer (within a reach of 32 figure units), so every point has a value, the last of thousands included. The tip is
// text (`textContent`: labels are the data's), shown beside the pointer, whole inside the frame's visible box (E2's
// Decision Log 21), and hidden when it leaves; the same values are
// in the source sheet for the keyboard and a screen reader.
const REACH = 32;
const OFFSET = 12; // px between the pointer and its tip

interface Layer {
  xy: Float64Array;
  tips: string[];
}

function layerOf(svg: SVGSVGElement): Layer | null {
  const g = svg.querySelector('[data-hover="nearest"]');
  if (!g) return null;
  const pairs = (g.getAttribute('data-xy') ?? '').split(' ');
  const xy = new Float64Array(pairs.length * 2);
  pairs.forEach((pair, i) => {
    const [x, y] = pair.split(',');
    xy[i * 2] = Number(x);
    xy[i * 2 + 1] = Number(y);
  });
  return { xy, tips: (g.getAttribute('data-tips') ?? '').split('\n') };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** An element's client box (inside its borders, without its scrollbars) in window coordinates. */
function clientBox(el: Element): Box {
  const box = el.getBoundingClientRect();
  const left = box.left + el.clientLeft;
  const top = box.top + el.clientTop;
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
}

const CLIPS = new Set(['hidden', 'clip', 'scroll', 'auto']);

/** What can be seen of `frame`, in window coordinates: its client box, cut on each axis by every ancestor that clips
 * that axis, and by the window. */
function visibleBox(frame: HTMLElement): Box {
  return seenWithin(frame, clientBox(frame));
}

/** `box` (window coordinates) cut on each axis by every ancestor of `el` that clips that axis, and by the window. */
function seenWithin(el: Element, box: Box): Box {
  const seen = { ...box };
  const view = el.ownerDocument.defaultView;
  for (let ancestor = el.parentElement; ancestor && view; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    const clipsX = CLIPS.has(style.overflowX);
    const clipsY = CLIPS.has(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const clip = clientBox(ancestor);
    if (clipsX) [seen.left, seen.right] = [Math.max(seen.left, clip.left), Math.min(seen.right, clip.right)];
    if (clipsY) [seen.top, seen.bottom] = [Math.max(seen.top, clip.top), Math.min(seen.bottom, clip.bottom)];
  }
  if (view) [seen.left, seen.top, seen.right, seen.bottom] = [Math.max(seen.left, 0), Math.max(seen.top, 0), Math.min(seen.right, view.innerWidth), Math.min(seen.bottom, view.innerHeight)];
  return seen;
}

/** The widest a mark's note is drawn (sheet.css's `.dash-warning::after`, its `--dash-note-max`'s fallback). */
export const NOTE_MAX_PX = 320;
/** The room a mark's note leaves between itself and the edge of what can be seen. */
export const NOTE_INSET_PX = 8;
/** The note's distance from its mark (sheet.css's `var(--space)` between them). */
export const NOTE_GAP_PX = 4;

/**
 * Where a ⚠ mark's note opens (the word cut, G598, G603; sheet.css draws it): from the mark's start rightward, as at rest,
 * while its widest fits in what can be seen around the mark (the editor's scroller, the window); otherwise from the
 * mark's end leftward when that side has more room; its width capped to the room on the side it opens to. Under the
 * mark while its height (read as drawn at that width) fits below it; otherwise above it when that side has more room. So
 * no part of it is clipped (the shared Tip's flip and shift, for a note drawn by CSS). Called as the mark is pointed at
 * or focused, before the note shows.
 */
export function placeNote(mark: HTMLElement): void {
  const seen = seenWithin(mark, { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
  const box = mark.getBoundingClientRect();
  const after = seen.right - box.left - NOTE_INSET_PX;
  const before = box.right - seen.left - NOTE_INSET_PX;
  const leftward = after < NOTE_MAX_PX && before > after;
  if (leftward) mark.dataset.noteSide = 'end';
  else delete mark.dataset.noteSide;
  mark.style.setProperty('--dash-note-max', `${Math.max(0, Math.floor(Math.min(NOTE_MAX_PX, leftward ? before : after)))}px`);
  // the note is laid out at rest (hidden, not undrawn), so its height at the width just set can be read
  const height = Number.parseFloat(mark.ownerDocument.defaultView?.getComputedStyle(mark, '::after').height ?? '');
  const below = seen.bottom - box.bottom - NOTE_INSET_PX;
  const above = box.top - seen.top - NOTE_INSET_PX;
  if (Number.isFinite(height) && below < height + NOTE_GAP_PX && above > below) mark.dataset.noteAbove = '';
  else delete mark.dataset.noteAbove;
}

/** Where a tip `extent` long starts on one axis: `OFFSET` after the pointer, else before it where that would cross `hi`,
 * clamped into `lo..hi` (at `lo` when it is longer than the room). */
function place(pointer: number, extent: number, lo: number, hi: number): number {
  const after = pointer + OFFSET;
  const at = after + extent <= hi ? after : pointer - OFFSET - extent;
  return Math.max(lo, Math.min(at, hi - extent));
}

/** Hover over the figure in `frame`, its tip drawn in `tip`; answers its removal. */
export function attachHover(frame: HTMLElement, tip: HTMLElement): () => void {
  let layer: Layer | null | undefined; // read on first use after each drawing
  let drawn: SVGSVGElement | null = null;
  const hide = () => {
    tip.hidden = true;
  };
  // The frame is the tip's positioning ancestor and also the figure's scroller (a figure wider than its column scrolls
  // in it). What the owner can see of it is its client box cut by every clipping ancestor (the editor's scroller) and
  // the window. The tip is measured once at its natural size, which is then fixed (a box placed near its containing
  // block's edge would otherwise shrink to fit and rewrap); placed in that visible box beside the pointer, on its other
  // side where it would cross the right or bottom edge, clamped inside; and written in the frame's content coordinates
  // (its scroll added), where an absolutely placed child of a scroller lives.
  const show = (text: string, event: PointerEvent) => {
    tip.textContent = text;
    tip.hidden = false;
    tip.style.width = '';
    tip.style.left = '0px'; // measured at the frame's start, where the whole width is free
    tip.style.top = '0px';
    const size = tip.getBoundingClientRect();
    tip.style.boxSizing = 'border-box';
    tip.style.width = `${size.width}px`;
    const box = frame.getBoundingClientRect();
    const seen = visibleBox(frame);
    const x = place(event.clientX, size.width, seen.left, seen.right);
    const y = place(event.clientY, size.height, seen.top, seen.bottom);
    tip.style.left = `${x - box.left - frame.clientLeft + frame.scrollLeft}px`;
    tip.style.top = `${y - box.top - frame.clientTop + frame.scrollTop}px`;
  };
  const move = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const svg = frame.querySelector('svg');
    if (!svg || !target) return hide();
    const mark = target.closest('[data-tip]');
    if (mark && svg.contains(mark)) return show(mark.getAttribute('data-tip') ?? '', event);
    if (svg !== drawn) {
      drawn = svg;
      layer = undefined;
    }
    if (layer === undefined) layer = layerOf(svg);
    if (!layer || layer.tips.length === 0) return hide();
    // the pointer in the figure's own units (the figure scales to its column)
    const box = svg.getBoundingClientRect();
    const scale = box.width > 0 ? Number(svg.getAttribute('width')) / box.width : 1;
    const x = (event.clientX - box.left) * scale;
    const y = (event.clientY - box.top) * scale;
    let best = -1;
    let bestD = REACH * REACH;
    for (let i = 0; i < layer.tips.length; i += 1) {
      const dx = layer.xy[i * 2] - x;
      const dy = layer.xy[i * 2 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return hide();
    show(layer.tips[best], event);
  };
  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerleave', hide);
  // a figure the pointer left through its own element (the SVG's pointerleave does not bubble)
  const leave = (event: Event) => {
    if (event.target instanceof SVGSVGElement) hide();
  };
  frame.addEventListener('pointerleave', leave, true);
  return () => {
    frame.removeEventListener('pointermove', move);
    frame.removeEventListener('pointerleave', hide);
    frame.removeEventListener('pointerleave', leave, true);
  };
}
