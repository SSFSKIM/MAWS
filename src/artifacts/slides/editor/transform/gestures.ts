// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer", "Stage and overlay"; M5): the
// transform layer's gestures. Each is started on a pointer press with what it moves measured once, then given the
// pointer (slide px) on every frame and writes that frame as one transaction with the editor's origin; the writes
// between its start and end are one undo step (S6's drag: one transaction per pointer frame). A frame answers what the
// overlay draws meanwhile: snapping guides, the marquee, a flow insertion bar.
//
// Fix wave 1: every pointer move is read back into the px it writes in through the measured maps (measure.ts): a move's
// delta through the host's inverse, a resize along the element's own axes under its whole transform (scale and skew
// too), a rotation about the centre as the host sees it, so a gesture on a scaled element or inside a turned group
// lands where the pointer is.
//
// - move: pinned elements by left/top px (a right/bottom, %, or calc pin rewritten on the first frame where the element
//   is), connectors by their coordinates; snapped as one box unless ⌘; Shift keeps to one axis.
// - flow: a flow child dragged among its siblings along its parent's axis; dropped, it re-orders (one key).
// - resize: eight handles (a flow child's width and height only, a flow text element's width only), Shift the aspect,
//   Alt about the centre; the dragged edges snapped when nothing turns, scales or skews the element.
// - rotate: the handle's angle, Shift by 15°, composed into the element's transform.
// - endpoint: a pinned connector's end.
// - marquee: the slide's children the rectangle touches.
import {
  angleFromPointer,
  apply,
  applyLinear,
  boundsOf,
  cornersOf,
  flowInsertIndex,
  invert,
  isIdentityLinear,
  linear,
  multiply,
  pinToLeftTop,
  px,
  resizePlaced,
  shift,
  slideLines,
  snapMove,
  snapResize,
  SNAP_SCREEN_PX,
  union,
  withRotation,
  type Affine,
  type Box,
  type Guide,
  type Handle,
  type Pt,
} from '../../geometry';
import { isPinned } from '../../ir';
import { reorderFlow, ROOT } from '../../model';
import { writeElements, type ElementWrites } from '../../writers-elements';
import type { SlideCanvas } from '../../canvas';
import type { DeckSession } from '../session';
import { boxInParent, containerMatrix, flowDirection, measure, measureAll, type Measured } from './measure';
import { marquee as marqueeOf, slideTree, type SlideTree } from './selection';

export interface GestureContext {
  session: DeckSession;
  slideId: string;
  canvas: SlideCanvas;
  scale: number;
}
export interface Mods {
  shift: boolean;
  alt: boolean;
  meta: boolean;
}
export interface Frame {
  guides: readonly Guide[];
  marquee?: Box;
  /** A flow insertion bar, slide px. */
  insertion?: Box;
  /** Where a dragged flow child would be drawn. */
  ghost?: Box;
}
export interface Gesture {
  frame(p: Pt, mods: Mods): Frame;
  /** Ends it (`commit` false: a cancelled flow drag drops nothing). */
  end(commit?: boolean): void;
}

const NO_GUIDES: Frame = { guides: [] };
const PX = /^(-?\d+(?:\.\d+)?)px$/;
const MIN_SIZE = 8;
/**
 * Where an element sits in its host (left, top, width, height px): its own px values where it has them (offsets round
 * to whole px, so a value read back from layout would drift), the measured layout box elsewhere.
 */
function placeOf(style: Readonly<Record<string, string>>, m: Measured): Box {
  const own = (k: string, measured: number) => {
    const hit = PX.exec(style[k] ?? '');
    return hit ? Number(hit[1]) : measured;
  };
  return { x: own('left', m.inHost.x), y: own('top', m.inHost.y), w: own('width', m.w), h: own('height', m.h) };
}
const num = (n: number) => String(Math.round(n * 100) / 100);
const threshold = (ctx: GestureContext) => SNAP_SCREEN_PX / ctx.scale;
/** A move on the slide as the host's px move (its turn, scale and skew undone). */
const inHost = (hostMatrix: Affine, d: Pt): Pt => applyLinear(invert(linear(hostMatrix)), d);

