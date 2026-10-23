// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5, fix wave 1): what the transform
// layer reads from the drawn slide, in slide px (the 1920×1080 canvas, from the slide's top-left; the stage's zoom never
// enters a measure). Each element's place is one affine map from its own box (border-box px) to the slide: its layout
// position (offsets, which ignore transforms) and every transform on it and on its ancestors, each about its own origin,
// so a scaled, skewed or turned element, or a child of a turned group, is measured as it is drawn. Its host is its
// containing block (the section, or the positioned element a pinned one is placed in), whose own map takes the host's
// px (`left`/`top`, connector coordinates) to the slide; gestures read pointer moves back through its inverse.
import type { SlideCanvas } from '../../canvas';
import { connectorRoute } from '../../glyphs';
import { apply, applyLinear, boundsOf, cornersOf, IDENTITY, invert, multiply, shift, transformMatrix, type Affine, type Box, type FlowAxis, type Pt } from '../../geometry';
import { ROOT } from '../../model';

export interface Measured {
  id: string;
  /** The element's own box, px (before any transform). */
  w: number;
  h: number;
  /** Its layout position in its host's px (left/top as CSS reads them, untransformed) and its size. */
  inHost: Box;
  /** Its box's px → slide px: layout and every transform on it and its ancestors. */
  matrix: Affine;
  /** Its host's px (from the host's padding box) → slide px. */
  hostMatrix: Affine;
  /** Its four corners on the slide, top-left first, clockwise; and their bounds. */
  corners: Pt[];
  bounds: Box;
  /** ROOT (the section) or the id of the positioned element it is placed in. */
  host: string;
  /** A pinned connector: its ends on the slide, and its drawn route through them. */
  points?: [Pt, Pt];
  route?: Pt[];
}

/** The untransformed layout offset of an HTML element from the slide's top-left (offsets summed); null when not laid out. */
function layoutAt(n: HTMLElement, root: HTMLElement): Pt | null {
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
  return cur === root ? { x, y } : null;
}

/** An element's own transform as a matrix about its origin, in its box's px. */
function ownTransform(n: HTMLElement | SVGElement, w: number, h: number): Affine | null {
  const view = n.ownerDocument.defaultView!;
  const computed = view.getComputedStyle(n);
  const value = computed.transform && computed.transform !== 'none' ? computed.transform : n.style.getPropertyValue('transform');
  if (!value || value === 'none') return null;
  // a browser answers matrix(…); without one (a test's DOM) the inline value is read as the dialect writes it
  const three = /^matrix3d\(([^)]*)\)$/.exec(value);
  const m = three ? (() => {
    const v = three[1]!.split(',').map(Number);
    return { a: v[0]!, b: v[1]!, c: v[4]!, d: v[5]!, e: v[12]!, f: v[13]! };
  })() : transformMatrix(value, w, h);
  const origin = /^(-?[\d.]+)px (-?[\d.]+)px/.exec(computed.transformOrigin ?? '');
  const o = origin ? { x: Number(origin[1]), y: Number(origin[2]) } : { x: w / 2, y: h / 2 };
  return multiply(shift(o.x, o.y), multiply(m, shift(-o.x, -o.y)));
}

/** An HTML element's box px → slide px: its layout offset, then every transform from itself out to the slide. */
function matrixOf(n: HTMLElement, root: HTMLElement): Affine | null {
  const at = layoutAt(n, root);
  if (!at) return null;
  let m = shift(at.x, at.y);
  for (let a: HTMLElement | null = n; a && a !== root; a = a.parentElement) {
    const own = ownTransform(a, a.offsetWidth, a.offsetHeight);
    if (!own) continue;
    const pos = layoutAt(a, root);
    if (!pos) return null;
    m = multiply(multiply(shift(pos.x, pos.y), multiply(own, shift(-pos.x, -pos.y))), m);
  }
  return m;
}

