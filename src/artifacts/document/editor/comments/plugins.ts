// The comment plugins of the document editor (D9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4 as
// amended by S5, the parent's Decision Log 31): copied and typed from P3-0's `s5/lib/comments.mjs`, the editor half
// (the model is threads.ts).
//
// - Commenting a selection writes the thread first, then the mark with `tr.addMark` (Decision Log 31's order: the host
//   strips a mark without a thread, so a crash between the two leaves a thread without a mark, never an invisible
//   mark; Tiptap's `setMark` would copy an overlapping comment's attributes into the new one). Neither write is undoable:
//   the mark's transaction says `addToHistory: false`, and the threads map is outside the binding's undo scope.
// - The display decorates the live text of each open thread with `class="comment comment-<threadId>"` (ids in classes,
//   never attributes, since overlapping decorations merge and an attribute would keep only one), the active thread's
//   with `comment-active` too; a resolved thread's mark stays in the text, undecorated. The mark's own span draws
//   nothing. Decorations are kept per text node and rebuilt only in the textblocks a transaction touched, so a keystroke
//   in a long document costs one block; a change of the threads map or of the active thread rebuilds them all.
// - The paste dedupe (Outline's rule): a pasted comment mark is kept only when its thread is in this document and no
//   live text carries it, so a cut followed by a paste moves the comment, a copy pastes plain text, and another
//   document's mark, or an external `span[data-thread]`, never comes in. A drag-move counts the dragged range as gone,
//   since ProseMirror transforms the dragged slice before it deletes the source.
import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Actor } from '@shared/artifacts/actor';
import type { Doc } from '../../../yjs';
import { relativePositionToJSON } from '../../../yjs/document';
import { resolvedPositionsToRelativePositions } from '../../../yjs/prosemirror';
import { listTabs, tabBody } from '../../tabs';
import { addThread, getThread, liveIdsY, observeThreads, threadStatus } from '../../threads';

/** The origin of the editor's own threads-map writes (no binding's: never in the editor's undo). */
export const COMMENTS_ORIGIN = 'document-comments';

/** threadId → its live ranges in a ProseMirror doc, adjacent text merged. */
export function liveRanges(doc: PMNode): Map<string, Array<{ from: number; to: number }>> {
  const out = new Map<string, Array<{ from: number; to: number }>>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      const id = threadOf(mark);
      if (id === null) continue;
      const list = out.get(id) ?? [];
      const last = list.at(-1);
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else list.push({ from: pos, to: pos + node.nodeSize });
      out.set(id, list);
    }
  });
  return out;
}

const threadOf = (mark: Mark): string | null => (mark.type.name === 'comment' && typeof mark.attrs.threadId === 'string' ? mark.attrs.threadId : null);

export interface NewComment {
  threadId: string;
  tabId: string;
  by: Actor;
  at: number;
  /** The first message, when the comment was written with one. */
  body?: string;
}

/**
 * Comments the editor's selection: the thread (its quote, its anchor from the selection, its block and tab), then the
 * mark. Null, writing nothing, for a selection with no text.
 */
export function commentSelection(editor: Editor, doc: Doc, comment: NewComment): { threadId: string; quote: string } | null {
  const { state, view } = editor;
  const { from, to, $from } = state.selection;
  const quote = state.doc.textBetween(from, to, '\n');
  if (from === to || quote.trim() === '') return null;
  const top = $from.depth >= 1 ? $from.before(1) : from; // the top-level block's gap in the body survives the block
  const [start, end, block] = resolvedPositionsToRelativePositions(view, [state.doc.resolve(from), state.doc.resolve(to), state.doc.resolve(top)]).map((rpos) =>
    rpos == null ? null : relativePositionToJSON(rpos),
  );
  let blockId: string | null = null;
  for (let depth = $from.depth; depth >= 1 && blockId === null; depth -= 1) {
    const id: unknown = $from.node(depth).attrs.id;
    if (typeof id === 'string') blockId = id;
  }
  addThread(doc, { threadId: comment.threadId, tabId: comment.tabId, blockId, quote, anchor: { start, end, block }, by: comment.by, at: comment.at, ...(comment.body != null && { body: comment.body }) }, COMMENTS_ORIGIN);
  view.dispatch(state.tr.addMark(from, to, state.schema.marks.comment!.create({ threadId: comment.threadId })).setMeta('addToHistory', false));
  return { threadId: comment.threadId, quote };
}

// ── the display ──
export const commentDisplayKey = new PluginKey<DisplayState>('commentDisplay');

interface DisplayState {
  active: string | null;
  decorations: DecorationSet;
}
type DisplayMeta = { active: string | null } | { threads: true };

const CLASS_SAFE = /^[\w-]+$/;

// The decorations of the open threads' text in [from, to), one per text node.
function decorate(doc: PMNode, from: number, to: number, ydoc: Doc, active: string | null, out: Decoration[]): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const ids = node.marks.map(threadOf).filter((id): id is string => id !== null && CLASS_SAFE.test(id) && threadStatus(ydoc, id) === 'open');
    if (ids.length > 0) out.push(Decoration.inline(pos, pos + node.nodeSize, { class: ['comment', ...ids.map((id) => `comment-${id}`), ...(active !== null && ids.includes(active) ? ['comment-active'] : [])].join(' ') }));
    return false;
  });
}

function rebuild(doc: PMNode, ydoc: Doc, active: string | null): DecorationSet {
  const out: Decoration[] = [];
  decorate(doc, 0, doc.content.size, ydoc, active, out);
  return DecorationSet.create(doc, out);
}