/** The boxes snapping reads besides the slide's lines: the moving elements' siblings (as drawn). */
function siblingBounds(ctx: GestureContext, tree: SlideTree, ids: readonly string[]): Box[] {
  const parent = tree.parentOf(ids[0]!);
  const others = tree.childrenOf(parent).filter((id) => !ids.includes(id));
  return [...measureAll(ctx.canvas, others, ctx.scale).values()].map((m) => m.bounds);
}

/** A drag's writes, one transaction a frame, its frames one undo step. */
function dragWriter(ctx: GestureContext) {
  ctx.session.beginDrag();
  let wrote = false;
  return {
    write(writes: Record<string, ElementWrites>) {
      writeElements(ctx.session.doc, ctx.slideId, writes, ctx.session.origin);
      wrote = true;
    },
    end() {
      ctx.session.endDrag();
      return wrote;
    },
  };
}

// ---------------------------------------------------------------- move

interface MoveBase {
  id: string;
  hostMatrix: Affine;
  left: number;
  top: number;
  /** What the first frame rewrites so left/top px move the element (a right/bottom or % pin). */
  conv: Record<string, string | null>;
  /** A pinned connector's coordinates instead, host px. */
  coords?: [number, number, number, number];
}

function moveBase(tree: SlideTree, m: Measured): MoveBase {
  if (m.points) {
    const back = invert(m.hostMatrix);
    const [a, b] = m.points.map((p) => apply(back, p)) as [Pt, Pt];
    return { id: m.id, hostMatrix: m.hostMatrix, left: 0, top: 0, conv: {}, coords: [a.x, a.y, b.x, b.y] };
  }
  const el = tree.element(m.id)!;
  const at = placeOf(el.style, m);
  return { id: m.id, hostMatrix: m.hostMatrix, left: at.x, top: at.y, conv: pinToLeftTop(el.style, at) };
}

/** One move (a slide delta) of every base as writes in its own host's px. */
function movedBy(bases: readonly MoveBase[], d: Pt, first: boolean): Record<string, ElementWrites> {
  const writes: Record<string, ElementWrites> = {};
  for (const b of bases) {
    const h = inHost(b.hostMatrix, d);
    if (b.coords) {
      const [x1, y1, x2, y2] = b.coords;
      writes[b.id] = { attrs: { x1: num(x1 + h.x), y1: num(y1 + h.y), x2: num(x2 + h.x), y2: num(y2 + h.y) } };
    } else writes[b.id] = { style: { ...(first ? b.conv : {}), left: px(b.left + h.x), top: px(b.top + h.y) } };
  }
  return writes;
}

/** Moves pinned elements (and pinned connectors) together. */
export function startMove(ctx: GestureContext, ids: readonly string[], p0: Pt): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const ms = ids.map((id) => measure(ctx.canvas, id, ctx.scale)).filter((m): m is Measured => m !== null);
  const bases = ms.map((m) => moveBase(tree, m));
  const start = union(ms.map((m) => m.bounds));
  const siblings = siblingBounds(ctx, tree, ids);
  const lines = slideLines();
  const drag = dragWriter(ctx);
  let last = '';
  let first = true;
  return {
    frame(p, mods) {
      if (!start) return NO_GUIDES;
      let dx = p.x - p0.x;
      let dy = p.y - p0.y;
      if (mods.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      dx = Math.round(dx);
      dy = Math.round(dy);
      let guides: Guide[] = [];
      if (!mods.meta) {
        const moved = { ...start, x: start.x + dx, y: start.y + dy };
        const snapped = snapMove(moved, { lines, siblings }, threshold(ctx));
        if (!mods.shift || dx !== 0) dx += snapped.x - moved.x;
        if (!mods.shift || dy !== 0) dy += snapped.y - moved.y;
        guides = snapped.guides.filter((g) => (g.axis === 'x' ? !mods.shift || dx !== 0 : !mods.shift || dy !== 0));
      }
      const key = `${dx},${dy}`;
      if (key === last) return { guides };
      last = key;
      drag.write(movedBy(bases, { x: dx, y: dy }, first));
      first = false;
      return { guides };
    },
    end() {
      drag.end();
    },
  };
}

