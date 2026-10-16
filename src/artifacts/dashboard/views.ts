// A dashboard's chart blocks as its doc holds them (P3-E2 M3; parent Decision Log 9, ledger X25's `viewWarnings`): every
// `chart` node of every tab with its block id, the dataset it names (the fence body, `source`) and its spec. A create or
// an edit normalises, before it commits, the specs it wrote (`normalizeChartSpecs`, the grammar's reading stored: unknown
// keys and refused values dropped), answering what it dropped per block; a read reports every retained spec's problems
// without writing (`viewWarnings`), so an old version is never rewritten. An unknown view kind is kept as written and
// drawn as the shared error. Portable: the host's tools call it, inside their write's frame.
import { listTabs, tabBody } from '../document/tabs';
import { transact, type Doc, type Node } from '../yjs';
import { YNode } from '../yjs/document';
import { normalizeSpec } from './spec';

// An attribute a replica wrote as text, else empty (a value of any other shape is never stringified through its own methods).
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface ViewWarning {
  blockId: string;
  message: string;
}

export interface ChartBlock {
  node: Node;
  blockId: string;
  source: string;
  spec: unknown;
}

/** Every chart block of the doc, tab by tab in display order, each body in document order (nested blocks included). */
export function chartSpecs(doc: Doc): ChartBlock[] {
  const out: ChartBlock[] = [];
  const walk = (node: Node) => {
    for (const child of node.toArray()) {
      if (!(child instanceof YNode)) continue;
      if (child.name === 'chart') out.push({ node: child, blockId: textOf(child.getAttr('id')), source: textOf(child.getAttr('source')), spec: child.getAttr('spec') ?? null });
      else walk(child);
    }
  };
  for (const tab of listTabs(doc)) {
    const body = tabBody(doc, tab.id);
    if (body) walk(body);
  }
  return out;
}

/** What each chart's spec drops or cannot draw, block by block; reads only. */
export function viewWarnings(doc: Doc): ViewWarning[] {
  return chartSpecs(doc).flatMap(({ blockId, spec }) => normalizeSpec(spec).warnings.map((message) => ({ blockId, message })));
}

/** The specs as they stand, by block id, as `normalizeChartSpecs` compares them (taken before a write). */
export const chartSpecsBefore = (doc: Doc): Map<string, string> => new Map(chartSpecs(doc).map(({ blockId, spec }) => [blockId, JSON.stringify(spec)]));

/**
 * Normalises the specs a write wrote: every chart block absent from `before` or whose spec changed since, in one
 * transaction (none when nothing changes); answers what each such block's spec dropped or cannot draw.
 */
export function normalizeChartSpecs(doc: Doc, before: ReadonlyMap<string, string>): ViewWarning[] {
  const warnings: ViewWarning[] = [];
  const writes: { node: Node; spec: unknown }[] = [];
  for (const { node, blockId, spec } of chartSpecs(doc)) {
    if (before.get(blockId) === JSON.stringify(spec)) continue;
    const normal = normalizeSpec(spec);
    for (const message of normal.warnings) warnings.push({ blockId, message });
    if (normal.changed) writes.push({ node, spec: normal.spec });
  }
  if (writes.length > 0) transact(doc, () => writes.forEach(({ node, spec }) => node.setAttr('spec', spec)));
  return warnings;
}
