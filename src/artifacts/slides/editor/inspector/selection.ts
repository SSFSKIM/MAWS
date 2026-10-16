// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): what the inspector edits and how a
// change is checked before it is written. The selection as the loader sees each element (its site, style and attributes;
// the section when nothing is selected); a property shown only where it applies to every selected element; and a change
// planned for every element first, so a value one of them would refuse writes nothing to any (all or nothing).
import type { Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { appliesTo, checkStyle, type StyleSite } from '../../css';
import type { Attrs, Style, Tag } from '../../ir';
import { childLists, readFlat, resolveParents, ROOT } from '../../model';
import { siteOf } from '../../writers-elements';

export interface Picked {
  /** The element's id; ROOT ('') for the slide's section. */
  id: string;
  tag: Tag | 'section';
  site: StyleSite;
  style: Style;
  attrs: Attrs;
}
export type Props = Record<string, string | null>;

/**
 * The selected elements still on the slide, in pick order; the section when none is. Each site as `siteOf` reads it,
 * from one read of the slide (this runs at every update of the replica while the panel shows).
 */
export function pickedOf(doc: Doc, slideId: string, ids: readonly string[]): Picked[] {
  if (!Y.hasSlide(doc, slideId)) return [];
  const present = ids.filter((id) => id !== ROOT && Y.hasElement(doc, slideId, id));
  const section = (): Picked => {
    const { site, style } = siteOf(doc, slideId, ROOT);
    return { id: ROOT, tag: 'section', site, style, attrs: site.attrs };
  };
  if (present.length === 0) return [section()];
  const els = readFlat(doc, slideId, false);
  const byId = new Map(els.map((e) => [e.id, e]));
  const eff = resolveParents(els);
  const root = section();
  return present.map((id) => {
    const me = byId.get(id)!;
    const p = eff.get(id)!;
    const parent = p === ROOT ? { tag: 'section' as const, style: root.style } : { tag: byId.get(p)!.tag, style: byId.get(p)!.style };
    return { id, tag: me.tag, site: { tag: me.tag, attrs: me.attrs, parent }, style: me.style, attrs: me.attrs };
  });
}

const PLACEMENT = new Set(['left', 'top', 'right', 'bottom', 'width', 'height']);
const coordinated = (p: Picked) => p.tag === 'x-connector' && p.attrs.x1 !== undefined;

/** Whether `prop` may be set on the element at all (the table's applies-to column and the per-element limits). */
export function can(prop: string, p: Picked): boolean {
  if (coordinated(p) && PLACEMENT.has(prop)) return false;
  return appliesTo(prop, p.site, p.style);
}
export const canAll = (prop: string, picked: readonly Picked[]): boolean => picked.length > 0 && picked.every((p) => can(prop, p));

/** One value across the selection: the shared value, or `mixed` when the elements differ. */
export function common<T>(picked: readonly Picked[], read: (p: Picked) => T): { value: T | undefined; mixed: boolean } {
  if (picked.length === 0) return { value: undefined, mixed: false };
  const first = read(picked[0]!);
  return picked.every((p) => read(p) === first) ? { value: first, mixed: false } : { value: undefined, mixed: true };
}

/**
 * A change to each element's style checked as the loader would check it (css.ts `checkStyle`, the same check `restyle`
 * makes): the writes per element, and the reasons when any value would be dropped (then nothing is written).
 */
export function planStyle(picked: readonly Picked[], propsFor: (p: Picked) => Props | null): { writes: [string, Props][]; reasons: string[] } {
  const writes: [string, Props][] = [];
  const reasons = new Set<string>();
  for (const p of picked) {
    const props = propsFor(p);
    if (!props || Object.keys(props).length === 0) continue;
    const next: Style = { ...p.style };
    for (const [k, v] of Object.entries(props)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    for (const [k, v] of Object.entries(props)) {
      if (v === null) continue;
      const checked = checkStyle(k, v, p.site, next);
      if (!checked.ok) reasons.add(checked.reason);
    }
    writes.push([p.id, props]);
  }
  return { writes, reasons: [...reasons] };
}

/** The table a selection is in (a table, or the table of a row or cell), with its rows and the picked row and column. */
export interface TableAt {
  tableId: string;
  rows: string[];
  columns: number;
  row: string | null;
  column: number | null;
}
export function tableAt(doc: Doc, slideId: string, picked: readonly Picked[]): TableAt | null {
  if (picked.length !== 1 || !['table', 'tr', 'th', 'td'].includes(picked[0]!.tag)) return null;
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const lists = childLists(els, eff);
  const me = picked[0]!;
  const rowId = me.tag === 'tr' ? me.id : me.tag === 'table' ? null : eff.get(me.id)!;
  const tableId = me.tag === 'table' ? me.id : eff.get(rowId!)!;
  const rows = (lists.get(tableId) ?? []).filter((e) => e.tag === 'tr').map((e) => e.id);
  const cellsOf = (row: string) => (lists.get(row) ?? []).filter((e) => e.tag === 'th' || e.tag === 'td');
  const columns = Math.max(0, ...rows.map((r) => cellsOf(r).length));
  const column = me.tag === 'th' || me.tag === 'td' ? cellsOf(rowId!).findIndex((c) => c.id === me.id) : null;
  return { tableId, rows, columns, row: rowId, column };
}