/** Nudges pinned elements by `d` slide px (an arrow key): one write, converting a right/bottom pin first. */
export function nudge(ctx: GestureContext, ids: readonly string[], d: Pt, write: (writes: Record<string, ElementWrites>) => void): void {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const bases = ids
    .filter((id) => {
      const e = tree.element(id);
      return e !== undefined && isPinned(e.tag, e.style, e.attrs);
    })
    .map((id) => measure(ctx.canvas, id, ctx.scale))
    .filter((m): m is Measured => m !== null)
    .map((m) => moveBase(tree, m));
  if (bases.length) write(movedBy(bases, d, true));
}

// ---------------------------------------------------------------- flow re-order

/** Drags a flow child among its flow siblings; the drop re-orders it. */
export function startFlowMove(ctx: GestureContext, id: string, p0: Pt): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const parent = tree.parentOf(id);
  const flow = tree.childrenOf(parent).filter((s) => {
    const e = tree.element(s);
    return e !== undefined && !isPinned(e.tag, e.style, e.attrs);
  });
  const others = flow.filter((s) => s !== id);
  // the slots in the parent's own px, the pointer read back into them (the parent may be turned)
  const boxes = others.map((s) => boxInParent(ctx.canvas, parent, s)).filter((b): b is Box => b !== null);
  const frame = containerMatrix(ctx.canvas, parent)?.box ?? null;
  const me = measure(ctx.canvas, id, ctx.scale);
  const direction = flowDirection(ctx.canvas, parent);
  const startAt = flow.indexOf(id);
  let at = startAt;
  return {
    frame(p) {
      if (!me || !frame || boxes.length !== others.length) return NO_GUIDES;
      at = flowInsertIndex(boxes, apply(invert(frame), p), direction);
      const ghost = { ...me.bounds, x: me.bounds.x + p.x - p0.x, y: me.bounds.y + p.y - p0.y };
      const bar = insertionBar(boxes, at, direction);
      return { guides: [], ghost, insertion: bar && boundsOf(cornersOf(multiply(frame, shift(bar.x, bar.y)), bar.w, bar.h)) };
    },
    end(commit = true) {
      if (!commit || at === startAt) return;
      const before = others[at] ?? null;
      ctx.session.edit((origin) => reorderFlow(ctx.session.doc, ctx.slideId, id, before, origin));
    },
  };
}

function insertionBar(boxes: readonly Box[], at: number, direction: 'row' | 'column'): Box | undefined {
  if (!boxes.length) return undefined;
  const all = union(boxes)!;
  const BAR = 4;
  if (direction === 'column') {
    const y = at === 0 ? boxes[0]!.y - BAR : at >= boxes.length ? boxes[boxes.length - 1]!.y + boxes[boxes.length - 1]!.h : (boxes[at - 1]!.y + boxes[at - 1]!.h + boxes[at]!.y) / 2 - BAR / 2;
    return { x: all.x, y, w: all.w, h: BAR };
  }
  const x = at === 0 ? boxes[0]!.x - BAR : at >= boxes.length ? boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.w : (boxes[at - 1]!.x + boxes[at - 1]!.w + boxes[at]!.x) / 2 - BAR / 2;
  return { x, y: all.y, w: BAR, h: all.h };
}

// ---------------------------------------------------------------- resize

/** The handles an element takes: eight when pinned; a flow child its trailing edges, a flow text element its width. */
export function handlesOf(tree: SlideTree, id: string): readonly Handle[] {
  const e = tree.element(id);
  if (!e || e.tag === 'tr' || e.tag === 'th' || e.tag === 'td') return [];
  if (e.tag === 'x-connector' && e.attrs.x1 !== undefined) return [];
  if (isPinned(e.tag, e.style, e.attrs)) return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return ['h1', 'h2', 'h3', 'p', 'ul', 'ol'].includes(e.tag) ? ['e'] : ['e', 's', 'se'];
}

