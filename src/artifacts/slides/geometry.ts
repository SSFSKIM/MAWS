// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5): the transform layer's math,
// portable and DOM-free, in slide px (the 1920×1080 canvas). A box is an element's layout box before its rotation (CSS
// turns it about its centre); every gesture reads boxes the overlay measured and returns the boxes or values to write.
// Written for this model with react-moveable's MIT approach to rotated resizing in mind (the parent's Decision Log 15).
//
// - Rotated boxes: corners, bounds, hit tests in the element's own frame.
// - Transforms: the rotation read and composed with the element's other transforms in the dialect's order
//   (translate, rotate, scale, skew; each once), a translate read in px.
// - Resize from any of eight handles: the pointer's movement taken into the element's own axes, Shift keeping the
//   aspect, Alt from the centre, the opposite edge or corner held where it is on the slide.
// - Rotate from the handle: the angle about the centre, Shift by 15°.
// - Snapping: the slide's edges and centre, the 128 px margins, siblings' edges and centres and equal gaps.
// - Pins: a right/bottom (or %, calc) pin rewritten to left/top px where the element is, so a drag can move it.
// - Flow: the slot a dragged flow child would drop into, along its parent's axis.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const MARGIN = 128;
/** Snapping reaches this far in screen px (divided by the zoom for slide px). */
export const SNAP_SCREEN_PX = 6;

const round2 = (n: number) => Math.round(n * 100) / 100;
export const px = (n: number): string => `${round2(n)}px`;

// ---------------------------------------------------------------- rotated boxes

export const centreOf = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** `v` turned by `deg` (clockwise on the slide, whose y runs down). */
export function turn(v: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** The four corners on the slide, top-left, top-right, bottom-right, bottom-left of the box before it turned. */
export function corners(b: Box, deg: number): Pt[] {
  const c = centreOf(b);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ].map((p) => {
    const v = turn({ x: p.x - c.x, y: p.y - c.y }, deg);
    return { x: c.x + v.x, y: c.y + v.y };
  });
}