/**
 * An outer SVG has no HTML offsets. Chromium resolves its used CSS width/height in px; its client rect supplies the
 * translation only. Recover that translation through its parent's axes, not the rotated/scaled rect's width/height.
 */
function svgLayout(n: HTMLElement, root: HTMLElement, scale: number): { matrix: Affine; at: Pt; w: number; h: number } | null {
  const parent = n.parentElement;
  if (!parent) return null;
  const parentMatrix = parent === root ? IDENTITY : matrixOf(parent, root);
  const parentAt = parent === root ? { x: 0, y: 0 } : layoutAt(parent, root);
  if (!parentMatrix || !parentAt) return null;
  const css = n.ownerDocument.defaultView!.getComputedStyle(n);
  const used = (value: string) => /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : NaN;
  const [w, h] = [used(css.width), used(css.height)];
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const own = ownTransform(n, w, h) ?? IDENTITY;
  const zero = boundsOf(cornersOf(multiply(parentMatrix, own), w, h));
  const rect = n.getBoundingClientRect();
  const origin = root.getBoundingClientRect();
  const local = applyLinear(invert(parentMatrix), { x: (rect.left - origin.left) / scale - zero.x, y: (rect.top - origin.top) / scale - zero.y });
  return { matrix: multiply(parentMatrix, multiply(shift(local.x, local.y), own)), at: { x: parentAt.x + local.x, y: parentAt.y + local.y }, w, h };
}

/** The nearest positioned ancestor inside the slide (what `position:absolute` places against), else the slide. */
export function hostNodeOf(n: HTMLElement, root: HTMLElement): HTMLElement {
  const view = n.ownerDocument.defaultView!;
  for (let p = n.parentElement; p && p !== root; p = p.parentElement) if (view.getComputedStyle(p).position !== 'static') return p;
  return root;
}

/** A container's (or the slide's) box px → slide px, and its padding box's. */
export function containerMatrix(canvas: SlideCanvas, id: string): { box: Affine; padding: Affine } | null {
  const n = id === ROOT ? canvas.root : canvas.node(id);
  if (!n) return null;
  const box = n === canvas.root ? IDENTITY : matrixOf(n, canvas.root);
  return box ? { box, padding: multiply(box, shift(n.clientLeft, n.clientTop)) } : null;
}

const coord = (v: string | null, size: number): number => (v === null ? 0 : v.trim().endsWith('%') ? (Number.parseFloat(v) / 100) * size : Number.parseFloat(v) || 0);

/** One element of the canvas, measured; null when it is not drawn. */
export function measure(canvas: SlideCanvas, id: string, scale: number): Measured | null {
  const n = canvas.node(id);
  const root = canvas.root;
  if (!n || !root.contains(n)) return null;
  const hostNode = hostNodeOf(n, root);
  const hostBox = hostNode === root ? IDENTITY : matrixOf(hostNode, root);
  if (!hostBox) return null;
  const hostMatrix = multiply(hostBox, shift(hostNode.clientLeft, hostNode.clientTop));
  const host = hostNode === root ? ROOT : (hostNode.dataset.eid ?? ROOT);
  const hostAt = hostNode === root ? { x: 0, y: 0 } : layoutAt(hostNode, root);
  if (n.tagName === 'X-CONNECTOR' && n.hasAttribute('x1')) {
    // a pinned connector spans its host: its box is its line's
    const [w, h] = [hostNode.clientWidth, hostNode.clientHeight];
    const local = connectorRoute(n.getAttribute('route') ?? undefined, coord(n.getAttribute('x1'), w), coord(n.getAttribute('y1'), h), coord(n.getAttribute('x2'), w), coord(n.getAttribute('y2'), h));
    const route = local.map(([x, y]) => apply(hostMatrix, { x, y }));
    const bounds = boundsOf(route);
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
      { x: bounds.x, y: bounds.y + bounds.h },
    ];
    return { id, w: bounds.w, h: bounds.h, inHost: bounds, matrix: shift(bounds.x, bounds.y), hostMatrix, corners, bounds, host, points: [route[0]!, route[route.length - 1]!], route };
  }
  let matrix: Affine | null;
  let w: number;
  let h: number;
  let at: Pt | null;
  if (n instanceof n.ownerDocument.defaultView!.HTMLElement) {
    matrix = matrixOf(n, root);
    [w, h] = [n.offsetWidth, n.offsetHeight];
    at = layoutAt(n, root);
  } else {
    const svg = svgLayout(n, root, scale);
    if (!svg) return null;
    ({ matrix, w, h, at } = svg);
  }
  if (!matrix || !hostAt || !at) return null;
  const inHost = { x: at.x - hostAt.x - hostNode.clientLeft, y: at.y - hostAt.y - hostNode.clientTop, w, h };
  const corners = cornersOf(matrix, w, h);
  return { id, w, h, inHost, matrix, hostMatrix, corners, bounds: boundsOf(corners), host };
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