export function startResize(ctx: GestureContext, id: string, handle: Handle, p0: Pt): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const e = tree.element(id);
  const m = measure(ctx.canvas, id, ctx.scale);
  if (!e || !m) return { frame: () => NO_GUIDES, end: () => {} };
  const pinned = isPinned(e.tag, e.style, e.attrs);
  const start = placeOf(e.style, m);
  const conv = pinned ? pinToLeftTop(e.style, start) : {};
  // snapping reads the slide's axes: only for an element nothing turns, scales or skews
  const plain = isIdentityLinear(m.matrix);
  const origin = apply(m.hostMatrix, { x: 0, y: 0 });
  const siblings = siblingBounds(ctx, tree, [id]);
  const lines = slideLines();
  const drag = dragWriter(ctx);
  let first = true;
  let last = '';
  return {
    frame(p, mods) {
      const delta = inHost(m.hostMatrix, { x: p.x - p0.x, y: p.y - p0.y });
      let b = resizePlaced(start, e.style.transform, handle, delta, { keepAspect: mods.shift, fromCentre: mods.alt && pinned, min: MIN_SIZE });
      let guides: readonly Guide[] = [];
      if (plain && !mods.meta && !mods.shift && !mods.alt) {
        const snapped = snapResize({ ...b, x: b.x + origin.x, y: b.y + origin.y }, handle, { lines, siblings }, threshold(ctx), MIN_SIZE);
        b = { ...snapped.box, x: snapped.box.x - origin.x, y: snapped.box.y - origin.y };
        guides = snapped.guides;
      }
      const wide = mods.shift || handle.includes('e') || handle.includes('w');
      const tall = mods.shift || handle.includes('n') || handle.includes('s');
      const style: Record<string, string | null> = first ? { ...conv } : {};
      if (pinned) {
        style.left = px(b.x);
        style.top = px(b.y);
      }
      if (wide) style.width = px(b.w);
      if (tall) style.height = px(b.h);
      const key = JSON.stringify(style);
      if (key === last) return { guides };
      last = key;
      first = false;
      drag.write({ [id]: { style } });
      return { guides };
    },
    end() {
      drag.end();
    },
  };
}

// ---------------------------------------------------------------- rotate

export function startRotate(ctx: GestureContext, id: string): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const e = tree.element(id);
  const m = measure(ctx.canvas, id, ctx.scale);
  if (!e || !m) return { frame: () => NO_GUIDES, end: () => {} };
  // the angle as the host sees it: a rotation inside a turned group is the group's own
  const back = invert(m.hostMatrix);
  const centre = apply(back, apply(m.matrix, { x: m.w / 2, y: m.h / 2 }));
  const drag = dragWriter(ctx);
  let last: number | null = null;
  return {
    frame(p, mods) {
      const deg = angleFromPointer(centre, apply(back, p), mods.shift);
      if (deg === last) return NO_GUIDES;
      last = deg;
      drag.write({ [id]: { style: { transform: withRotation(e.style.transform, deg) } } });
      return NO_GUIDES;
    },
    end() {
      drag.end();
    },
  };
}

// ---------------------------------------------------------------- a connector's end

export function startEndpoint(ctx: GestureContext, id: string, end: 0 | 1): Gesture {
  const m = measure(ctx.canvas, id, ctx.scale);
  if (!m?.points) return { frame: () => NO_GUIDES, end: () => {} };
  const back = invert(m.hostMatrix);
  const plain = isIdentityLinear(m.hostMatrix);
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const siblings = siblingBounds(ctx, tree, [id]);
  const lines = slideLines();
  const drag = dragWriter(ctx);
  const [xn, yn] = end === 0 ? ['x1', 'y1'] : ['x2', 'y2'];
  let last = '';
  return {
    frame(p, mods) {
      let q = { x: Math.round(p.x), y: Math.round(p.y) };
      let guides: readonly Guide[] = [];
      if (plain && !mods.meta) {
        const s = snapMove({ x: q.x, y: q.y, w: 0, h: 0 }, { lines, siblings }, threshold(ctx));
        q = { x: s.x, y: s.y };
        guides = s.guides;
      }
      const h = apply(back, q);
      const attrs = { [xn]: num(h.x), [yn]: num(h.y) };
      const key = JSON.stringify(attrs);
      if (key !== last) {
        last = key;
        drag.write({ [id]: { attrs } });
      }
      return { guides };
    },
    end() {
      drag.end();
    },
  };
}

// ---------------------------------------------------------------- marquee

export function startMarquee(ctx: GestureContext, p0: Pt, base: readonly string[]): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const bounds = new Map([...measureAll(ctx.canvas, tree.childrenOf(ROOT), ctx.scale)].map(([id, m]) => [id, m.bounds]));
  return {
    frame(p) {
      const rect = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      const hit = marqueeOf(tree, bounds, rect);
      ctx.session.select([...base, ...hit.filter((id) => !base.includes(id))]);
      return { guides: [], marquee: rect };
    },
    end() {},
  };
}
