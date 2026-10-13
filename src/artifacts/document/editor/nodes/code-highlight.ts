// Code blocks highlighted as decorations (D2: highlighting lives in the editor, never in the schema or the stored
// text; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Each token becomes an inline decoration carrying
// shiki's light colour and its dark one as `--shiki-dark`, which the theme picks by the app theme. Tokens that are
// still loading leave the block plain and redecorate it when they arrive.
// M9 (the scale gate): a transaction re-highlights only the code blocks its steps touched and maps every other
// decoration, so a keystroke in a 200-page document no longer rebuilds every block's decorations.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { codeTokens, languageOf } from '../../shiki';
import { touchedRanges } from '../touched';

/** The plugin's key: its state is the decorations. */
export const codeHighlightKey = new PluginKey<DecorationSet>('codeHighlight');
const key = codeHighlightKey;
const styleOf = (style: Record<string, string>): string =>
  Object.entries(style)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

/** One code block's token decorations (none while its tokens load, or for an unknown language). */
function blockDecorations(node: PMNode, pos: number, onReady: () => void): Decoration[] {
  const language = languageOf(node.attrs.language);
  const code = node.textContent;
  if (!language || !code) return [];
  const decorations: Decoration[] = [];
  for (const line of codeTokens(code, language, onReady) ?? []) {
    for (const token of line) {
      if (!token.content) continue;
      const from = pos + 1 + token.offset;
      const style = token.htmlStyle ?? (token.color ? { color: token.color } : null);
      if (style) decorations.push(Decoration.inline(from, from + token.content.length, { class: 'doc-code-token', style: styleOf(style) }));
    }
  }
  return decorations;
}

function decorate(doc: PMNode, onReady: () => void): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return !node.isTextblock && !node.isLeaf; // only containers can hold one
    decorations.push(...blockDecorations(node, pos, onReady));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** The previous decorations mapped through `tr`, the code blocks it touched highlighted afresh. */
function redecorate(tr: Transaction, previous: DecorationSet, onReady: () => void): DecorationSet {
  const doc = tr.doc;
  const ranges = touchedRanges(tr);
  if (ranges === null) return decorate(doc, onReady); // too many steps to map (a rebind): every block afresh
  let set = previous.map(tr.mapping, doc);
  // every textblock touched loses its decorations (one that stopped being a code block keeps none), and the code blocks
  // among them are highlighted afresh
  const blocks = new Map<number, PMNode>();
  for (const [from, to] of ranges) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) blocks.set(pos, node);
      return !node.isTextblock && !node.isLeaf;
    });
  }
  for (const [pos, node] of blocks) {
    set = set.remove(set.find(pos, pos + node.nodeSize));
    if (node.type.name === 'codeBlock') set = set.add(doc, blockDecorations(node, pos, onReady));
  }
  return set;
}

export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    let view: EditorView | null = null;
    let queued = false;
    // tokens arrived: redecorate once, on the next tick, if the editor still exists
    const onReady = () => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, 'refresh'));
      }, 0);
    };
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => decorate(state.doc, onReady),
          // tokens that arrived (`refresh`) may be any block's: all of them; an edit: the blocks it touched
          apply: (tr, value, _old, state) => (tr.getMeta(key) ? decorate(state.doc, onReady) : tr.docChanged ? redecorate(tr, value, onReady) : value),
        },
        props: { decorations: (state) => key.getState(state) },
        view: (editorView) => {
          view = editorView;
          return {
            destroy: () => {
              view = null;
            },
          };
        },
      }),
    ];
  },
});