/** The axis-aligned bounds of a turned box. */
export function rotatedBounds(b: Box, deg: number): Box {
  if (deg % 360 === 0) return { ...b };
  const ps = corners(b, deg);
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Whether `p` falls inside the box as it is drawn turned. */
export function hitTest(b: Box, deg: number, p: Pt): boolean {
  const c = centreOf(b);
  const v = turn({ x: p.x - c.x, y: p.y - c.y }, -deg);
  return Math.abs(v.x) <= b.w / 2 && Math.abs(v.y) <= b.h / 2;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The smallest box holding every box. */
export function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

// ---------------------------------------------------------------- transforms

interface Fn {
  /** As written (the loader writes lowercase, `skewx`; CSS also takes `skewX`). */
  name: string;
  /** The name lowercased: what parsing, dispatch and ordering read (fix wave 2). */
  key: string;
  args: string;
}
/** The transform's functions in order (`name(args)`), parentheses respected. */
function fnsOf(value: string | undefined): Fn[] {
  const out: Fn[] = [];
  if (!value) return out;
  const re = /([a-zA-Z]+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < value.length && depth > 0; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
    }
    out.push({ name: m[1]!, key: m[1]!.toLowerCase(), args: value.slice(re.lastIndex, i - 1).trim() });
    re.lastIndex = i;
  }
  return out;
}
const ORDER = ['translate', 'translatex', 'translatey', 'rotate', 'scale', 'skew', 'skewx', 'skewy'];

function angleDeg(text: string): number {
  const m = /^(-?[\d.]+(?:e[+-]?\d+)?)(deg|turn|rad|grad)?$/i.exec(text.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  switch ((m[2] ?? 'deg').toLowerCase()) {
    case 'turn':
      return n * 360;
    case 'rad':
      return (n * 180) / Math.PI;
    case 'grad':
      return n * 0.9;
    default:
      return n;
  }
}
/** Into (-180, 180]. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Object.is(d, -0) ? 0 : d;
}

/** The element's rotation in degrees (0 without a `rotate()`). */
export function rotationOf(transform: string | undefined): number {
  const r = fnsOf(transform).find((f) => f.key === 'rotate');
  return r ? angleDeg(r.args) : 0;
}

/**
 * The transform with its rotation set to `deg` (normalized, two decimals), the other functions kept in the dialect's
 * order; null when nothing is left (rotation 0 and nothing else).
 */
export function withRotation(transform: string | undefined, deg: number): string | null {
  const d = round2(normalizeDeg(deg));
  const fns = fnsOf(transform).filter((f) => f.key !== 'rotate');
  if (d !== 0) fns.push({ name: 'rotate', key: 'rotate', args: `${d}deg` });
  fns.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return fns.length ? fns.map((f) => `${f.name}(${f.args})`).join(' ') : null;
}

const lengthOf = (text: string | undefined, size: number): number => {
  if (!text) return 0;
  const t = text.trim();
  return t.endsWith('%') ? (Number.parseFloat(t) / 100) * size : Number.parseFloat(t) || 0;
};
/**
 * Fix wave 3: the literal a transform that is one design-system token (`var(--ds-x, fallback)`) falls back to, or null
 * when the value is not one token or has no fallback: what "Detach transform" writes in its place.
 */
export function transformFallback(transform: string | undefined): string | null {
  const m = /^var\(\s*--[A-Za-z0-9_-]+\s*,\s*([\s\S]+)\)$/.exec(transform?.trim() ?? '');
  return m ? m[1]!.trim() : null;
}

/** The px a transform's translate moves a box of `w` × `h` (a token or calc reads as 0). */
export function translateOf(transform: string | undefined, w: number, h: number): [number, number] {
  let [dx, dy] = [0, 0];
  for (const f of fnsOf(transform)) {
    if (f.key === 'translate') {
      const [a, b] = f.args.split(',');
      dx += lengthOf(a, w);
      dy += lengthOf(b, h);
    } else if (f.key === 'translatex') dx += lengthOf(f.args, w);
    else if (f.key === 'translatey') dy += lengthOf(f.args, h);
  }
  return [dx, dy];
}

// ---------------------------------------------------------------- resize

export interface ResizeOptions {
  /** The element's rotation: the pointer's movement is read along its own axes. */
  rotation?: number;
  /** Shift: keep the width-to-height ratio. */
  keepAspect?: boolean;
  /** Alt: resize about the centre. */
  fromCentre?: boolean;
  /** The smallest width and height, px (1). */
  min?: number;
}

/**
 * The size a resize asks for, in the element's own axes: the handle's edges move by `d`; Shift keeps the aspect, the
 * larger *relative* change leading (so a drag that shrinks one side shrinks the box); Alt doubles about the centre; the
 * minimum is applied with the aspect, the box keeping its shape at its smallest.
 */
function resizedSize(start: Box, handle: Handle, d: Pt, options: ResizeOptions): { w: number; h: number; sx: number; sy: number } {
  const min = options.min ?? 1;
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const k = options.fromCentre ? 2 : 1;
  let w = start.w + sx * d.x * k;
  let h = start.h + sy * d.y * k;
  if (options.keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (sx !== 0 && sy !== 0) {
      if (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1)) h = w / ratio;
      else w = h * ratio;
    } else if (sx !== 0) h = w / ratio;
    else w = h * ratio;
    // at the minimum the box keeps its shape: its smaller side stops there
    if (w < min || h < min) [w, h] = ratio >= 1 ? [min * ratio, min] : [min, min / ratio];
  }
  return { w: Math.max(min, w), h: Math.max(min, h), sx, sy };
}

/**
 * The box after dragging `handle` by `delta` (slide px, on the slide's axes). The edges the handle names move; the
 * opposite ones stay where they are on the slide (the centre, with `fromCentre`), also when the box is turned.
 */
export function resizeBox(start: Box, handle: Handle, delta: Pt, options: ResizeOptions): Box {
  const rot = options.rotation ?? 0;
  return resizePlaced(start, rot ? `rotate(${rot}deg)` : undefined, handle, delta, options);
}

/**
 * A resize of an element placed in its host at `start` (its left, top, width and height, px) under its own `transform`
 * (any of the dialect's: translate, rotate, scale, skew), dragged by `delta` in the host's px. The pointer's movement is
 * read along the element's own axes; the point opposite the handle (the centre, with `fromCentre`) stays where it is
 * drawn. Answers the new left, top, width and height.
 */
export function resizePlaced(start: Box, transform: string | undefined, handle: Handle, delta: Pt, options: ResizeOptions): Box {
  const before = placement(start, transform);
  const d = applyLinear(invert(linear(before)), delta);
  const { w, h, sx, sy } = resizedSize(start, handle, d, options);
  const u = options.fromCentre ? 0.5 : sx === -1 ? 1 : sx === 1 ? 0 : 0.5;
  const v = options.fromCentre ? 0.5 : sy === -1 ? 1 : sy === 1 ? 0 : 0.5;
  const held = apply(before, { x: u * start.w, y: v * start.h });
  const at = apply(placement({ x: 0, y: 0, w, h }, transform), { x: u * w, y: v * h });
  return { x: round2(held.x - at.x), y: round2(held.y - at.y), w: round2(w), h: round2(h) };
}

// ---------------------------------------------------------------- matrices (fix wave 1)

/** A 2D affine map as CSS writes one (`matrix(a, b, c, d, e, f)`): x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export const shift = (x: number, y: number): Affine => ({ ...IDENTITY, e: x, f: y });
/** `m` after `n` (n applied first). */
export function multiply(m: Affine, n: Affine): Affine {
  return { a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f };
}
export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}
// float noise around whole numbers read back as the whole number (a turned box's corners land on px)
const clean = (n: number) => (Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n);
export const apply = (m: Affine, p: Pt): Pt => ({ x: clean(m.a * p.x + m.c * p.y + m.e), y: clean(m.b * p.x + m.d * p.y + m.f) });
export const applyLinear = (m: Affine, p: Pt): Pt => ({ x: clean(m.a * p.x + m.c * p.y), y: clean(m.b * p.x + m.d * p.y) });
export const linear = (m: Affine): Affine => ({ ...m, e: 0, f: 0 });
export const isIdentityLinear = (m: Affine, eps = 1e-6): boolean => Math.abs(m.a - 1) < eps && Math.abs(m.d - 1) < eps && Math.abs(m.b) < eps && Math.abs(m.c) < eps;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** The dialect's transform (and CSS's 2D functions) as one matrix, % of a `w` × `h` box; what it cannot read is identity. */
export function transformMatrix(value: string | undefined, w: number, h: number): Affine {
  return parseTransform(value, w, h).matrix;
}

