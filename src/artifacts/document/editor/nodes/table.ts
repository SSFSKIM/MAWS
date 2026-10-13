// Table cells a person can type in (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md). The schema's cells
// hold `block*` (M1, so an agent's or an import's empty cell is stored as it is), and prosemirror-tables makes the cells
// of a new table, row or column with `createAndFill`, which for `block*` is an empty cell with no textblock for the
// caret. So the editor gives every empty cell its own transactions touched an empty paragraph, in the same dispatch;
// a remote write (the binding's own transaction) is never answered, or every replica would write the same repair.
import { Extension, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { isBindingTransaction } from '../../../yjs';

const CELLS = new Set(['tableCell', 'tableHeader']);

function changedRanges(trs: readonly Transaction[], doc: PMNode): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  trs.forEach((tr, i) => {
    // map each step's new range through the steps and transactions after it, to the final document
    tr.steps.forEach((step, j) => {
      step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart;
        let to = newEnd;
        const rest = [tr.mapping.slice(j + 1), ...trs.slice(i + 1).map((later) => later.mapping)];
        for (const mapping of rest) {
          from = mapping.map(from, -1);
          to = mapping.map(to, 1);
        }
        ranges.push([Math.max(0, from), Math.min(doc.content.size, to)]);
      });
    });
  });
  return ranges;
}

export const TableCellFill = Extension.create({
  name: 'tableCellFill',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableCellFill'),
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged) || trs.some(isBindingTransaction)) return null;
          const empty = new Set<number>();
          for (const [from, to] of changedRanges(trs, state.doc)) {
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (CELLS.has(node.type.name) && node.childCount === 0) empty.add(pos);
              return !node.isTextblock;
            });
          }
          if (empty.size === 0) return null;
          const tr = state.tr;
          // from the last, so the earlier positions hold
          for (const pos of [...empty].sort((a, b) => b - a)) tr.insert(pos + 1, state.schema.nodes.paragraph.create());
          return tr;
        },
      }),
    ];
  },
});

/** A new table, every cell holding an empty paragraph, the first row a header row. */
export function tableJSON(rows: number, cols: number): JSONContent {
  const row = (cell: string): JSONContent => ({ type: 'tableRow', content: Array.from({ length: cols }, () => ({ type: cell, content: [{ type: 'paragraph' }] })) });
  return { type: 'table', content: [row('tableHeader'), ...Array.from({ length: rows - 1 }, () => row('tableCell'))] };
}
