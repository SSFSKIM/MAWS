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
// - flow: a flow child dragged among its siblings, its slot read on both axes in the direction its parent lays them (a
//   grid's rows, a reversed row or column; the final fix wave's B8); dropped, it re-orders (one key).
// - resize: eight handles (a flow child's width and height only, a flow text element's width only), Shift the aspect,
//   Alt about the centre; the dragged edges snapped when nothing turns, scales or skews the element.
// - rotate: the handle's angle, Shift by 15°, composed into the element's transform.
// - endpoint: a pinned connector's end.
// - marquee: the slide's children the rectangle touches (with Shift, added at the selection's level).
//
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17): a move, a resize, a rotation and an endpoint
// hold the replica's remote frames from their start to their drop, and the drop writes again what a held write moved.
import {
  angleFromPointer,
  apply,
  applyLinear,
  boundsOf,
  cornersOf,
  flowSlot,
  invert,
  isIdentityLinear,
  linear,
  multiply,
  normalizeDeg,
  pinToLeftTop,
  px,
  readTransform,
  resizePlaced,
  rotationOf,
  shift,
  slideLines,
  snapMove,
  snapResize,
  SNAP_SCREEN_PX,
  transformFallback,
  transformMatrix,
  union,
  withRotation,
  type Affine,
  type Box,
  type Guide,
  type Handle,
  type Pt,
  type SnapContext,
} from '../../geometry';
import { freePlacement } from './free-placement';
import { transact, type Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { isMissingSource } from '../../../design/model';
import { isPinned, TEXT_TAGS } from '../../ir';
import { heldOf, reorderFlow, ROOT } from '../../model';
import { checkStyle } from '../../css';
import { siteOf, writeElements, type ElementWrites } from '../../writers-elements';
import { DECK_COPY as C } from '../copy';
import type { SlideCanvas } from '../../canvas';
import type { DeckSession } from '../session';
import { boxInParent, containerMatrix, flowAxis, measure, measureAll, type Measured } from './measure';
import { addHits, marquee as marqueeOf, slideTree, type SlideTree } from './selection';

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
  /** Fix wave 3: why the gesture does nothing (shown to the owner); it writes nothing at all. */
  refused?: string;
  frame(p: Pt, mods: Mods): Frame;
  /** Ends it (`commit` false: a cancelled flow drag drops nothing). */
  end(commit?: boolean): void;
}

const NO_GUIDES: Frame = { guides: [] };
const refusal = (reason: string): Gesture => ({ refused: reason, frame: () => NO_GUIDES, end: () => {} });
/**
 * A gesture that composes or reads the element's transform (rotate, resize) needs it readable: a design-system token
 * (`var(--ds-pose, …)`) is a whole value the dialect takes as it is, and a rotation composed beside it would be dropped
 * on reload (fix wave 3).
 */
const unreadable = (transform: string | undefined, w: number, h: number): boolean => transform !== undefined && readTransform(transform, w, h) === null;
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
/**
 * P3-E (E1 M3, X27 additive): the canvas's own lines and the extent their guides span: a design board's edges and centre
 * with no margin (a board has no 128 px margin), a deck's slide as built.
 */
const canvasLines = (ctx: GestureContext): { lines: SnapContext['lines']; extent: { w: number; h: number } } => {
  const { w, h } = ctx.canvas.size;
  return { lines: ctx.canvas.isBoard ? slideLines(w, h, 0) : slideLines(), extent: { w, h } };
};
/** A move on the slide as the host's px move (its turn, scale and skew undone). */
const inHost = (hostMatrix: Affine, d: Pt): Pt => applyLinear(invert(linear(hostMatrix)), d);

/** The boxes snapping reads besides the slide's lines: the moving elements' siblings (as drawn). */
function siblingBounds(ctx: GestureContext, tree: SlideTree, ids: readonly string[]): Box[] {
  const parent = tree.parentOf(ids[0]!);
  const others = tree.childrenOf(parent).filter((id) => !ids.includes(id));
  return [...measureAll(ctx.canvas, others, ctx.scale).values()].map((m) => m.bounds);
}

/**
 * A drag's writes, one transaction a frame, its frames one undo step. P4-B2 (D17): the replica's remote frames wait
 * from its start (the session's gesture hold), and its drop re-asserts every key it wrote, at its last value.
 */
