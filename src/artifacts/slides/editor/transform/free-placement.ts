// WR #35: agents author structured slides; the first human move freezes their measured layout.
// Keep containers (and their transforms), text and table internals intact. Read every box before writing any.
import { apply, invert, px } from '../../geometry';
import { appliesTo, type StyleSite } from '../../css';
import { isPinned } from '../../ir';
import { ROOT } from '../../model';
import { preparePinnedLayout, siteOf, type ElementWrites } from '../../writers-elements';
import type { GestureContext } from './gestures';
import { boxInParent, containerMatrix, measure, type Measured } from './measure';
import { slideTree } from './selection';

export function freePlacement(ctx: GestureContext) {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const ids: string[] = [];
  const visit = (parent: string) => {
    for (const id of tree.childrenOf(parent)) {
      ids.push(id);
      if (tree.element(id)?.tag === 'div') visit(id);
    }
  };
  visit(ROOT);
  const writes: Record<string, ElementWrites> = {};
  const measured = new Map<string, Measured>();
  if (ctx.canvas.isBoard || !ids.some((id) => { const e = tree.element(id)!; return !isPinned(e.tag, e.style, e.attrs); })) {
    return { measured, writes, write: () => {} };
  }
  const sectionStyle = siteOf(ctx.session.doc, ctx.slideId, ROOT).style;
  for (const id of ids) {
    const element = tree.element(id)!;
    const parent = tree.parentOf(id);
    const m = measure(ctx.canvas, id, ctx.scale);
    const frame = containerMatrix(ctx.canvas, parent);
    const box = boxInParent(ctx.canvas, parent, id, ctx.scale);
    if (!m || !frame || (!box && !m.points)) throw new Error('Wait for the slide to finish drawing before moving it.');
    if (m.points) {
      const [a, b] = m.points.map((p) => apply(invert(frame.padding), p));
      writes[id] = { attrs: Object.fromEntries(Object.entries({ x1: String(a!.x), y1: String(a!.y), x2: String(b!.x), y2: String(b!.y) }).filter(([key, value]) => element.attrs[key] !== value)) };
      measured.set(id, { ...m, hostMatrix: frame.padding });
    } else {
      const parentNode = parent === ROOT ? ctx.canvas.root : ctx.canvas.node(parent)!;
      const at = { ...box!, x: box!.x - parentNode.clientLeft, y: box!.y - parentNode.clientTop };
      const pinned = { ...element.style, position: 'absolute', left: px(at.x), top: px(at.y), width: px(at.w), height: px(at.h) };
      const parentElement = tree.element(parent);
      const site: StyleSite = { tag: element.tag, attrs: element.attrs, parent: parentElement ?? { tag: 'section', style: sectionStyle } };
      const style: Record<string, string | null> = { position: pinned.position, left: pinned.left, top: pinned.top, width: pinned.width, height: pinned.height, right: null, bottom: null };
      // The dialect owns applicability: layout constraints that belonged to a flow child cannot remain on a pin.
      for (const key of Object.keys(element.style)) if (!appliesTo(key, site, pinned)) style[key] = null;
      writes[id] = { style: Object.fromEntries(Object.entries(style).filter(([key, value]) => (element.style[key] ?? null) !== value)) };
      measured.set(id, { ...m, inHost: at, hostMatrix: frame.padding, host: parent });
    }
  }
  return { measured, writes, write: preparePinnedLayout(ctx.session.doc, ctx.slideId, writes) };
}