/**
 * The transform as one matrix, or null when any part of it cannot be read (a token, a calc(), a function outside the 2D
 * set): fix wave 2, so a writer that must keep a pose refuses rather than reading it as absent.
 */
export function readTransform(value: string | undefined, w: number, h: number): Affine | null {
  const read = parseTransform(value, w, h);
  return read.ok ? read.matrix : null;
}

const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|%)?$/;
const ANGLE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:deg|turn|rad|grad)?$/i;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
function parseTransform(value: string | undefined, w: number, h: number): { matrix: Affine; ok: boolean } {
  let m = IDENTITY;
  let ok = true;
  for (const f of fnsOf(value)) {
    const args = f.args.split(',').map((a) => a.trim());
    const all = (re: RegExp, min: number, max: number) => args.length >= min && args.length <= max && args.every((a) => re.test(a));
    let n: Affine = IDENTITY;
    switch (f.key) {
      case 'translate':
        ok &&= all(LENGTH, 1, 2);
        n = shift(lengthOf(args[0], w), lengthOf(args[1], h));
        break;
      case 'translatex':
        ok &&= all(LENGTH, 1, 1);
        n = shift(lengthOf(args[0], w), 0);
        break;
      case 'translatey':
        ok &&= all(LENGTH, 1, 1);
        n = shift(0, lengthOf(args[0], h));
        break;
      case 'rotate': {
        ok &&= all(ANGLE, 1, 1);
        const t = rad(angleDeg(args[0] ?? '0'));
        n = { a: Math.cos(t), b: Math.sin(t), c: -Math.sin(t), d: Math.cos(t), e: 0, f: 0 };
        break;
      }
      case 'scale': {
        ok &&= all(NUMBER, 1, 2);
        const sx = Number.parseFloat(args[0] ?? '1');
        const sy = args[1] === undefined ? sx : Number.parseFloat(args[1]);
        n = { ...IDENTITY, a: Number.isFinite(sx) ? sx : 1, d: Number.isFinite(sy) ? sy : 1 };
        break;
      }
      case 'skew':
        ok &&= all(ANGLE, 1, 2);
        n = { ...IDENTITY, c: Math.tan(rad(angleDeg(args[0] ?? '0'))), b: Math.tan(rad(angleDeg(args[1] ?? '0'))) };
        break;
      case 'skewx':
        ok &&= all(ANGLE, 1, 1);
        n = { ...IDENTITY, c: Math.tan(rad(angleDeg(args[0] ?? '0'))) };
        break;
      case 'skewy':
        ok &&= all(ANGLE, 1, 1);
        n = { ...IDENTITY, b: Math.tan(rad(angleDeg(args[0] ?? '0'))) };
        break;
      case 'matrix': {
        const v = args.map(Number);
        const fine = v.length === 6 && v.every((x) => Number.isFinite(x));
        ok &&= fine;
        if (fine) n = { a: v[0]!, b: v[1]!, c: v[2]!, d: v[3]!, e: v[4]!, f: v[5]! };
        break;
      }
      default:
        ok = false;
    }
    m = multiply(m, n);
  }
  // text left over between the functions (a bare token) is unread too
  if (value && value.trim() && value.trim() !== 'none' && fnsOf(value).length === 0) ok = false;
  return { matrix: m, ok };
}

