// The interim range of a dictation (E9 execution document, Design §7): one ProseMirror plugin is the single owner of
// where the provisional words stand. A transaction carrying the `dictationKey` meta sets the range (or clears it with
// null); any other edit is classified against it: a step that touches the words themselves means the human is editing
// them, so the range is settled where it stands (`settledByEdit`, dropped on the next transaction) and the edit applies
// on top unchanged; anything else maps the range, its start after and its end before text typed exactly at an edge, so
// that text stays outside. The words draw in the muted colour while the range holds any (tokens only).
//
// The functions below are the controller's transactions over the range: partials replace it unrecorded (undo never
// steps through provisional words), the final removes it unrecorded and then inserts the text as one history step of
// its own, and cancel removes it unrecorded.
import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, type ResolvedPos, type Schema } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { JSONContent } from '@tiptap/core';

export interface InterimRange {
  from: number;
  to: number;
  settledByEdit: boolean;
}

export const dictationKey = new PluginKey<InterimRange | null>('composer-dictation');
export const INTERIM_CLASS = 'text-fg-muted';

type RangeMeta = { from: number; to: number } | null;

// Whether a changed range of a step (`start`..`end` in the document before it) touches the words: it overlaps them, or
// inserts strictly inside them.
const touches = (start: number, end: number, from: number, to: number) => (start === end ? start > from && start < to : start < to && end > from);

function apply(tr: Transaction, value: InterimRange | null): InterimRange | null {
  const meta = tr.getMeta(dictationKey) as RangeMeta | undefined;
  if (meta !== undefined) return meta && { from: meta.from, to: meta.to, settledByEdit: false };
  if (value === null || value.settledByEdit) return null;
  if (!tr.docChanged) return value;
  let { from, to } = value;
  for (const map of tr.mapping.maps) {
    let touched = false;
    map.forEach((start, end) => {
      if (touches(start, end, from, to)) touched = true;
    });
    if (touched) return { from, to, settledByEdit: true };
    const mappedFrom = map.map(from, 1);
    to = Math.max(mappedFrom, map.map(to, -1));
    from = mappedFrom;
  }
  return { from, to, settledByEdit: false };
}

export const DictationInterim = Extension.create({
  name: 'composerDictation',
  addProseMirrorPlugins() {
    return [
      new Plugin<InterimRange | null>({
        key: dictationKey,
        state: { init: () => null, apply: (tr, value) => apply(tr, value) },
        props: {
          decorations: (state) => {
            const range = dictationKey.getState(state);
            if (!range || range.settledByEdit || range.to <= range.from) return null;
            return DecorationSet.create(state.doc, [Decoration.inline(range.from, range.to, { class: INTERIM_CLASS })]);
          },
        },
      }),
    ];
  },
});

export const interimOf = (state: EditorState): InterimRange | null => dictationKey.getState(state) ?? null;

export const inlineFragment = (schema: Schema, content: JSONContent[]): Fragment => Fragment.fromArray(content.map((node) => schema.nodeFromJSON(node)));

// Where a dictation's words start: the selection's end, normalised into a text block. A selection ending at a block or
// document boundary (Select All's AllSelection) starts at the end of the last text block before it instead, where inline
// words fit as they are; inserted at the boundary they would grow a wrapper paragraph the range does not cover.
export const dictationStart = (state: EditorState): number => startAfter(state.selection);

function startAfter(selection: Selection): number {
  const $end = selection.$to;
  if ($end.parent.inlineContent) return $end.pos;
  return (Selection.findFrom($end, -1, true) ?? Selection.near($end, -1)).from;
}

// Dictated text after a word or a chip gets one leading space; none at the start of a line or after whitespace.
export function needsLeadingSpace(state: EditorState, at: number): boolean {
  const before = state.doc.resolve(at).nodeBefore;
  if (!before) return false;
  if (before.isText) return !/\s$/.test(before.text ?? '');
  return before.type.name !== 'hardBreak'; // an atom (a mention, a pasted chip) reads as a word
}

const unrecorded = (tr: Transaction) => tr.setMeta('addToHistory', false);

// The selection the human sees, when ProseMirror has not read it yet: a key handled ahead of ProseMirror's own keydown
// (C5's capture-phase dispatcher) runs before it flushes the DOM selection the last arrow keys moved, so the state's
// can be several keystrokes stale. When the window's selection lies inside the editor and is not simply how the state's
// selection is drawn, it becomes the state's selection (unrecorded); a selection the DOM does draw stands as it is
// (Select All's AllSelection, a chip's NodeSelection).
export function syncSelectionFromDOM(view: EditorView): void {
  const dom = view.dom.ownerDocument.getSelection();
  const anchor = dom?.anchorNode;
  const focus = dom?.focusNode;
  if (!dom || !anchor || !focus || !view.dom.contains(anchor) || !view.dom.contains(focus)) return;
  const read = readSelection(view, dom, anchor, focus);
  if (!drawnAs(read, view.state.selection)) view.dispatch(unrecorded(view.state.tr.setSelection(read)));
}

