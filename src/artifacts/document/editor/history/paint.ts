// The history preview's paint (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7: inserts in the
// author's colour, deletions struck, block gutter marks, "N changes" with ↑ ↓; parent Decision Log 34: moved and
// retyped blocks marked). While the editor draws a diff (the binding's renderer set), every change run gets its author's
// colour (`--author-N`, by `actorDisplay`), each block holding a change a gutter mark, the change ↑ ↓ reached an
// outline, and each block a move or a retype re-inserted a label; the plugin's state holds the change list the history
// bar counts and steps through. Outside a diff it draws nothing.
import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Carry } from '../../../yjs';
import { ySyncPluginKey } from '../../../yjs/prosemirror';
import { attributedRuns, changeList, type Change } from '../../history';
import { authorOf } from './model';

interface PaintState {
  active: boolean;
  changes: Change[];
  current: number | null;
  carried: ReadonlyMap<string, Carry['kind']>;
  decorations: DecorationSet;
}
interface PaintMeta {
  current?: number | null;
  carried?: ReadonlyMap<string, Carry['kind']>;
}

export const historyPaintKey = new PluginKey<PaintState>('historyPaint');

const CARRY_LABEL: Record<Carry['kind'], string> = { move: 'Moved', retype: 'Retyped' };
const authorStyle = (who: string | null) => (who === null ? '' : `--doc-author: var(${authorOf(who).color})`);
const drawing = (state: EditorState) => (ySyncPluginKey.getState(state) as { renderer?: unknown } | undefined)?.renderer != null;
const deleted = (node: PMNode) => node.marks.some((mark) => mark.type.name === 'y-attributed-delete');

function paint(doc: PMNode, changes: Change[], current: number | null, carried: ReadonlyMap<string, Carry['kind']>): DecorationSet {
  const decorations: Decoration[] = [];
  for (const run of attributedRuns(doc)) {
    const attrs = { class: `doc-change doc-change-${run.kind}`, style: authorStyle(run.who) };
    if (!run.node) decorations.push(Decoration.inline(run.from, run.to, attrs));
    else {
      const node = doc.nodeAt(run.from);
      if (node) decorations.push(Decoration.node(run.from, run.from + node.nodeSize, attrs));
    }
  }
  // a gutter mark on each top-level block a change touches, in the change's first author's colour
  const marked = new Set<number>();
  doc.forEach((block, offset) => {
    const end = offset + block.nodeSize;
    const change = changes.find((c) => c.from < end && c.to > offset);
    if (change && !marked.has(offset)) {
      marked.add(offset);
      decorations.push(Decoration.node(offset, end, { 'data-change-block': '', style: authorStyle(change.who[0] ?? null) }));
    }
  });
  const reached = current === null ? undefined : changes[current];
  if (reached) decorations.push(Decoration.inline(reached.from, reached.to, { class: 'doc-change-current' }));
  if (carried.size > 0) {
    doc.descendants((node, pos) => {
      const kind = carried.get(node.attrs.id as string);
      if (kind && !deleted(node)) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-carry': kind, 'data-carry-label': CARRY_LABEL[kind] }));
      return true;
    });
  }
  return DecorationSet.create(doc, decorations);
}

const IDLE: PaintState = { active: false, changes: [], current: null, carried: new Map(), decorations: DecorationSet.empty };

function next(tr: Transaction | null, value: PaintState, state: EditorState): PaintState {
  const meta = tr?.getMeta(historyPaintKey) as PaintMeta | undefined;
  const carried = meta?.carried ?? value.carried;
  if (!drawing(state)) return value.active || carried !== value.carried ? { ...IDLE, carried } : value;
  if (tr && !tr.docChanged && !meta && value.active) return value;
  const changes = !tr || tr.docChanged || !value.active ? changeList(state.doc) : value.changes;
  const current = meta && 'current' in meta ? (meta.current ?? null) : tr?.docChanged ? null : value.current;
  return { active: true, changes, current, carried, decorations: paint(state.doc, changes, current, carried) };
}

export const HistoryPaint = Extension.create({
  name: 'historyPaint',
  addProseMirrorPlugins() {
    return [
      new Plugin<PaintState>({
        key: historyPaintKey,
        state: {
          init: (_config, state) => next(null, IDLE, state),
          apply: (tr, value, _old, state) => next(tr, value, state),
        },
        props: { decorations: (state) => historyPaintKey.getState(state)?.decorations ?? DecorationSet.empty },
      }),
    ];
  },
});

/** The diff's changes and the one ↑ ↓ reached, as the history bar shows them. */
export function changesOf(state: EditorState): { changes: Change[]; current: number | null } {
  const value = historyPaintKey.getState(state);
  return { changes: value?.changes ?? [], current: value?.current ?? null };
}

/** The blocks to label as moved or retyped (the controller's, for the version shown). */
export function setCarried(editor: Editor, carried: ReadonlyMap<string, Carry['kind']>): void {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(historyPaintKey, { carried } satisfies PaintMeta).setMeta('addToHistory', false));
}

/** Selects the shown tab's change `index` and scrolls it into view; null clears what ↑ ↓ reached. */
export function goToChange(editor: Editor, index: number | null): void {
  if (editor.isDestroyed) return;
  const { changes } = changesOf(editor.state);
  const change = index === null ? undefined : changes[index];
  let tr = editor.state.tr.setMeta(historyPaintKey, { current: change ? index : null } satisfies PaintMeta).setMeta('addToHistory', false);
  if (change) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(change.from + 1, tr.doc.content.size)))).scrollIntoView();
  editor.view.dispatch(tr);
}
