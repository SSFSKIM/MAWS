// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5): the selection's commands,
// shared by the toolbar's Arrange buttons and the stage's keys: delete, duplicate (⌘D), z-order on pinned elements
// (front, back, forward, backward), group and ungroup, Detach (a flow child to pinned at its rendered box). Each is one
// gesture (one transaction or one undo step) with the editor's origin; what the slide's limits refuse comes back as a
// reason to show.
import { freePlacement } from './free-placement';
import type { Box } from '../../geometry';
import { CELL_TAGS, TEXT_TAGS, isPinned } from '../../ir';
import { deleteElementTree, ROOT, zOrder } from '../../model';
import { detachWithin, duplicateWithin, groupElements, ungroup } from '../../writers-elements';
import type { GestureContext } from './gestures';
import { measure } from './measure';
import { allPinned, slideTree, type SlideTree } from './selection';

export type ZTo = 'front' | 'back' | 'forward' | 'backward';
const DUPLICATE_OFFSET = 24; // px a pinned copy sits from its original

export interface SelectionCommands {
  canEdit: boolean;
  canZ: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canDetach: boolean;
  remove(): void;
  duplicate(): string | null;
  z(to: ZTo): void;
  group(): string | null;
  ungroup(): string | null;
  detach(): string | null;
}

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function isGroup(tree: SlideTree, id: string): boolean {
  const e = tree.element(id);
  if (!e || e.tag !== 'div' || e.attrs['data-group'] === undefined) return false;
  return tree.childrenOf(id).every((c) => {
    const k = tree.element(c)!;
    return isPinned(k.tag, k.style, k.attrs);
  });
}

/** The commands for `selection` on the current slide (each answers a refusal's reason, or null). */
export function selectionCommands(ctx: GestureContext, selection: readonly string[], readOnly: boolean): SelectionCommands {
  const { session, slideId } = ctx;
  const doc = session.doc;
  const tree = slideTree(doc, slideId);
  const ids = selection.filter((id) => tree.has(id));
  const structural = ids.some((id) => {
    const tag = tree.element(id)!.tag;
    return CELL_TAGS.has(tag) || tag === 'tr';
  });
  const canEdit = !readOnly && ids.length > 0;
  const sameParent = ids.every((id) => tree.parentOf(id) === tree.parentOf(ids[0]!));
  const one = ids.length === 1 ? tree.element(ids[0]!) : undefined;
  const canDetach =
    !readOnly &&
    one !== undefined &&
    !isPinned(one.tag, one.style, one.attrs) &&
    !CELL_TAGS.has(one.tag) &&
    one.tag !== 'tr' &&
    (tree.parentOf(one.id) === ROOT || tree.element(tree.parentOf(one.id))?.tag === 'div');
  const paintOrder = (list: readonly string[]) => {
    const order = tree.childrenOf(tree.parentOf(list[0]!));
    return [...list].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  };
  const attempt = (write: () => void): string | null => {
    try {
      write();
      return null;
    } catch (e) {
      return reasonOf(e);
    }
  };
  return {
    canEdit,
    canZ: canEdit && allPinned(tree, ids),
    canGroup: canEdit && ids.length >= 2 && sameParent && allPinned(tree, ids),
    canUngroup: canEdit && ids.length === 1 && isGroup(tree, ids[0]!),
    canDetach,
    remove() {
      if (!canEdit || structural) return;
      session.edit((origin) => deleteElementTree(doc, slideId, ids, origin));
      session.select([]);
    },
    duplicate() {
      if (!canEdit || structural) return null;
      let copies = new Map<string, string>();
      const refused = attempt(() => session.edit((origin) => (copies = duplicateWithin(doc, slideId, ids, DUPLICATE_OFFSET, origin))));
      if (!refused) session.select(ids.map((id) => copies.get(id)!).filter(Boolean));
      return refused;
    },
    z(to) {
      if (!canEdit || !allPinned(tree, ids)) return;
      // several at once, keeping their own order: to the front and one step back bottom-up (each lands above, or
      // steps under the one moved before it); to the back and one step forward top-down (fix wave 1: two neighbours
      // stepping forward bottom-up only swapped and swapped back)
      const ordered = sameParent ? paintOrder(ids) : ids;
      const run = to === 'front' || to === 'backward' ? ordered : [...ordered].reverse();
      session.edit((origin) => run.forEach((id) => zOrder(doc, slideId, id, to, origin)));
    },
    group() {
      if (!canEdit || ids.length < 2) return null;
      const boxes = new Map<string, Box>();
      for (const id of ids) {
        const m = measure(ctx.canvas, id, ctx.scale);
        if (m) boxes.set(id, m.inHost);
      }
      let group = '';
      const refused = attempt(() => session.edit((origin) => (group = groupElements(doc, slideId, ids, boxes, origin))));
      if (!refused) session.select([group]);
      return refused;
    },
    ungroup() {
      if (ids.length !== 1 || !isGroup(tree, ids[0]!)) return null;
      // each child's box in the group's px (the group is its host)
      const boxes = new Map<string, Box>();
      for (const c of tree.childrenOf(ids[0]!)) {
        const m = measure(ctx.canvas, c, ctx.scale);
        if (m) boxes.set(c, m.inHost);
      }
      let kids: string[] = [];
      const refused = attempt(() => session.edit((origin) => (kids = ungroup(doc, slideId, ids[0]!, origin, boxes.size ? boxes : undefined))));
      if (!refused) session.select(kids);
      return refused;
    },
    detach() {
      if (!canDetach || !one) return null;
      if (!ctx.canvas.isBoard) return attempt(() => {
        const placement = freePlacement(ctx);
        session.edit((origin) => placement.write(origin));
      });
      const m = measure(ctx.canvas, one.id, ctx.scale);
      if (!m) return null;
      const box = { left: m.inHost.x, top: m.inHost.y, width: m.w, ...(TEXT_TAGS.has(one.tag) ? {} : { height: m.h }) };
      return attempt(() => session.edit((origin) => detachWithin(doc, slideId, one.id, box, origin)));
    },
  };
}