function dragWriter(ctx: GestureContext) {
  ctx.session.beginDrag();
  const last = new Map<string, Required<ElementWrites>>(); // every key written, at its last value
  let wrote = false;
  return {
    write(writes: Record<string, ElementWrites>) {
      writeElements(ctx.session.doc, ctx.slideId, writes, ctx.session.origin);
      for (const [id, w] of Object.entries(writes)) {
        let kept = last.get(id);
        if (!kept) last.set(id, (kept = { style: {}, attrs: {} }));
        Object.assign(kept.style, w.style);
        Object.assign(kept.attrs, w.attrs);
      }
      wrote = true;
    },
    end() {
      ctx.session.endDrag(() => reassert(ctx, last));
      return wrote;
    },
  };
}

/** P4-B2 (D17): a slide or board the drop may still write: there, neither held nor a board whose file never arrived. */
const takesWrites = (doc: Doc, slideId: string): boolean => Y.hasSlide(doc, slideId) && heldOf(doc, slideId) === null && !isMissingSource(doc, slideId);

/**
 * P4-B2 (D17): the drop's re-assert, run by the session after the hold's flush while it takes writes. A key the gesture
 * wrote whose value a held remote write moved gets the gesture's last value again, so the owner's drop wins whatever the
 * clientIDs (a concurrent write of the higher clientID would otherwise win the key). Nothing on a slide or board the
 * flush held, emptied or removed, nor on an element it deleted.
 */
function reassert(ctx: GestureContext, last: ReadonlyMap<string, Required<ElementWrites>>): void {
  const { doc } = ctx.session;
  if (!takesWrites(doc, ctx.slideId)) return;
  const writes: Record<string, ElementWrites> = {};
  for (const [id, wrote] of last) {
    if (!Y.hasElement(doc, ctx.slideId, id)) continue;
    const now = Y.elementScalars(doc, ctx.slideId, id);
    const moved = (prefix: string, values: Record<string, string | null>) => Object.entries(values).filter(([k, v]) => (now[prefix + k] ?? null) !== v);
    const style = moved('style:', wrote.style);
    const attrs = moved('attr:', wrote.attrs);
    if (style.length + attrs.length > 0) writes[id] = { style: Object.fromEntries(style), attrs: Object.fromEntries(attrs) };
  }
  if (Object.keys(writes).length > 0) writeElements(doc, ctx.slideId, writes, ctx.session.origin);
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
  let placement: ReturnType<typeof freePlacement>;
  try { placement = freePlacement(ctx); } catch (error) { return refusal(String(error)); }
  const ms = ids.map((id) => placement.measured.get(id) ?? measure(ctx.canvas, id, ctx.scale)).filter((m): m is Measured => m !== null);
  const bases = ms.map((m) => {
    const base = moveBase(tree, m);
    return placement.measured.has(m.id) && !m.points ? { ...base, left: m.inHost.x, top: m.inHost.y, conv: placement.writes[m.id]?.style ?? {} } : base;
  });
  const start = union(ms.map((m) => m.bounds));
  const siblings = siblingBounds(ctx, tree, ids);
  const { lines, extent } = canvasLines(ctx); // P3-E
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
        const snapped = snapMove(moved, { lines, siblings, extent }, threshold(ctx));
        if (!mods.shift || dx !== 0) dx += snapped.x - moved.x;
        if (!mods.shift || dy !== 0) dy += snapped.y - moved.y;
        guides = snapped.guides.filter((g) => (g.axis === 'x' ? !mods.shift || dx !== 0 : !mods.shift || dy !== 0));
      }
      const key = `${dx},${dy}`;
      if (key === last) return { guides };
      last = key;
      transact(ctx.session.doc, () => {
        if (first) placement.write(ctx.session.origin);
        // Freezing an unselected sibling is not a drag of it: only the selected elements win conflicts on drop.
        drag.write(movedBy(bases, { x: dx, y: dy }, first));
      }, ctx.session.origin);
      first = false;
      return { guides };
    },
    end() {
      drag.end();
    },
  };
}