// The textblocks a transaction changed, in its resulting doc: each step's range mapped through the steps after it. A
// mark or attribute step maps nothing (its map is empty), so its own range is read from the step.
function touchedBlocks(tr: Transaction): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const { doc, mapping } = tr;
  const touch = (index: number, start: number, end: number) => {
    const rest = mapping.slice(index + 1);
    const from = Math.max(0, Math.min(rest.map(start, -1), doc.content.size));
    const to = Math.max(from, Math.min(rest.map(end, 1), doc.content.size));
    doc.nodesBetween(from, Math.min(to + 1, doc.content.size), (node, pos) => {
      if (!node.isTextblock) return true;
      out.push([pos, pos + node.nodeSize]);
      return false;
    });
  };
  tr.steps.forEach((step, index) => {
    let mapped = false;
    tr.mapping.maps[index]!.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      mapped = true;
      touch(index, newStart, newEnd);
    });
    if (mapped) return;
    const { from, to, pos } = step as { from?: unknown; to?: unknown; pos?: unknown };
    if (typeof from === 'number' && typeof to === 'number') touch(index, from, to);
    else if (typeof pos === 'number') touch(index, pos, pos + 1);
  });
  return out;
}

function display(ydoc: Doc): Plugin<DisplayState> {
  return new Plugin<DisplayState>({
    key: commentDisplayKey,
    state: {
      init: (_config, state) => ({ active: null, decorations: rebuild(state.doc, ydoc, null) }),
      apply(tr, old, _oldState, state) {
        const meta = tr.getMeta(commentDisplayKey) as DisplayMeta | undefined;
        if (meta) {
          const active = 'active' in meta ? meta.active : old.active;
          return { active, decorations: rebuild(state.doc, ydoc, active) };
        }
        if (!tr.docChanged) return old;
        let decorations = old.decorations.map(tr.mapping, tr.doc);
        for (const [from, to] of touchedBlocks(tr)) {
          const fresh: Decoration[] = [];
          decorate(tr.doc, from, to, ydoc, old.active, fresh);
          decorations = decorations.remove(decorations.find(from, to)).add(tr.doc, fresh);
        }
        return { active: old.active, decorations };
      },
    },
    props: { decorations: (state) => commentDisplayKey.getState(state)?.decorations },
    view: (view) => {
      // the threads map is outside the bound fragment: redraw after it changes (a resolve, a reopen, a new thread)
      let queued = false;
      const stop = observeThreads(ydoc, () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(commentDisplayKey, { threads: true } satisfies DisplayMeta).setMeta('addToHistory', false));
        });
      });
      return { destroy: stop };
    },
  });
}

/** The thread the editor shows as active (its card or its row in the rail), or null. */
export const activeThread = (state: EditorState): string | null => commentDisplayKey.getState(state)?.active ?? null;

// ── the paste dedupe ──
/** The fragment with every comment mark `keep` refuses removed, at every depth. */
export function stripCommentMarks(fragment: Fragment, keep: (threadId: string) => boolean): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    const marks = node.marks.filter((mark) => {
      const id = threadOf(mark);
      return mark.type.name !== 'comment' || (id !== null && keep(id));
    });
    nodes.push(node.isText ? node.mark(marks) : node.copy(stripCommentMarks(node.content, keep)).mark(marks));
  });
  return Fragment.fromArray(nodes);
}

function paste(ydoc: Doc, tabId: string | null): Plugin {
  return new Plugin({
    key: new PluginKey('commentPaste'),
    props: {
      transformPasted: (slice: Slice, view: EditorView) => {
        let doc = view.state.doc;
        const dragging = view.dragging;
        if (dragging?.move) {
          // a node drag carries its NodeSelection (prosemirror-view's Dragging; its declaration omits the field)
          const source = (dragging as { node?: { from: number; to: number } }).node ?? view.state.selection;
          doc = view.state.tr.delete(source.from, source.to).doc;
        }
        const live = new Set(liveRanges(doc).keys());
        for (const tab of listTabs(ydoc)) {
          if (tab.id === tabId) continue; // this tab is the editor's doc, as it will read after a move
          const body = tabBody(ydoc, tab.id);
          if (body) for (const id of liveIdsY(body)) live.add(id);
        }
        const keep = (id: string) => !live.has(id) && getThread(ydoc, id) !== null;
        return new Slice(stripCommentMarks(slice.content, keep), slice.openStart, slice.openEnd);
      },
    },
  });
}

export interface CommentsOptions {
  /** The replica's doc, whose threads map the editor reads and writes; none, no comment plugins. */
  doc: Doc | null;
  /** The tab this editor binds (the dedupe reads the other tabs from the doc). */
  tabId: string | null;
  /** The paste dedupe; off only for S5's contrast. */
  paste: boolean;
  /** Mod-Alt-M: comment the selection (the editor's surface decides what that opens). */
  onComment: (() => boolean) | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comments: {
      /** Shows a thread as active (its passage drawn as such), or none. */
      setActiveThread: (threadId: string | null) => ReturnType;
    };
  }
}

export const Comments = Extension.create<CommentsOptions>({
  name: 'comments',
  addOptions: () => ({ doc: null, tabId: null, paste: true, onComment: null }),
  addCommands() {
    return {
      setActiveThread:
        (threadId) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(commentDisplayKey, { active: threadId } satisfies DisplayMeta).setMeta('addToHistory', false);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Alt-m': () => this.options.onComment?.() ?? false };
  },
  addProseMirrorPlugins() {
    const { doc, tabId } = this.options;
    if (!doc) return [];
    return [display(doc), ...(this.options.paste ? [paste(doc, tabId)] : [])];
  },
});
