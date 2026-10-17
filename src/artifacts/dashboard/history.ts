// A dashboard's dataset changes in B's version history (P3-E2 M4; E's Decision Log 8 and 28 (3)): B's history diffs
// tab bodies, and a dataset replaced under a chart whose attributes are byte-identical changes no body, yet the view
// redraws. This is the dashboard's `HistoryApi.extraChanges`: between two states, every dataset whose descriptor was
// added, replaced or removed is a change of each chart block the later state binds to it, or, bound by none, an entry
// of its own. Each is credited to the change itself from the comparison's provenance: the descriptor's write for an
// addition or a replacement, its deletion for a removal, never the prior binding's creator. A descriptor written again
// with an equal value is no change. Portable.
import type { ExtraChange } from '../document/history';
import { listTabs, tabBody } from '../document/tabs';
import { deletedBy, insertedBy, type ContentMap, type Doc, type Node } from '../yjs';
import { YNode } from '../yjs/document';
import { DATASETS_ROOT, datasetIdFromSource } from './datasets';

/** The chart blocks of `doc` by the dataset each names (read as the editor and the exporters read it), in display
 * order: tab by tab, each body in document order. */
function boundBlocks(doc: Doc): Map<string, { tabId: string; blockId: string }[]> {
  const out = new Map<string, { tabId: string; blockId: string }[]>();
  const walk = (node: Node, tabId: string): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof YNode)) continue;
      const blockId: unknown = child.getAttr('id');
      if (child.name === 'chart' && typeof blockId === 'string') {
        const source = datasetIdFromSource(child.getAttr('source'));
        if (source !== '') out.set(source, [...(out.get(source) ?? []), { tabId, blockId }]);
      }
      else walk(child, tabId);
    }
  };
  for (const tab of listTabs(doc)) {
    const body = tabBody(doc, tab.id);
    if (body) walk(body, tab.id);
  }
  return out;
}

const keysOf = (root: Node): string[] => [...(root.attrKeys() as Iterable<string>)];

/** The dataset changes between `prevDoc` and `nextDoc`, as B's history merges them (`ExtraChange`). */
export function datasetChanges(prevDoc: Doc, nextDoc: Doc, attributions: ContentMap): ExtraChange[] {
  const before = prevDoc.get(DATASETS_ROOT);
  const after = nextDoc.get(DATASETS_ROOT);
  const ids = [...new Set([...keysOf(before), ...keysOf(after)])].sort();
  if (ids.length === 0) return [];
  const bound = boundBlocks(nextDoc);
  const out: ExtraChange[] = [];
  for (const id of ids) {
    const was: unknown = before.getAttr(id);
    const now: unknown = after.getAttr(id);
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const verb = was === undefined ? 'added' : now === undefined ? 'removed' : 'replaced';
    // the later state's entry: the write that put the descriptor there, or, removed, the item its removal deleted
    // (a replacement then a removal deletes the replacement, so the remover is credited, not the replacer)
    const item = after._map.get(id) ?? before._map.get(id);
    const by = item ? (now === undefined ? deletedBy(attributions, item.id) : insertedBy(attributions, item.id)) : null;
    const change = { label: `Dataset “${id}” ${verb}`, who: by?.actor ?? null, at: by?.at ?? null };
    const blocks = bound.get(id) ?? [];
    if (blocks.length === 0) out.push({ key: `dataset:${id}`, tabId: null, blockId: null, ...change });
    for (const { tabId, blockId } of blocks) out.push({ key: `dataset:${id}:${blockId}`, tabId, blockId, ...change });
  }
  return out;
}