// The DOM selection as a document selection, read the way ProseMirror's own (internal) `selectionFromDOM` does over the
// public `posAtDOM`: positions with bias 1, and a caret inside a selectable atom's node view (a pasted chip), off its
// edges, selects the atom; inside a mention (not selectable) bias 1 reads it as the position after the chip. A caret
// between blocks (on the editor root) moves back into the text block before it, where `startAfter` would put the words,
// rather than forward into the next one.
function readSelection(view: EditorView, dom: globalThis.Selection, anchor: Node, focus: Node): Selection {
  const { doc } = view.state;
  const $head = doc.resolve(view.posAtDOM(focus, dom.focusOffset, 1));
  if (!dom.isCollapsed) return TextSelection.between(doc.resolve(view.posAtDOM(anchor, dom.anchorOffset, 1)), $head);
  const atom = atomHolding(view, $head, focus, dom.focusOffset);
  if (atom !== null) return NodeSelection.create(doc, atom);
  if ($head.parent.inlineContent) return TextSelection.between($head, $head);
  return Selection.findFrom($head, -1, true) ?? Selection.near($head);
}

// The position of the selectable atom beside `$head` whose node view holds the DOM caret away from its edges, if any.
function atomHolding(view: EditorView, $head: ResolvedPos, focus: Node, offset: number): number | null {
  const { nodeBefore, nodeAfter, pos: at } = $head;
  const beside = [nodeBefore && ([nodeBefore, at - nodeBefore.nodeSize] as const), nodeAfter && ([nodeAfter, at] as const)];
  for (const [node, pos] of beside.filter((entry) => entry !== null)) {
    const nodeDOM = view.nodeDOM(pos);
    if (!node.isAtom || !NodeSelection.isSelectable(node) || !nodeDOM?.contains(focus)) continue;
    if (!node.isInline || !onEdge(focus, offset, nodeDOM)) return pos;
  }
  return null;
}

// Whether a DOM position sits at the very start or end of `outer`, however deep inside it.
function onEdge(node: Node, offset: number, outer: Node): boolean {
  let atStart = offset === 0;
  let atEnd = offset === (node.nodeType === node.TEXT_NODE ? (node.nodeValue ?? '').length : node.childNodes.length);
  for (let at = node; atStart || atEnd; ) {
    if (at === outer) return true;
    const parent = at.parentNode;
    if (!parent) return false;
    const index = Array.prototype.indexOf.call(parent.childNodes, at);
    atStart &&= index === 0;
    atEnd &&= index === parent.childNodes.length - 1;
    at = parent;
  }
  return false;
}

// Whether `read` is how the DOM draws `selection`: the same ends, or the ends it has as a text selection (an
// AllSelection is drawn over the first and last text positions).
const drawnAs = (read: Selection, selection: Selection) =>
  [selection, TextSelection.between(selection.$anchor, selection.$head)].some((s) => s.anchor === read.anchor && s.head === read.head);

export function openInterim(view: EditorView, at: number): void {
  view.dispatch(unrecorded(view.state.tr.setMeta(dictationKey, { from: at, to: at } satisfies RangeMeta)));
}

export function replaceInterim(view: EditorView, content: Fragment): void {
  const range = interimOf(view.state);
  if (!range || range.settledByEdit) return;
  const tr = view.state.tr.replaceWith(range.from, range.to, content);
  const to = range.from + content.size;
  tr.setMeta(dictationKey, { from: range.from, to } satisfies RangeMeta).setSelection(TextSelection.create(tr.doc, to));
  view.dispatch(unrecorded(tr));
}

// Removes the interim words (unrecorded) and inserts the final text in their place as its own history step.
export function settleFinal(view: EditorView, content: Fragment): void {
  const range = interimOf(view.state);
  if (!range || range.settledByEdit) return;
  view.dispatch(unrecorded(view.state.tr.delete(range.from, range.to).setMeta(dictationKey, null)));
  if (content.size === 0) return;
  const tr = closeHistory(view.state.tr).insert(range.from, content);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, range.from + content.size)));
}

// Ends the range: the words removed (`remove`), or left where they stand as ordinary text.
export function closeInterim(view: EditorView, remove: boolean): void {
  const range = interimOf(view.state);
  if (!range) return;
  const tr = view.state.tr.setMeta(dictationKey, null);
  if (remove && !range.settledByEdit && range.to > range.from) tr.delete(range.from, range.to);
  view.dispatch(unrecorded(tr));
}
