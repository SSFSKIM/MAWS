// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5): what the transform layer
// reads from the drawn slide. Every box is in slide px (the 1920×1080 canvas, from the slide's top-left), before the
// element's own rotation: CSS offsets ignore transforms, so the stage's zoom never enters a measure. An element's host
// is its containing block (the section, or the positioned div a pinned element is placed in), and its offsets are
// written relative to the host's padding box, as CSS reads `left`/`top`.
import type { SlideCanvas } from '../../canvas';
import { connectorRoute } from '../../glyphs';
import { rotatedBounds, rotationOf, translateOf, type Box, type Pt } from '../../geometry';
import { ROOT } from '../../model';

export interface Measured {
  id: string;
  /** The layout box before transforms, slide px. */
  layout: Box;
  /** The box as drawn before its rotation: the layout box moved by its translate. */
  box: Box;
  rotation: number;
  /** The rotated bounds of `box`. */
  bounds: Box;
  /** The element's containing block: ROOT (the section) or a positioned element's id. */
  host: string;
  /** The host's padding-box origin, slide px: `left`/`top` are measured from it. */
  hostOrigin: Pt;
  /** A pinned connector's ends in slide px, and its drawn route through them. */
  points?: [Pt, Pt];
  route?: Pt[];
}

/** Sums offsets up to the slide: the layout box of an HTML element in slide px (null when it is not laid out). */
function layoutOf(n: HTMLElement, root: HTMLElement, scale: number): Box | null {
  if (!(n instanceof n.ownerDocument.defaultView!.HTMLElement)) {
    // an svg (no offsets): its drawn rect, unscaled
    const r = (n as Element).getBoundingClientRect();
    const o = root.getBoundingClientRect();
    return { x: (r.left - o.left) / scale, y: (r.top - o.top) / scale, w: r.width / scale, h: r.height / scale };
  }
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = n;
  while (cur && cur !== root) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    const parent = cur.offsetParent as HTMLElement | null;
    if (parent) {
      x += parent.clientLeft;
      y += parent.clientTop;
    }
    cur = parent;
  }
  if (cur !== root) return null;
  return { x, y, w: n.offsetWidth, h: n.offsetHeight };
}

/** The nearest positioned ancestor inside the slide (what `position:absolute` places against), else the slide. */
export function hostNodeOf(n: HTMLElement, root: HTMLElement): HTMLElement {
  const view = n.ownerDocument.defaultView!;
  for (let p = n.parentElement; p && p !== root; p = p.parentElement) if (view.getComputedStyle(p).position !== 'static') return p;
  return root;
}

const coord = (v: string | null, size: number): number => (v === null ? 0 : v.trim().endsWith('%') ? (Number.parseFloat(v) / 100) * size : Number.parseFloat(v) || 0);

/** One element of the canvas, measured; null when it is not drawn. */
export function measure(canvas: SlideCanvas, id: string, scale: number): Measured | null {
  const n = canvas.node(id);
  const root = canvas.root;
  if (!n || !root.contains(n)) return null;
  const hostNode = hostNodeOf(n, root);
  const hostLayout = hostNode === root ? { x: 0, y: 0, w: root.offsetWidth || 1920, h: root.offsetHeight || 1080 } : layoutOf(hostNode, root, scale);
  if (!hostLayout) return null;
  const hostOrigin = { x: hostLayout.x + hostNode.clientLeft, y: hostLayout.y + hostNode.clientTop };
  const host = hostNode === root ? ROOT : (hostNode.dataset.eid ?? ROOT);
  if (n.tagName === 'X-CONNECTOR' && n.hasAttribute('x1')) {
    // a pinned connector spans its host: its box is its line's
    const [w, h] = [hostNode.clientWidth, hostNode.clientHeight];
    const pts = connectorRoute(n.getAttribute('route') ?? undefined, coord(n.getAttribute('x1'), w), coord(n.getAttribute('y1'), h), coord(n.getAttribute('x2'), w), coord(n.getAttribute('y2'), h)).map(([x, y]) => ({ x: hostOrigin.x + x, y: hostOrigin.y + y }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    return { id, layout: box, box, rotation: 0, bounds: box, host, hostOrigin, points: [pts[0]!, pts[pts.length - 1]!], route: pts };
  }
  const layout = layoutOf(n, root, scale);
  if (!layout) return null;
  const transform = n.style.getPropertyValue('transform') || undefined;
  const rotation = rotationOf(transform);
  const [dx, dy] = translateOf(transform, layout.w, layout.h);
  const box = { x: layout.x + dx, y: layout.y + dy, w: layout.w, h: layout.h };
  return { id, layout, box, rotation, bounds: rotatedBounds(box, rotation), host, hostOrigin };
}

/** Every drawn element of the canvas by id. */
export function measureAll(canvas: SlideCanvas, ids: Iterable<string>, scale: number): Map<string, Measured> {
  const out = new Map<string, Measured>();
  for (const id of ids) {
    const m = measure(canvas, id, scale);
    if (m) out.set(id, m);
  }
  return out;
}

/** The flex or grid axis a container lays its flow children along. */
export function flowDirection(canvas: SlideCanvas, parent: string): 'row' | 'column' {
  const n = parent === ROOT ? canvas.root : canvas.node(parent);
  if (!n) return 'column';
  const s = n.ownerDocument.defaultView!.getComputedStyle(n);
  if (s.display === 'grid') return 'row';
  return s.flexDirection.startsWith('row') ? 'row' : 'column';
}

/**
 * The element drawn under a point of the window, deepest first as painted (the browser's own hit test), among the
 * canvas's elements; a pinned connector (which takes no pointer) is hit within `slack` px of its line.
 */
export function hitIds(canvas: SlideCanvas, client: Pt, slide: Pt, slack: number, connectors: readonly Measured[]): string[] {
  const near = connectors.filter((c) => c.route && distanceToRoute(slide, c.route) <= slack).map((c) => c.id);
  const doc = canvas.root.ownerDocument;
  const stack = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(client.x, client.y) : [];
  const out: string[] = [...near];
  for (const el of stack) {
    if (!canvas.root.contains(el) || el === canvas.root) continue;
    const owner = (el as HTMLElement).closest?.('[data-eid]') as HTMLElement | null;
    const id = owner?.dataset.eid;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function distanceToRoute(p: Pt, route: Pt[]): number {
  let best = route.length ? Math.hypot(p.x - route[0]!.x, p.y - route[0]!.y) : Infinity;
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1]!, route[i]!];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