/** Nudges pinned elements by `d` slide px (an arrow key): one write, converting a right/bottom pin first. */
export function nudge(ctx: GestureContext, ids: readonly string[], d: Pt): string | null {
  try {
    const tree = slideTree(ctx.session.doc, ctx.slideId);
    const placement = freePlacement(ctx);
    const bases = ids
      .filter((id) => { const e = tree.element(id); return e !== undefined && (placement.measured.has(id) || isPinned(e.tag, e.style, e.attrs)); })
      .map((id) => placement.measured.get(id) ?? measure(ctx.canvas, id, ctx.scale))
      .filter((m): m is Measured => m !== null)
      .map((m) => {
        const base = moveBase(tree, m);
        return placement.measured.has(m.id) && !m.points ? { ...base, left: m.inHost.x, top: m.inHost.y, conv: placement.writes[m.id]?.style ?? {} } : base;
      });
    if (bases.length) ctx.session.typing('nudge', (origin) => transact(ctx.session.doc, () => {
      placement.write(origin);
      writeElements(ctx.session.doc, ctx.slideId, movedBy(bases, d, true), origin);
    }, origin));
    return null;
  } catch (error) { return String(error); }
}

// ---------------------------------------------------------------- flow re-order

/** Drags a flow child among its flow siblings; the drop re-orders it. */
export function startFlowMove(ctx: GestureContext, id: string, p0: Pt): Gesture {
  if (!ctx.canvas.isBoard) return startMove(ctx, [id], p0);
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const parent = tree.parentOf(id);
  const flow = tree.childrenOf(parent).filter((s) => {
    const e = tree.element(s);
    return e !== undefined && !isPinned(e.tag, e.style, e.attrs);
  });
  const others = flow.filter((s) => s !== id);
  // the slots in the parent's own px, the pointer read back into them (the parent may be turned)
  const boxes = others.map((s) => boxInParent(ctx.canvas, parent, s, ctx.scale)).filter((b): b is Box => b !== null);
  const frame = containerMatrix(ctx.canvas, parent)?.box ?? null;
  const me = measure(ctx.canvas, id, ctx.scale);
  const axis = flowAxis(ctx.canvas, parent);
  const startAt = flow.indexOf(id);
  let at = startAt;
  return {
    frame(p) {
      if (!me || !frame || boxes.length !== others.length) return NO_GUIDES;
      const slot = flowSlot(boxes, apply(invert(frame), p), axis);
      at = slot?.index ?? 0;
      const ghost = { ...me.bounds, x: me.bounds.x + p.x - p0.x, y: me.bounds.y + p.y - p0.y };
      const bar = slot?.bar;
      return { guides: [], ghost, insertion: bar && boundsOf(cornersOf(multiply(frame, shift(bar.x, bar.y)), bar.w, bar.h)) };
    },
    end(commit = true) {
      if (!commit || at === startAt) return;
      const before = others[at] ?? null;
      ctx.session.edit((origin) => reorderFlow(ctx.session.doc, ctx.slideId, id, before, origin));
    },
  };
}

// ---------------------------------------------------------------- resize

/** The handles an element takes: eight when pinned; a flow child its trailing edges, a flow text element its width. */
export function handlesOf(tree: SlideTree, id: string): readonly Handle[] {
  const e = tree.element(id);
  if (!e || e.tag === 'tr' || e.tag === 'th' || e.tag === 'td') return [];
  if (e.tag === 'x-connector' && e.attrs.x1 !== undefined) return [];
  if (isPinned(e.tag, e.style, e.attrs)) return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return TEXT_TAGS.has(e.tag) ? ['e'] : ['e', 's', 'se'];
}

