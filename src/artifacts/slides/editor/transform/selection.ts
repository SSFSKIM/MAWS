// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5): which elements a click,
// a shift-click, a double-click, Escape, Tab or a marquee selects. A slide is a tree (the section, its containers, their
// children); a click picks at the level of what is selected (the slide's own children at first), so a card is picked
// whole and a double-click goes into it; ⌘-click picks the deepest element under the pointer. Pure over the model.
import type { Doc } from '../../../yjs';
import { intersects, type Box } from '../../geometry';
import { CONTAINER_TAGS, TEXT_TAGS, isPinned, type Tag } from '../../ir';
import { childLists, readFlat, resolveParents, ROOT, type FlatElement } from '../../model';

export interface SlideTree {
  parentOf(id: string): string;
  /** Children in paint order ([under] [flow] [over]); ROOT's are the section's. */
  childrenOf(id: string): readonly string[];
  element(id: string): FlatElement | undefined;
  has(id: string): boolean;
}

export function slideTree(doc: Doc, slideId: string): SlideTree {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const lists = childLists(els, eff);
  const byId = new Map(els.map((e) => [e.id, e]));
  return {
    parentOf: (id) => eff.get(id) ?? ROOT,
    childrenOf: (id) => (lists.get(id) ?? []).map((e) => e.id),
    element: (id) => byId.get(id),
    has: (id) => byId.has(id),
  };
}

/** The element and its ancestors up to (not including) the section. */
export function chainOf(tree: SlideTree, id: string): string[] {
  const out: string[] = [];
  for (let cur = id; cur !== ROOT && tree.has(cur) && !out.includes(cur); cur = tree.parentOf(cur)) out.push(cur);
  return out;
}

/** The container the selection's elements sit in (the section when nothing is selected). */
export const scopeOf = (tree: SlideTree, selection: readonly string[]): string => (selection.length && tree.has(selection[0]!) ? tree.parentOf(selection[0]!) : ROOT);

export interface PickModifiers {
  /** ⌘: the deepest element under the pointer. */
  deep?: boolean;
  /** Shift: add to or take from the selection. */
  toggle?: boolean;
}

/**
 * A pointer press at a place whose elements are `hits` (deepest first as painted). `target` is the element pressed
 * (null on the slide itself); `selection` what is selected now. A press inside an already selected element keeps the
 * selection, so a multi-selection drags together (a release without a drag then narrows it to `target`).
 */
export function pick(tree: SlideTree, hits: readonly string[], selection: readonly string[], mods: PickModifiers = {}): { target: string | null; selection: string[] } {
  const hit = hits.find((h) => tree.has(h));
  if (hit === undefined) return { target: null, selection: mods.toggle ? [...selection] : [] };
  const chain = chainOf(tree, hit);
  let target: string;
  const selected = chain.find((id) => selection.includes(id));
  if (mods.deep) target = hit;
  else if (selected !== undefined) target = selected;
  else {
    const scope = scopeOf(tree, selection);
    target = chain.find((id) => tree.parentOf(id) === scope) ?? chain[chain.length - 1]!;
  }
  if (mods.toggle) {
    if (selection.includes(target)) return { target, selection: selection.filter((s) => s !== target) };
    const sameParent = selection.length === 0 || tree.parentOf(selection[0]!) === tree.parentOf(target);
    return { target, selection: sameParent ? [...selection, target] : [target] };
  }
  if (selection.includes(target)) return { target, selection: [...selection] };
  return { target, selection: [target] };
}

/** A double-click: into the selected container (its child under the pointer), or `edit` on a selected text element. */
export function drill(tree: SlideTree, hits: readonly string[], selection: readonly string[]): string[] | 'edit' | null {
  if (selection.length !== 1) return null;
  const s = selection[0]!;
  const e = tree.element(s);
  if (!e) return null;
  if (TEXT_TAGS.has(e.tag) && !CONTAINER_TAGS.has(e.tag)) return 'edit';
  const hit = hits.find((h) => tree.has(h));
  if (hit === undefined) return null;
  const chain = chainOf(tree, hit);
  const at = chain.indexOf(s);
  if (at <= 0) return null;
  return [chain[at - 1]!];
}

/** Escape: up to the container, then nothing. */
export function escapeUp(tree: SlideTree, selection: readonly string[]): string[] {
  if (!selection.length) return [];
  const scope = scopeOf(tree, selection);
  return scope === ROOT ? [] : [scope];
}

/** Tab (and Shift-Tab): the next element among the selection's siblings in paint order, around. */
export function tabNext(tree: SlideTree, selection: readonly string[], back: boolean): string[] {
  const list = tree.childrenOf(scopeOf(tree, selection));
  if (!list.length) return [];
  const at = selection.length ? list.indexOf(selection[selection.length - 1]!) : -1;
  const next = at < 0 ? (back ? list.length - 1 : 0) : (at + (back ? -1 : 1) + list.length) % list.length;
  return [list[next]!];
}

/** ⌘A: every element at the selection's level. */
export const selectAll = (tree: SlideTree, selection: readonly string[]): string[] => [...tree.childrenOf(scopeOf(tree, selection))];

/** A marquee over the slide: the section's children whose drawn bounds it touches. */
export function marquee(tree: SlideTree, bounds: ReadonlyMap<string, Box>, rect: Box): string[] {
  return tree.childrenOf(ROOT).filter((id) => {
    const b = bounds.get(id);
    return b !== undefined && intersects(b, rect);
  });
}

/** Whether every element of the selection is pinned (the transform layer moves pinned elements by left/top). */
export function allPinned(tree: SlideTree, selection: readonly string[]): boolean {
  return (
    selection.length > 0 &&
    selection.every((id) => {
      const e = tree.element(id);
      return e !== undefined && isPinned(e.tag, e.style, e.attrs);
    })
  );
}

export const isText = (tag: Tag | undefined): boolean => tag !== undefined && TEXT_TAGS.has(tag);
