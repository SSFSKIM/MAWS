// Code blocks highlighted as decorations (D2: highlighting lives in the editor, never in the schema or the stored
// text; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Each token becomes an inline decoration carrying
// shiki's light colour and its dark one as `--shiki-dark`, which the theme picks by the app theme. Tokens that are
// still loading leave the block plain and redecorate it when they arrive.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { codeTokens, languageOf } from './shiki';

const key = new PluginKey<DecorationSet>('codeHighlight');
const styleOf = (style: Record<string, string>): string =>
  Object.entries(style)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

function decorate(doc: PMNode, onReady: () => void): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return !node.isTextblock && !node.isLeaf; // only containers can hold one
    const language = languageOf(node.attrs.language);
    const code = node.textContent;
    if (!language || !code) return false;
    const lines = codeTokens(code, language, onReady);
    for (const line of lines ?? []) {
      for (const token of line) {
        if (!token.content) continue;
        const from = pos + 1 + token.offset;
        const style = token.htmlStyle ?? (token.color ? { color: token.color } : null);
        if (style) decorations.push(Decoration.inline(from, from + token.content.length, { class: 'doc-code-token', style: styleOf(style) }));
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
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
          apply: (tr, value, _old, state) => (tr.docChanged || tr.getMeta(key) ? decorate(state.doc, onReady) : value),
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