export function startResize(ctx: GestureContext, id: string, handle: Handle, p0: Pt): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const e = tree.element(id);
  const m = measure(ctx.canvas, id, ctx.scale);
  if (!e || !m) return { frame: () => NO_GUIDES, end: () => {} };
  if (unreadable(e.style.transform, m.w, m.h)) return refusal(C.tokenTransform(transformFallback(e.style.transform) !== null));
  const pinned = isPinned(e.tag, e.style, e.attrs);
  // P3-F: a flow text element takes its width only (handlesOf), so Shift keeps no aspect on it and writes no height
  const widthOnly = !pinned && TEXT_TAGS.has(e.tag);
  const start = placeOf(e.style, m);
  const conv = pinned ? pinToLeftTop(e.style, start) : {};
  // snapping reads the slide's axes: only for an element nothing turns, scales or skews
  const plain = isIdentityLinear(m.matrix);
  const origin = apply(m.hostMatrix, { x: 0, y: 0 });
  const siblings = siblingBounds(ctx, tree, [id]);
  const { lines, extent } = canvasLines(ctx); // P3-E
  const drag = dragWriter(ctx);
  let first = true;
  let last = '';
  return {
    frame(p, mods) {
      const delta = inHost(m.hostMatrix, { x: p.x - p0.x, y: p.y - p0.y });
      const aspect = mods.shift && !widthOnly;
      let b = resizePlaced(start, e.style.transform, handle, delta, { keepAspect: aspect, fromCentre: mods.alt && pinned, min: MIN_SIZE });
      let guides: readonly Guide[] = [];
      if (plain && !mods.meta && !aspect && !mods.alt) {
        // the drawn edges snap (the element's own translate, % of its size, moves them off its layout box); the result
        // goes back to layout px at its new size, the held drawn edge where it was (fix wave 2)
        const t = (w: number, h: number) => {
          const m = transformMatrix(e.style.transform, w, h);
          return { x: m.e, y: m.f };
        };
        const at = t(b.w, b.h);
        const snapped = snapResize({ ...b, x: b.x + at.x + origin.x, y: b.y + at.y + origin.y }, handle, { lines, siblings, extent }, threshold(ctx), MIN_SIZE);
        const after = t(snapped.box.w, snapped.box.h);
        b = { ...snapped.box, x: snapped.box.x - origin.x - after.x, y: snapped.box.y - origin.y - after.y };
        guides = snapped.guides;
      }
      const wide = aspect || handle.includes('e') || handle.includes('w');
      const tall = aspect || handle.includes('n') || handle.includes('s');
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

/**
 * Turns an element by its handle from the pointer's press `p0`: the rotation moves by the angle the pointer turns about
 * the centre, from the element's own rotation (fix wave 2: a skewed element's handle is not straight above its centre,
 * so an absolute angle would jump on the first move); Shift snaps the result to 15°.
 */
export function startRotate(ctx: GestureContext, id: string, p0: Pt): Gesture {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const e = tree.element(id);
  const m = measure(ctx.canvas, id, ctx.scale);
  if (!e || !m) return { frame: () => NO_GUIDES, end: () => {} };
  if (unreadable(e.style.transform, m.w, m.h)) return refusal(C.tokenTransform(transformFallback(e.style.transform) !== null));
  // every composed transform is checked as the loader checks it before it lands
  const { site, style } = siteOf(ctx.session.doc, ctx.slideId, id);
  // the angle as the host sees it: a rotation inside a turned group is the group's own
  const back = invert(m.hostMatrix);
  const centre = apply(back, apply(m.matrix, { x: m.w / 2, y: m.h / 2 }));
  const from = angleFromPointer(centre, apply(back, p0), false);
  const start = rotationOf(e.style.transform);
  const drag = dragWriter(ctx);
  let last: number | null = normalizeDeg(start);
  return {
    frame(p, mods) {
      const turned = start + angleFromPointer(centre, apply(back, p), false) - from;
      const deg = normalizeDeg(mods.shift ? Math.round(turned / 15) * 15 : Math.round(turned * 100) / 100);
      if (deg === last) return NO_GUIDES;
      last = deg;
      const transform = withRotation(e.style.transform, deg);
      if (transform !== null && !checkStyle('transform', transform, site, { ...style, transform }).ok) return NO_GUIDES;
      drag.write({ [id]: { style: { transform } } });
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
  const { lines, extent } = canvasLines(ctx); // P3-E
  const drag = dragWriter(ctx);
  const [xn, yn] = end === 0 ? ['x1', 'y1'] : ['x2', 'y2'];
  let last = '';
  return {
    frame(p, mods) {
      let q = { x: Math.round(p.x), y: Math.round(p.y) };
      let guides: readonly Guide[] = [];
      if (plain && !mods.meta) {
        const s = snapMove({ x: q.x, y: q.y, w: 0, h: 0 }, { lines, siblings, extent }, threshold(ctx));
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
      ctx.session.select(addHits(tree, base, marqueeOf(tree, bounds, rect)));
      return { guides: [], marquee: rect };
    },
    end() {},
  };
}
