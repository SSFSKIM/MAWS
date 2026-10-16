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
//   in a long document costs one block; a change of the threads map or of the active thread rebuilds them all. A click
//   on an open thread's passage draws that thread active (where passages overlap, the innermost: the shortest at the
//   click, the newest on a tie), and a click on text no open thread covers draws none; the click still places the caret.
// - The paste dedupe (Outline's rule): a pasted comment mark is kept only when its thread is in this document and no
//   live text carries it, so a cut followed by a paste moves the comment, a copy pastes plain text, and another
//   document's mark, or an external `span[data-thread]`, never comes in. A drag-move counts the dragged range as gone,
//   since ProseMirror transforms the dragged slice before it deletes the source.
import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection /* P3-E */, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Actor } from '@shared/artifacts/actor';
import type { Doc, Node as YType } from '../../../yjs'; // P3-E: Node
import { YNode, relativePositionToJSON } from '../../../yjs/document'; // P3-E: YNode
import { resolvedPositionsToRelativePositions } from '../../../yjs/prosemirror';
import { listTabs, tabBody } from '../../tabs';
import { addThread, blockThreads /* P3-E */, getThread, liveIdsY, observeThreads, threadStatus } from '../../threads';
import { touchedRanges } from '../touched';

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

// P3-E start (E2 M4; E's Decision Log 28): a selected block commented whole, when the editor's `blockQuote` names it
/**
 * Comments the selected block (a NodeSelection) with the quote `blockQuote` gives it: the thread with the block
 * discriminant, its block and tab, and no mark. Null, writing nothing, when the selection is not a block or the callback
 * gives no quote for it.
 */
export function commentBlock(editor: Editor, doc: Doc, comment: NewComment, blockQuote: (node: PMNode) => string | undefined): { threadId: string; quote: string } | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || !selection.node.isBlock) return null;
  const blockId: unknown = selection.node.attrs.id;
  const quote = blockQuote(selection.node);
  if (typeof blockId !== 'string' || quote === undefined || quote.trim() === '') return null;
  addThread(doc, { threadId: comment.threadId, tabId: comment.tabId, blockId, quote, anchor: { kind: 'block' }, by: comment.by, at: comment.at, ...(comment.body != null && { body: comment.body }) }, COMMENTS_ORIGIN);
  return { threadId: comment.threadId, quote };
}

/** The open block threads of the doc by their block's id (none walked or drawn when the doc has no block thread). */
function openBlockThreads(ydoc: Doc): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [threadId, blockId] of blockThreads(ydoc)) {
    if (!CLASS_SAFE.test(threadId) || threadStatus(ydoc, threadId) !== 'open') continue;
    out.set(blockId, [...(out.get(blockId) ?? []), threadId]);
  }
  return out;
}

/** The block decorations of the open block threads (`byBlock`): the block's own node, drawn as their comment. */
function decorateBlocks(doc: PMNode, byBlock: ReadonlyMap<string, string[]>, active: string | null): Decoration[] {
  const out: Decoration[] = [];
  if (byBlock.size === 0) return out;
  doc.descendants((node, pos) => {
    const ids = typeof node.attrs.id === 'string' ? byBlock.get(node.attrs.id) : undefined;
    if (ids) out.push(Decoration.node(pos, pos + node.nodeSize, { class: ['comment', ...ids.map((id) => `comment-${id}`), ...(active !== null && ids.includes(active) ? ['comment-active'] : [])].join(' ') }, { blockComment: true }));
    return !node.isTextblock; // a textblock's inline content holds no block
  });
  return out;
}
// P3-E end

// ── the display ──
export const commentDisplayKey = new PluginKey<DisplayState>('commentDisplay');