/**
 * How a container lays its flow children: a grid along its rows (the dialect has no `grid-auto-flow`), a flex box along
 * its direction, reversed or not (the final fix wave's B8).
 */
export function flowAxis(canvas: SlideCanvas, parent: string): FlowAxis {
  const n = parent === ROOT ? canvas.root : canvas.node(parent);
  if (!n) return { main: 'y', reverse: false };
  const s = n.ownerDocument.defaultView!.getComputedStyle(n);
  if (s.display === 'grid') return { main: 'x', reverse: false };
  return { main: s.flexDirection.startsWith('row') ? 'x' : 'y', reverse: s.flexDirection.endsWith('-reverse') };
}

/** A child's layout box in its parent's own px (untransformed), for the flow's slots. */
export function boxInParent(canvas: SlideCanvas, parent: string, id: string, scale: number): Box | null {
  const n = canvas.node(id);
  const p = parent === ROOT ? canvas.root : canvas.node(parent);
  if (!n || !p) return null;
  const svg = n instanceof n.ownerDocument.defaultView!.HTMLElement ? null : svgLayout(n, canvas.root, scale);
  const at = svg?.at ?? layoutAt(n, canvas.root);
  const pAt = p === canvas.root ? { x: 0, y: 0 } : layoutAt(p, canvas.root);
  return at && pAt ? { x: at.x - pAt.x, y: at.y - pAt.y, w: svg?.w ?? n.offsetWidth, h: svg?.h ?? n.offsetHeight } : null;
}

/**
 * The element drawn under a point of the window, deepest first as painted (the browser's own hit test), among the
 * canvas's elements; a pinned connector (which takes no pointer) is hit within `slack` px of its line, in its place in
 * the paint order (fix wave 2: before whatever it is drawn over, after whatever is drawn over it; the canvas places its
 * nodes in paint order, so a node later in the document paints over an earlier one).
 */
export function hitIds(canvas: SlideCanvas, client: Pt, slide: Pt, slack: number, connectors: readonly Measured[]): string[] {
  const doc = canvas.root.ownerDocument;
  const stack = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(client.x, client.y) : [];
  const painted: HTMLElement[] = [];
  for (const el of stack) {
    if (!canvas.root.contains(el) || el === canvas.root) continue;
    const owner = (el as HTMLElement).closest?.('[data-eid]') as HTMLElement | null;
    if (owner && !painted.includes(owner)) painted.push(owner);
  }
  for (const c of connectors) {
    const node = canvas.node(c.id);
    if (!node || !c.route || distanceToRoute(slide, c.route) > slack || painted.includes(node)) continue;
    // over a node it follows in the document (unless inside it); under one that follows it
    const at = painted.findIndex((n) => !n.contains(node) && (node.compareDocumentPosition(n) & 2) !== 0);
    painted.splice(at < 0 ? painted.length : at, 0, node);
  }
  return painted.map((n) => n.dataset.eid!);
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
