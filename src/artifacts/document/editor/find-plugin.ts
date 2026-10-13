// Find in the active tab (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): a decoration plugin over the
// editor's text. Matches are case-insensitive, run across marks within one textblock, and never across a block
// boundary or an inline node (a chip, an image, inline math). The current match is selected and scrolled to; the
// matches follow the document as it changes, local or remote.
import { Extension, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface Match {
  from: number;
  to: number;
}
interface FindPluginState {
  query: string;
  matches: Match[];
  current: number; // -1 without matches
  decorations: DecorationSet;
}
export interface FindSummary {
  query: string;
  count: number;
  current: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    find: {
      /** Finds `query` (empty: clears), current at the first match at or after the selection. */
      setFindQuery: (query: string) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

const findKey = new PluginKey<FindPluginState>('find');
type Meta = { query: string } | { step: 1 | -1 };

const EMPTY: FindPluginState = { query: '', matches: [], current: -1, decorations: DecorationSet.empty };
// An inline node stands in the searchable text as one character no query contains.
const BREAK = '￿';

// Case-insensitive by Unicode's simple case folding, over the text as written: each match's offsets are the block's own
// (lower-casing a copy can change its length, 'İ' to 'i̇', and so misplace them).
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchesIn(doc: PMNode, query: string): Match[] {
  if (!query) return [];
  const needle = new RegExp(escapeRegExp(query), 'giu');
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const at: number[] = []; // the document position of each character of `text`
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const chars = child.isText ? child.text! : BREAK;
      for (let i = 0; i < chars.length; i += 1) at.push(start + i);
      text += chars;
    });
    needle.lastIndex = 0;
    for (let found = needle.exec(text); found; found = needle.exec(text)) {
      matches.push({ from: at[found.index], to: at[found.index + found[0].length - 1] + 1 });
      // Overlapping matches count, as each start is a place to step to; the next try starts one code point on, since a
      // 'u' regexp started inside a surrogate pair backs up to the pair and finds this match again, for ever.
      needle.lastIndex = found.index + (text.codePointAt(found.index)! > 0xffff ? 2 : 1);
    }
    return false;
  });
  return matches;
}

function build(doc: PMNode, query: string, current: number, matches = matchesIn(doc, query)): FindPluginState {
  const index = matches.length === 0 ? -1 : Math.min(Math.max(current, 0), matches.length - 1);
  const decorations = DecorationSet.create(
    doc,
    matches.map((match, i) => Decoration.inline(match.from, match.to, { class: i === index ? 'find-match find-match-current' : 'find-match' })),
  );
  return { query, matches, current: index, decorations };
}

const firstAtOrAfter = (matches: Match[], pos: number): number => {
  const i = matches.findIndex((match) => match.from >= pos);
  return i < 0 ? 0 : i;
};

/** The find state as the find bar shows it. */
export function findState(state: EditorState): FindSummary {
  const find = findKey.getState(state) ?? EMPTY;
  return { query: find.query, count: find.matches.length, current: find.current };
}

export const Find = Extension.create({
  name: 'find',

  addCommands() {
    // A step moves the current match and selects it in the same transaction (no document change, so the positions
    // hold).
    const step =
      (by: 1 | -1) =>
      () =>
      ({ tr, state, dispatch }: CommandProps) => {
        const find = findKey.getState(state);
        if (!find || find.matches.length === 0) return false;
        const match = find.matches[(find.current + by + find.matches.length) % find.matches.length];
        if (dispatch) tr.setMeta(findKey, { step: by } satisfies Meta).setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
        return true;
      };
    return {
      setFindQuery:
        (query: string) =>
        ({ tr }: CommandProps) => {
          tr.setMeta(findKey, { query } satisfies Meta);
          return true;
        },
      findNext: step(1),
      findPrevious: step(-1),
      clearFind:
        () =>
        ({ tr }: CommandProps) => {
          tr.setMeta(findKey, { query: '' } satisfies Meta);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindPluginState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(findKey) as Meta | undefined;
            if (meta && 'query' in meta) {
              if (!meta.query) return EMPTY;
              const matches = matchesIn(state.doc, meta.query);
              return build(state.doc, meta.query, firstAtOrAfter(matches, state.selection.from), matches);
            }
            if (meta && 'step' in meta) {
              const n = value.matches.length;
              return n === 0 ? value : build(state.doc, value.query, (value.current + meta.step + n) % n, value.matches);
            }
            if (!tr.docChanged || !value.query) return value;
            return build(state.doc, value.query, value.current);
          },
        },
        props: { decorations: (state) => findKey.getState(state)?.decorations ?? DecorationSet.empty },
      }),
    ];
  },
});
