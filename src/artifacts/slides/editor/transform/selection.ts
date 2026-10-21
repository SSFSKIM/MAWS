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

/**
 * Tab (and Shift-Tab): the next element among the selection's siblings in paint order. Past the last (before the
 * first), and on a level with none, there is no next (null): the key then leaves the stage, so the stage is no keyboard
 * trap (P3-F; WCAG 2.1.2).
 */
export function tabNext(tree: SlideTree, selection: readonly string[], back: boolean): string[] | null {
  const list = tree.childrenOf(scopeOf(tree, selection));
  const at = selection.length ? list.indexOf(selection[selection.length - 1]!) : -1;
  const next = at < 0 ? (back ? list.length - 1 : 0) : at + (back ? -1 : 1);
  return next >= 0 && next < list.length ? [list[next]!] : null;
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

/**
 * A Shift-marquee: its hits added to the selection at the selection's level, as a Shift-click adds (`pick`); hits at
 * another level replace it, so a group's child and the group are never selected together (P3-F: one move then moved
 * the child twice). Touching nothing keeps the selection.
 */
export function addHits(tree: SlideTree, selection: readonly string[], hits: readonly string[]): string[] {
  if (!hits.length) return [...selection];
  if (selection.length && tree.parentOf(selection[0]!) !== tree.parentOf(hits[0]!)) return [...hits];
  return [...selection, ...hits.filter((id) => !selection.includes(id))];
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

// ---- P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D1 to D8): the state machine's pure reads

/**
 * A text target (D2): an element whose own text the text box edits (a heading, a paragraph, a list, a table cell),
 * never a container's single text descendant, so a group's first click selects and moves the group (P7).
 */
export function isTextTarget(tree: SlideTree, id: string): boolean {
  const tag = tree.element(id)?.tag;
  return tag !== undefined && TEXT_TAGS.has(tag) && !CONTAINER_TAGS.has(tag);
}

/**
 * The frontmost element under a press and its ancestors, deepest first. A press's hits are the whole painted stack, so
 * an element covered by another is among them; whatever a press reaches past the scope it reaches through this chain,
 * never past what is drawn in front (the M1 review's P2).
 */
function frontChain(tree: SlideTree, hits: readonly string[]): string[] {
  const hit = hits.find((h) => tree.has(h));
  return hit === undefined ? [] : chainOf(tree, hit);
}

/** T5: the deepest text target under the press (the frontmost element or its ancestors), whatever the scope; or null. */
export function deepestText(tree: SlideTree, hits: readonly string[]): string | null {
  return frontChain(tree, hits).find((id) => isTextTarget(tree, id)) ?? null;
}

/** T3 into a selected container: the element under the press one level inside `parent`, or null. */
export function childAt(tree: SlideTree, hits: readonly string[], parent: string): string | null {
  return frontChain(tree, hits).find((id) => tree.parentOf(id) === parent) ?? null;
}

/** T3 and D8 on a table: the cell of `table` under the press (in the frontmost element's chain), or null. */
export function cellAt(tree: SlideTree, hits: readonly string[], table: string): string | null {
  return frontChain(tree, hits).find((id) => tableOf(tree, id) === table) ?? null;
}

/** Whether the element is a table cell. */
export const isCell = (tree: SlideTree, id: string): boolean => {
  const tag = tree.element(id)?.tag;
  return tag === 'th' || tag === 'td';
};

/** The table a cell sits in (cell → row → table), or null. */
export function tableOf(tree: SlideTree, cellId: string): string | null {
  if (!isCell(tree, cellId)) return null;
  const table = tree.parentOf(tree.parentOf(cellId));
  return tree.element(table)?.tag === 'table' ? table : null;
}

/** A table's cells by row, in order. */
export function cellGrid(tree: SlideTree, tableId: string): string[][] {
  return tree
    .childrenOf(tableId)
    .filter((r) => tree.element(r)?.tag === 'tr')
    .map((r) => tree.childrenOf(r).filter((c) => isCell(tree, c)));
}

function cellPosition(grid: readonly (readonly string[])[], cellId: string): [number, number] | null {
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r]!.indexOf(cellId);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** D8: the rectangle of cells between two cells of one table, in reading order (empty when they are not both in it). */
export function cellRange(tree: SlideTree, tableId: string, a: string, b: string): string[] {
  const grid = cellGrid(tree, tableId);
  const pa = cellPosition(grid, a);
  const pb = cellPosition(grid, b);
  if (!pa || !pb) return [];
  const [r0, r1] = [Math.min(pa[0], pb[0]), Math.max(pa[0], pb[0])];
  const [c0, c1] = [Math.min(pa[1], pb[1]), Math.max(pa[1], pb[1])];
  const out: string[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (grid[r]![c] !== undefined) out.push(grid[r]![c]!);
  return out;
}

/** T16: the next (or previous) cell in reading order, or null past the last (before the first). */
export function nextCell(tree: SlideTree, cellId: string, back: boolean): string | null {
  const table = tableOf(tree, cellId);
  if (!table) return null;
  const flat = cellGrid(tree, table).flat();
  const at = flat.indexOf(cellId);
  const next = at + (back ? -1 : 1);
  return at < 0 || next < 0 || next >= flat.length ? null : flat[next]!;
}

/** CELLS (D8): the table when the selection is two or more cells of one table, else null. */
export function cellsTable(tree: SlideTree, selection: readonly string[]): string | null {
  if (selection.length < 2) return null;
  const table = tableOf(tree, selection[0]!);
  return table !== null && selection.every((id) => tableOf(tree, id) === table) ? table : null;
}