/** Where a box placed at left/top in its host is drawn under its transform (about its centre): local px → host px. */
export function placement(box: Box, transform: string | undefined): Affine {
  const o = { x: box.w / 2, y: box.h / 2 };
  return multiply(shift(box.x + o.x, box.y + o.y), multiply(transformMatrix(transform, box.w, box.h), shift(-o.x, -o.y)));
}

/** The corners of a `w` × `h` box under `m`, top-left first, clockwise. */
export const cornersOf = (m: Affine, w: number, h: number): Pt[] => [apply(m, { x: 0, y: 0 }), apply(m, { x: w, y: 0 }), apply(m, { x: w, y: h }), apply(m, { x: 0, y: h })];
export function boundsOf(points: readonly Pt[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const EPS = 1e-6;
const fmt = (n: number, places: number) => String(Math.round(n * 10 ** places) / 10 ** places);
/**
 * A linear map written back in the dialect's form (rotate, then a uniform scale 0.5 to 2, then skew within ±60°), or
 * null for the identity. A map the dialect cannot write (mirrored, an uneven scale it has no skew for, out of range)
 * throws with the reason.
 */
export function transformOf(m: Affine): string | null {
  const { a, b, c, d } = m;
  if (a * d - b * c <= EPS) throw new Error('a mirrored or flattened pose has no rotate, scale or skew form in the dialect');
  // the rotation that leaves a uniform scale times a skew (equal diagonal); a similarity's own angle when any would do
  let theta = Math.abs(a - d) < EPS && Math.abs(b + c) < EPS ? Math.atan2(b, a) : Math.atan2(d - a, c + b);
  const unturn = (t: number) => {
    const [co, si] = [Math.cos(t), Math.sin(t)];
    return { k11: co * a + si * b, k12: co * c + si * d, k21: -si * a + co * b };
  };
  let k = unturn(theta);
  if (k.k11 < 0) {
    theta += Math.PI;
    k = unturn(theta);
  }
  const s = k.k11;
  if (s < 0.5 - EPS || s > 2 + EPS) throw new Error(`a scale of ${fmt(s, 3)} is outside the dialect's 0.5 to 2`);
  const ax = (Math.atan(k.k12 / s) * 180) / Math.PI;
  const ay = (Math.atan(k.k21 / s) * 180) / Math.PI;
  if (Math.abs(ax) > 60 + EPS || Math.abs(ay) > 60 + EPS) throw new Error('a skew past ±60° is outside the dialect');
  const parts: string[] = [];
  const deg = normalizeDeg((theta * 180) / Math.PI);
  if (Math.abs(deg) > 1e-4) parts.push(`rotate(${fmt(deg, 2)}deg)`);
  if (Math.abs(s - 1) > 1e-4) parts.push(`scale(${fmt(s, 4)})`);
  const [hx, hy] = [Math.abs(ax) > 1e-4, Math.abs(ay) > 1e-4];
  if (hx && hy) parts.push(`skew(${fmt(ax, 2)}deg, ${fmt(ay, 2)}deg)`);
  else if (hx) parts.push(`skewX(${fmt(ax, 2)}deg)`);
  else if (hy) parts.push(`skewY(${fmt(ay, 2)}deg)`);
  return parts.length ? parts.join(' ') : null;
}

// ---------------------------------------------------------------- rotate

/** The rotation the handle gives when dragged to `pointer` (0 straight above the centre, clockwise positive). */
export function angleFromPointer(centre: Pt, pointer: Pt, snap15: boolean): number {
  const deg = (Math.atan2(pointer.x - centre.x, -(pointer.y - centre.y)) * 180) / Math.PI;
  return normalizeDeg(snap15 ? Math.round(deg / 15) * 15 : round2(deg));
}

// ---------------------------------------------------------------- snapping

export type GuideKind = 'slide' | 'margin' | 'edge' | 'centre' | 'gap';
export interface SnapLine {
  at: number;
  kind: GuideKind;
}
/** A guide drawn while snapped: a line at `at` on `axis` from `from` to `to` along the other axis. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  kind: GuideKind;
}
export interface SnapContext {
  lines: { x: SnapLine[]; y: SnapLine[] };
  /** The boxes of the moving elements' siblings (their rotated bounds), in slide px. */
  siblings: readonly Box[];
  /** P3-E (E1 M3, X27 additive): the canvas's size the lines' guides span (a design board's); the deck's 1920×1080 when absent. */
  extent?: { w: number; h: number };
}

/** The slide's own lines: its edges and centre, and the 128 px margins. */
export function slideLines(w = SLIDE_W, h = SLIDE_H, margin = MARGIN): SnapContext['lines'] {
  const of = (size: number): SnapLine[] => [
    { at: 0, kind: 'slide' },
    { at: margin, kind: 'margin' },
    { at: size / 2, kind: 'centre' },
    { at: size - margin, kind: 'margin' },
    { at: size, kind: 'slide' },
  ];
  return { x: of(w), y: of(h) };
}

type Axis = 'x' | 'y';
const span = (b: Box, a: Axis): [number, number] => (a === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

interface Candidate {
  offset: number; // what to add to the moving box's start on this axis
  guides: (moved: Box) => Guide[];
}

/** Every way the moving box's start, middle or end (`parts`) meets a line, a sibling's edge or middle, or an equal gap. */
function candidates(b: Box, axis: Axis, ctx: SnapContext, parts: readonly ('start' | 'mid' | 'end')[], gaps: boolean): Candidate[] {
  const [s, e] = span(b, axis);
  const at = { start: s, mid: (s + e) / 2, end: e };
  const out: Candidate[] = [];
  const full: [number, number] = [0, axis === 'x' ? (ctx.extent?.h ?? SLIDE_H) : (ctx.extent?.w ?? SLIDE_W)]; // P3-E: extent
  for (const line of ctx.lines[axis])
    for (const p of parts) out.push({ offset: line.at - at[p], guides: () => [{ axis, at: line.at, from: full[0], to: full[1], kind: line.kind }] });
  for (const sib of ctx.siblings) {
    const [ss, se] = span(sib, axis);
    const targets: [number, GuideKind][] = [
      [ss, 'edge'],
      [(ss + se) / 2, 'centre'],
      [se, 'edge'],
    ];
    for (const [t, kind] of targets)
      for (const p of parts) {
        if ((kind === 'centre') !== (p === 'mid')) continue; // edges meet edges, middles meet middles
        out.push({
          offset: t - at[p],
          guides: (moved) => {
            const [a0, a1] = span(moved, other(axis));
            const [b0, b1] = span(sib, other(axis));
            return [{ axis, at: t, from: Math.min(a0, b0), to: Math.max(a1, b1), kind }];
          },
        });
      }
  }
  if (gaps) out.push(...gapCandidates(b, axis, ctx.siblings));
  return out;
}

/** Equal gaps along `axis` among the siblings sharing the moving box's row (or column). */
function gapCandidates(b: Box, axis: Axis, siblings: readonly Box[]): Candidate[] {
  const cross = span(b, other(axis));
  const row = siblings.filter((s) => overlaps(span(s, other(axis)), cross)).sort((p, q) => span(p, axis)[0] - span(q, axis)[0]);
  const size = axis === 'x' ? b.w : b.h;
  const [s] = span(b, axis);
  const out: Candidate[] = [];
  const gapGuide = (from: number, to: number, moved: Box, with_: Box): Guide => {
    const [a0, a1] = span(moved, other(axis));
    const [b0, b1] = span(with_, other(axis));
    const mid = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    return { axis: other(axis), at: mid, from, to, kind: 'gap' };
  };
  for (let i = 0; i < row.length; i++)
    for (let j = 0; j < row.length; j++) {
      if (i === j) continue;
      const [l, r] = [row[i]!, row[j]!];
      const [, le] = span(l, axis);
      const [rs] = span(r, axis);
      // centred between l and r
      if (rs - le >= size) {
        const at = (le + rs - size) / 2;
        out.push({ offset: at - s, guides: (m) => [gapGuide(le, at, m, l), gapGuide(at + size, rs, m, r)] });
      }
      // after the pair (l, r) at r's gap from l, or before it
      const [ls] = span(l, axis);
      const [, re] = span(r, axis);
      const gap = rs - le;
      if (gap > 0 && ls < rs) {
        out.push({ offset: re + gap - s, guides: (m) => [gapGuide(le, rs, m, l), gapGuide(re, re + gap, m, r)] });
        out.push({ offset: ls - gap - size - s, guides: (m) => [gapGuide(ls - gap, ls, m, l), gapGuide(le, rs, m, r)] });
      }
    }
  return out;
}

function best(cands: Candidate[], threshold: number): Candidate[] {
  let min = Infinity;
  for (const c of cands) if (Math.abs(c.offset) <= threshold && Math.abs(c.offset) < min) min = Math.abs(c.offset);
  return min === Infinity ? [] : cands.filter((c) => Math.abs(Math.abs(c.offset) - min) < 0.01);
}

/**
 * Where a moving box lands: on each axis the nearest of its edges or middle to a line, a sibling's edge or middle, or an
 * equal gap, within `threshold` slide px; the guides of every match at that place.
 */
export function snapMove(b: Box, ctx: SnapContext, threshold: number): { x: number; y: number; guides: Guide[] } {
  const bx = best(candidates(b, 'x', ctx, ['start', 'mid', 'end'], true), threshold);
  const by = best(candidates(b, 'y', ctx, ['start', 'mid', 'end'], true), threshold);
  const moved: Box = { ...b, x: b.x + (bx[0]?.offset ?? 0), y: b.y + (by[0]?.offset ?? 0) };
  const guides = [...bx, ...by].flatMap((c) => c.guides(moved));
  return { x: round2(moved.x), y: round2(moved.y), guides: dedupe(guides) };
}

/** A resized box's dragged edges snapped (the held edges stay), for an unturned box. */
export function snapResize(b: Box, handle: Handle, ctx: SnapContext, threshold: number, min = 1): { box: Box; guides: Guide[] } {
  const out = { ...b };
  const guides: Guide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const end = axis === 'x' ? (handle.includes('e') ? 'end' : handle.includes('w') ? 'start' : null) : handle.includes('s') ? 'end' : handle.includes('n') ? 'start' : null;
    if (!end) continue;
    const size = axis === 'x' ? out.w : out.h;
    // a snap that would take the box below its minimum is not offered
    const fits = (c: Candidate) => size + (end === 'end' ? c.offset : -c.offset) >= min;
    const hit = best(candidates(b, axis, ctx, [end], false).filter(fits), threshold)[0];
    if (!hit) continue;
    if (axis === 'x') {
      if (end === 'end') out.w = round2(out.w + hit.offset);
      else [out.x, out.w] = [round2(out.x + hit.offset), round2(out.w - hit.offset)];
    } else if (end === 'end') out.h = round2(out.h + hit.offset);
    else [out.y, out.h] = [round2(out.y + hit.offset), round2(out.h - hit.offset)];
    guides.push(...hit.guides(out));
  }
  return { box: out, guides: dedupe(guides) };
}

function dedupe(guides: Guide[]): Guide[] {
  const seen = new Set<string>();
  return guides.filter((g) => {
    const k = `${g.axis}:${round2(g.at)}:${round2(g.from)}:${round2(g.to)}:${g.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- pins

const isPx = (v: string | undefined) => v !== undefined && /^-?\d+(?:\.\d+)?px$/.test(v);

/**
 * What to write before dragging a pinned element so it moves by left/top px from where it is (its layout box in its
 * host): a right or bottom pin, or a left/top in % or calc, becomes left/top px with the element where it is; a stretch
 * (left and right, or top and bottom, with no size) keeps its size as width or height. Empty when it already moves so.
 */
export function pinToLeftTop(style: Readonly<Record<string, string>>, b: Box): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [near, far, size, at, extent] of [
    ['left', 'right', 'width', b.x, b.w],
    ['top', 'bottom', 'height', b.y, b.h],
  ] as const) {
    if (!isPx(style[near])) out[near] = px(at);
    if (style[far] !== undefined) {
      out[far] = null;
      if (style[near] !== undefined && (style[size] === undefined || style[size] === 'auto')) out[size] = px(extent);
    }
  }
  return out;
}

// ---------------------------------------------------------------- flow

/** How a flow parent places its children: along `main` (x a row, y a column), from its far end when `reverse`. */
export interface FlowAxis {
  main: 'x' | 'y';
  reverse: boolean;
}

/** Where a dropped flow child goes: before `boxes[index]` (`boxes.length`: after the last), and its insertion bar. */
export interface FlowSlot {
  index: number;
  bar: Box;
}

/**
 * The slot among `boxes` (a flow parent's children in order, the parent's px) a child dropped at `p` goes in, read on
 * both axes (the final fix wave's B8): the children fall into lines across the flow (a grid's rows, a wrapped row's
 * lines; one line when nothing wraps, whatever its children's sizes across it), the pointer takes the nearest line, and
 * in it the first child whose leading half it is over (leading in the flow's direction: a row-reverse's right half),
 * else the slot after the line's last. The bar (`thickness` px, the line's extent) sits at that slot: in the gap between
 * two children of the line, else outside the edge it was chosen at, so the one slot after a row's end and before the
 * next row's start is drawn where the pointer is. Null for no children.
 */
export function flowSlot(boxes: readonly Box[], p: Pt, flow: FlowAxis, thickness = 4): FlowSlot | null {
  const { main, reverse } = flow;
  const cross: Axis = main === 'x' ? 'y' : 'x';
  // a child overlapping the line so far across the flow by half its extent (or the line's) is in it
  const lines: { from: number; to: number; at: number[] }[] = [];
  boxes.forEach((b, i) => {
    const [s, e] = span(b, cross);
    const line = lines[lines.length - 1];
    if (line && Math.min(e, line.to) - Math.max(s, line.from) >= Math.min(e - s, line.to - line.from) / 2) {
      line.from = Math.min(line.from, s);
      line.to = Math.max(line.to, e);
      line.at.push(i);
    } else lines.push({ from: s, to: e, at: [i] });
  });
  const away = (l: { from: number; to: number }) => Math.max(l.from - p[cross], p[cross] - l.to, 0);
  let line = lines[0];
  if (!line) return null;
  for (const l of lines) if (away(l) < away(line)) line = l;
  const lead = (i: number) => span(boxes[i]!, main)[reverse ? 1 : 0];
  const trail = (i: number) => span(boxes[i]!, main)[reverse ? 0 : 1];
  const k = line.at.findIndex((i) => {
    const mid = (lead(i) + trail(i)) / 2;
    return reverse ? p[main] > mid : p[main] < mid;
  });
  let index: number;
  let at: number;
  if (k > 0) {
    index = line.at[k]!;
    at = (trail(line.at[k - 1]!) + lead(index)) / 2 - thickness / 2;
  } else if (k === 0) {
    index = line.at[0]!;
    at = lead(index) - (reverse ? 0 : thickness);
  } else {
    const last = line.at[line.at.length - 1]!;
    index = last + 1;
    at = trail(last) - (reverse ? thickness : 0);
  }
  const bar = main === 'x' ? { x: at, y: line.from, w: thickness, h: line.to - line.from } : { x: line.from, y: at, w: line.to - line.from, h: thickness };
  return { index, bar };
}