interface DisplayState {
  active: string | null;
  decorations: DecorationSet;
  /** P3-E: the open block threads by block id, read with the threads map (empty: a keystroke draws no block). */
  blocks: ReadonlyMap<string, string[]>;
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

function rebuild(doc: PMNode, ydoc: Doc, active: string | null): DisplayState {
  const out: Decoration[] = [];
  decorate(doc, 0, doc.content.size, ydoc, active, out);
  const blocks = openBlockThreads(ydoc); // P3-E
  out.push(...decorateBlocks(doc, blocks, active)); // P3-E
  return { active, decorations: DecorationSet.create(doc, out), blocks };
}

// The textblocks a transaction changed, in its resulting doc (`touchedRanges`), or null when the transaction has too
// many steps to map (a rebind): the display is then rebuilt whole.
function touchedBlocks(tr: Transaction): Array<[number, number]> | null {
  const ranges = touchedRanges(tr);
  if (ranges === null) return null;
  const out: Array<[number, number]> = [];
  const { doc } = tr;
  for (const [from, to] of ranges) {
    doc.nodesBetween(from, Math.min(to + 1, doc.content.size), (node, pos) => {
      if (!node.isTextblock) return true;
      out.push([pos, pos + node.nodeSize]);
      return false;
    });
  }
  return out;
}

// The open threads drawn where a click landed: the classes of the display's decoration around its target.
function threadsClicked(target: EventTarget | null, root: HTMLElement): string[] {
  const span = target instanceof Element ? target.closest('.comment') : null;
  if (!span || !root.contains(span)) return [];
  return [...span.classList].filter((name) => name.startsWith('comment-') && name !== 'comment-active').map((name) => name.slice('comment-'.length));
}

// Of overlapping threads at `pos`, the innermost: the shortest live range around it, the newest thread on a tie.
function innermost(doc: PMNode, pos: number, ids: string[], ydoc: Doc): string | null {
  const ranges = liveRanges(doc);
  const extent = (id: string) => {
    const range = ranges.get(id)?.find(({ from, to }) => from <= pos && pos <= to);
    return range ? range.to - range.from : Infinity;
  };
  const created = (id: string) => getThread(ydoc, id)?.createdAt ?? 0;
  return [...ids].sort((a, b) => extent(a) - extent(b) || created(b) - created(a) || (a < b ? -1 : 1))[0] ?? null;
}

function display(ydoc: Doc, onActivate: ((threadId: string) => void) | null): Plugin<DisplayState> {
  return new Plugin<DisplayState>({
    key: commentDisplayKey,
    state: {
      init: (_config, state) => rebuild(state.doc, ydoc, null),
      apply(tr, old, _oldState, state) {
        const meta = tr.getMeta(commentDisplayKey) as DisplayMeta | undefined;
        if (meta) return rebuild(state.doc, ydoc, 'active' in meta ? meta.active : old.active);
        if (!tr.docChanged) return old;
        const blocks = touchedBlocks(tr);
        if (blocks === null) return rebuild(tr.doc, ydoc, old.active);
        let decorations = old.decorations.map(tr.mapping, tr.doc);
        for (const [from, to] of blocks) {
          const fresh: Decoration[] = [];
          decorate(tr.doc, from, to, ydoc, old.active, fresh);
          decorations = decorations.remove(decorations.find(from, to, (spec: { blockComment?: boolean }) => !spec.blockComment /* P3-E */)).add(tr.doc, fresh);
        }
        // P3-E: a block (re)inserted under a commented id is drawn as its comment (a move, an undo of its deletion)
        if (old.blocks.size > 0) {
          const drawn = decorations.find(undefined, undefined, (spec: { blockComment?: boolean }) => spec.blockComment === true);
          decorations = decorations.remove(drawn).add(tr.doc, decorateBlocks(tr.doc, old.blocks, old.active));
        }
        return { active: old.active, decorations, blocks: old.blocks };
      },
    },
    props: {
      decorations: (state) => commentDisplayKey.getState(state)?.decorations,
      handleClick: (view, pos, event) => {
        const ids = threadsClicked(event.target, view.dom);
        const threadId = ids.length === 0 ? null : innermost(view.state.doc, pos, ids, ydoc);
        if (threadId !== activeThread(view.state)) view.dispatch(view.state.tr.setMeta(commentDisplayKey, { active: threadId } satisfies DisplayMeta).setMeta('addToHistory', false));
        if (threadId !== null) onActivate?.(threadId);
        return false;
      },
    },
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

// P3-E start (E2 M4; E's Decision Log 34): an owner's cut and paste of a commented view block is a move. UniqueID gives
// every pasted block a fresh id (B's invariant, kept for every other paste); for a real cut within one artifact the
// pasted view block gets its original id back, in the editor's own transaction, so its thread (never written here) stays
// live, through undo too. A cut of blocks carrying block threads is recorded in this renderer with a one-shot nonce,
// which a native `cut` listener running after ProseMirror's own writes onto the clipboard HTML's `[data-pm-slice]`
// element (copies and plain text stay as B writes them). A paste restores only when its HTML carries the recorded nonce
// and ids, the pasting editor's artifact is the record's, every recorded original is live nowhere in the document, and
// the record is unconsumed. A copy, a drag or a cut with no threaded block clears the record; another window, another
// artifact or another application restores nothing (a renderer-local record: cross-window carry is a known limit).
const CUT_ATTR = 'data-maws-cut';
interface CutRecord {
  nonce: string;
  artifactId: string;
  /** The cut blocks with block threads, in document order: the id and everything but the id, which a paste matches. */
  blocks: Array<{ blockId: string; key: string }>;
}
let lastCut: CutRecord | null = null;
const keyOf = (node: PMNode): string => `${node.type.name}:${JSON.stringify({ ...node.attrs, id: null })}`;

/** Every block id the document holds, in any tab. */
function liveBlockIds(ydoc: Doc): Set<string> {
  const ids = new Set<string>();
  const walk = (node: YType): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof YNode)) continue;
      const id: unknown = child.getAttr('id');
      if (typeof id === 'string') ids.add(id);
      walk(child);
    }
  };
  for (const tab of listTabs(ydoc)) {
    const body = tabBody(ydoc, tab.id);
    if (body) walk(body);
  }
  return ids;
}

function blockCarry(ydoc: Doc, artifactId: string): Plugin {
  let stamp: string | null = null; // the nonce this editor's cut, in progress, stamps on the clipboard
  // a qualifying paste in progress: the originals to restore, and the ids the doc held before it
  let armed: { blocks: CutRecord['blocks']; before: Set<string> } | null = null;
  const docIds = (doc: PMNode): Set<string> => {
    const ids = new Set<string>();
    doc.descendants((node) => {
      if (typeof node.attrs.id === 'string') ids.add(node.attrs.id);
      return !node.isTextblock;
    });
    return ids;
  };
  return new Plugin({
    key: new PluginKey('commentBlockCarry'),
    props: {
      handleDOMEvents: {
        cut: (view) => {
          const threaded = new Set(blockThreads(ydoc).values());
          const { from, to } = view.state.selection;
          const blocks: CutRecord['blocks'] = [];
          view.state.doc.nodesBetween(from, to, (node, pos) => {
            if (typeof node.attrs.id === 'string' && threaded.has(node.attrs.id) && pos >= from && pos + node.nodeSize <= to) blocks.push({ blockId: node.attrs.id, key: keyOf(node) });
            return !node.isTextblock;
          });
          lastCut = blocks.length > 0 ? { nonce: crypto.randomUUID(), artifactId, blocks } : null;
          stamp = lastCut?.nonce ?? null;
          return false;
        },
        copy: () => {
          lastCut = null;
          return false;
        },
        dragstart: () => {
          lastCut = null;
          return false;
        },
        paste: (view, event) => {
          const html = (event as ClipboardEvent).clipboardData?.getData('text/html') ?? '';
          const nonce = new RegExp(`${CUT_ATTR}="([\\w-]+)"`).exec(html)?.[1];
          const cut = lastCut;
          if (!cut || !nonce || nonce !== cut.nonce || cut.artifactId !== artifactId) return false;
          const live = liveBlockIds(ydoc);
          const carried = cut.blocks.every(({ blockId }) => html.includes(`data-id="${blockId}"`) && !live.has(blockId));
          if (!carried) return false;
          lastCut = null; // consumed: a second paste is B's fresh paste
          armed = { blocks: cut.blocks, before: docIds(view.state.doc) };
          return false;
        },
      },
    },
    // after UniqueID has minted the pasted blocks' ids, in the same dispatch (one undo step with the paste)
    appendTransaction: (transactions, _old, state) => {
      if (!armed || !transactions.some((tr) => tr.docChanged)) return null;
      const pasted: Array<{ node: PMNode; pos: number }> = [];
      let pending = false;
      const keys = new Set(armed.blocks.map((block) => block.key));
      state.doc.descendants((node, pos) => {
        if (keys.has(keyOf(node))) {
          if (node.attrs.id === null) pending = true;
          else if (!armed!.before.has(node.attrs.id as string)) pasted.push({ node, pos });
        }
        return !node.isTextblock;
      });
      if (pending || pasted.length === 0) return null; // UniqueID mints in its own append, before this one sees it
      const present = docIds(state.doc);
      const tr = state.tr;
      const used = new Set<number>();
      for (const { blockId, key } of armed.blocks) {
        const at = pasted.findIndex((candidate, k) => !used.has(k) && keyOf(candidate.node) === key);
        if (at < 0 || present.has(blockId)) continue;
        used.add(at);
        tr.setNodeAttribute(pasted[at]!.pos, 'id', blockId);
      }
      armed = null;
      return tr.steps.length > 0 ? tr : null;
    },
    view: (view) => {
      // after ProseMirror's own cut handler has written the clipboard: the cut's HTML carries its nonce
      const onCut = (event: ClipboardEvent) => {
        const nonce = stamp;
        stamp = null;
        const data = event.clipboardData;
        if (!nonce || !data) return;
        const html = data.getData('text/html');
        if (html.includes('data-pm-slice="')) data.setData('text/html', html.replace('data-pm-slice="', `${CUT_ATTR}="${nonce}" data-pm-slice="`));
      };
      view.dom.addEventListener('cut', onCut);
      return {
        update: () => {
          armed = null; // a paste that restored nothing by now restores nothing
        },
        destroy: () => view.dom.removeEventListener('cut', onCut),
      };
    },
  });
}
// P3-E end

export interface CommentsOptions {
  /** P3-E (E2 M4; E's Decision Log 34): the artifact this editor shows; a cut view block pasted within it keeps its id. */
  artifactId?: string | null;
  /** P3-E (E2 M4): the quote of a selected block commented whole; absent, or undefined for a node, only text is commented. */
  blockQuote?: ((node: PMNode) => string | undefined) | null;
  /** The replica's doc, whose threads map the editor reads and writes; none, no comment plugins. */
  doc: Doc | null;
  /** The tab this editor binds (the dedupe reads the other tabs from the doc). */
  tabId: string | null;
  /** The paste dedupe; off only for S5's contrast. */
  paste: boolean;
  /** Mod-Alt-M: comment the selection (the editor's surface decides what that opens). */
  onComment: (() => boolean) | null;
  /** A click on a passage drew its thread active (the editor shows it in the rail). */
  onActivate: ((threadId: string) => void) | null;
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
  addOptions: () => ({ doc: null, tabId: null, paste: true, onComment: null, onActivate: null }),
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
    return [display(doc, this.options.onActivate), ...(this.options.paste ? [paste(doc, tabId)] : []), ...(this.options.artifactId ? [blockCarry(doc, this.options.artifactId)] : []) /* P3-E */];
  },
});
