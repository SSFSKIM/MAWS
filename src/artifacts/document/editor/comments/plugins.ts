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
//   P4-B1 (the P4 spec §4.3 [binding]: only the human activates a thread): the local caret moving into a passage (a
//   selection-only transaction of this editor, never a binding transaction) draws its thread active too, and leaving
//   it by the keyboard keeps the thread (Overleaf's sticky pin, for the caret alone; LC-1 item 5 re-bases); a remote
//   edit maps the decorations and keeps `active`, a threads-map change rebuilds with the old `active`, awareness never
//   reaches this plugin. ⌃⌘ then N, P or E then C (Docs' chords) go to the next or previous passage after the caret, or
//   enter the current one (the editor's surface focuses its card). The pin (Docs' sticky stack, LC-1 item 3 in
//   docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md): the last thread the human activated, which the margin's
//   stack is walked from; kept when the active thread clears, dropped when that thread is no longer open. A click on a
//   passage also puts the caret at the click (Surprise 7: the activation's redraw would otherwise write ProseMirror's
//   stale state selection back over the native caret when the click's `selectionchange` has not been read yet).
// - The paste dedupe (Outline's rule): a pasted comment mark is kept only when its thread is in this document and no
//   live text carries it, so a cut followed by a paste moves the comment, a copy pastes plain text, and another
//   document's mark, or an external `span[data-thread]`, never comes in. A drag-move counts the dragged range as gone,
//   since ProseMirror transforms the dragged slice before it deletes the source.
import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection /* P3-E */, Plugin, PluginKey, TextSelection /* P4-B1 */, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Actor } from '@shared/artifacts/actor';
import { isBindingTransaction /* P4-B1 */, type Doc, type Node as YType } from '../../../yjs'; // P3-E: Node
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
    if (ids) out.push(Decoration.node(pos, pos + node.nodeSize, { class: ['comment', ...ids.map((id) => `comment-${id}`), ...(active !== null && ids.includes(active) ? ['comment-active'] : [])].join(' ') }, { blockComment: true, threads: ids.join(' ') } satisfies DisplaySpec /* P4-B1: threads */));
    return !node.isTextblock; // a textblock's inline content holds no block
  });
  return out;
}
// P3-E end

// ── the display ──
export const commentDisplayKey = new PluginKey<DisplayState>('commentDisplay');

interface DisplayState {
  active: string | null;
  /** P4-B1: what drew `active` (null for none, or for a rebuild that kept it). */
  cause: ActivationCause | null;
  /** P4-B1: the last thread the human activated while it stays open (the margin's stack is walked from it). */
  pinned: string | null;
  decorations: DecorationSet;
  /** P3-E: the open block threads by block id, read with the threads map (empty: a keystroke draws no block). */
  blocks: ReadonlyMap<string, string[]>;
}
/** P4-B1: what drew a thread active (the editor's surface opens the rail on a click in a narrow body, never on the caret). */
export type ActivationCause = 'click' | 'caret' | 'key';
type DisplayMeta = { active: string | null; cause?: ActivationCause } | { threads: true };

const CLASS_SAFE = /^[\w-]+$/;

// P4-B1: a display decoration's spec names the open threads it draws, space-separated (the margin reads where each is
// drawn from them). A string, so a redraw of the same threads gives an equal spec: ProseMirror compares specs
// shallowly and re-patches a node whose decorations are not equal
interface DisplaySpec {
  threads: string;
  blockComment?: true;
}

// The decorations of the open threads' text in [from, to), one per text node.
function decorate(doc: PMNode, from: number, to: number, ydoc: Doc, active: string | null, out: Decoration[]): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const ids = node.marks.map(threadOf).filter((id): id is string => id !== null && CLASS_SAFE.test(id) && threadStatus(ydoc, id) === 'open');
    if (ids.length > 0) out.push(Decoration.inline(pos, pos + node.nodeSize, { class: ['comment', ...ids.map((id) => `comment-${id}`), ...(active !== null && ids.includes(active) ? ['comment-active'] : [])].join(' ') }, { threads: ids.join(' ') } satisfies DisplaySpec /* P4-B1 */));
    return false;
  });
}

function rebuild(doc: PMNode, ydoc: Doc, active: string | null, cause: ActivationCause | null, pinned: string | null): DisplayState {
  const out: Decoration[] = [];
  decorate(doc, 0, doc.content.size, ydoc, active, out);
  const blocks = openBlockThreads(ydoc); // P3-E
  out.push(...decorateBlocks(doc, blocks, active)); // P3-E
  // P4-B1: a resolve reaches the display as a rebuild (the threads map's redraw), which drops a pin no longer open
  return { active, cause, decorations: DecorationSet.create(doc, out), blocks, pinned: pinned !== null && threadStatus(ydoc, pinned) === 'open' ? pinned : null };
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

// P4-B1: the open threads whose mark the caret sits in (the position's marks: at a boundary, the side `inclusive` names).
function threadsAtCaret(state: EditorState, ydoc: Doc): string[] {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return [];
  return selection.$from
    .marks()
    .map(threadOf)
    .filter((id): id is string => id !== null && CLASS_SAFE.test(id) && threadStatus(ydoc, id) === 'open');
}

function display(ydoc: Doc, onActivate: ((threadId: string, cause: ActivationCause) => void) | null): Plugin<DisplayState> {
  return new Plugin<DisplayState>({
    key: commentDisplayKey,
    // P4-B1: the local caret entering a passage draws its thread active (a selection-only transaction of this editor:
    // arrows, a click's own selection, Home and End; never the binding's remote update, never a document change); the
    // surface is told from the view's update, where the state is settled
    appendTransaction(transactions, oldState, newState) {
      if (oldState.selection.eq(newState.selection)) return null;
      if (!transactions.some((tr) => tr.selectionSet) || transactions.some((tr) => tr.docChanged || isBindingTransaction(tr) || tr.getMeta(commentDisplayKey))) return null;
      const ids = threadsAtCaret(newState, ydoc);
      if (ids.length === 0) return null;
      const threadId = ids.length === 1 ? ids[0]! : innermost(newState.doc, newState.selection.from, ids, ydoc);
      if (threadId === null || threadId === activeThread(newState)) return null;
      return newState.tr.setMeta(commentDisplayKey, { active: threadId, cause: 'caret' } satisfies DisplayMeta).setMeta('addToHistory', false);
    },
    state: {
      init: (_config, state) => rebuild(state.doc, ydoc, null, null, null),
      apply(tr, old, _oldState, state) {
        const meta = tr.getMeta(commentDisplayKey) as DisplayMeta | undefined;
        // P4-B1: cause and pin; every `active` meta naming a thread is the human's (a click, the caret, a chord, the
        // margin's card, J and K, the panel), and one naming none (plain text, Escape) keeps the pin
        if (meta && 'active' in meta) return rebuild(state.doc, ydoc, meta.active, meta.cause ?? null, meta.active ?? old.pinned);
        if (meta) return rebuild(state.doc, ydoc, old.active, old.cause, old.pinned);
        if (!tr.docChanged) return old;
        const blocks = touchedBlocks(tr);
        if (blocks === null) return rebuild(tr.doc, ydoc, old.active, old.cause, old.pinned);
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
        return { active: old.active, cause: old.cause, decorations, blocks: old.blocks, pinned: old.pinned };
      },
    },
    props: {
      decorations: (state) => commentDisplayKey.getState(state)?.decorations,
      handleClick: (view, pos, event) => {
        const ids = threadsClicked(event.target, view.dom);
        const threadId = ids.length === 0 ? null : innermost(view.state.doc, pos, ids, ydoc);
        // P4-B1 (Surprise 7): the caret goes to the click in the activation's own transaction, the thread already
        // active or not; only for a primary click (ProseMirror's mouseup calls this for every button, so a right-click
        // and macOS's Ctrl-click, which open a context menu, would collapse its selection; it skips a shift-click)
        const caret = threadId !== null && event.button === 0 && !event.ctrlKey;
        if (threadId !== activeThread(view.state) || caret) {
          const tr = view.state.tr.setMeta(commentDisplayKey, { active: threadId, cause: 'click' } satisfies DisplayMeta).setMeta('addToHistory', false);
          view.dispatch(caret ? tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))) : tr);
        }
        if (threadId !== null) onActivate?.(threadId, 'click');
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
      return {
        // P4-B1: a thread the caret or a chord drew active is told to the surface once the state holds it (a click is
        // told by handleClick itself)
        update: (current, prev) => {
          const now = commentDisplayKey.getState(current.state);
          if (!now || now.active === null || now.active === activeThread(prev) || now.cause === null || now.cause === 'click') return;
          onActivate?.(now.active, now.cause);
        },
        destroy: stop,
      };
    },
  });
}

/**
 * P4-B1: where each open thread is drawn in this editor: thread id → the earliest position of its decorations (a text
 * passage's first character, a block thread's block). A thread with no decoration here (an orphan, another tab's) is
 * absent. Read from the display's decorations, which follow every transaction (an undo brings a mark and its
 * decoration back together), so no document or DOM is walked.
 */
export function drawnThreads(state: EditorState): Map<string, number> {
  const out = new Map<string, number>();
  const decorations = commentDisplayKey.getState(state)?.decorations.find() ?? [];
  for (const decoration of decorations) {
    for (const id of (decoration.spec as Partial<DisplaySpec>).threads?.split(' ') ?? []) {
      const at = out.get(id);
      if (at === undefined || decoration.from < at) out.set(id, decoration.from);
    }
  }
  return out;
}

/** The thread the editor shows as active (its card or its row in the rail), or null. */
export const activeThread = (state: EditorState): string | null => commentDisplayKey.getState(state)?.active ?? null;

/** P4-B1: the last thread the human activated, while it is open (the margin walks its stack from it), or null. */
export const pinnedThread = (state: EditorState): string | null => commentDisplayKey.getState(state)?.pinned ?? null;

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
// and ids, the pasting editor's artifact is the record's, every recorded threaded original is live nowhere in the
// document, and the record is unconsumed; each threaded view's id goes to the view pasted at its own place in the slice. A copy, a drag or a cut with no threaded block clears the record; another window, another
// artifact or another application restores nothing (a renderer-local record: cross-window carry is a known limit).
const CUT_ATTR = 'data-maws-cut';
interface CutRecord {
  nonce: string;
  artifactId: string;
  /**
   * Every cut block of a type that carries a block thread here, threaded or not, in the slice's document order (nested
   * ones included): its id, everything but the id (`key`), and whether a block thread is on it. The pasted blocks of
   * those types come back in the same order, so the n-th recorded block is the n-th pasted one of its key; recording the
   * unthreaded twins keeps an identical threaded view's id on its own place, never on a twin's (E2's Decision Log 27).
   */
  blocks: Array<{ blockId: string; key: string; threaded: boolean }>;
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
          const whole: Array<{ node: PMNode; blockId: string }> = []; // every block the cut takes whole, in order
          view.state.doc.nodesBetween(from, to, (node, pos) => {
            if (typeof node.attrs.id === 'string' && pos >= from && pos + node.nodeSize <= to) whole.push({ node, blockId: node.attrs.id });
            return !node.isTextblock;
          });
          const types = new Set(whole.filter(({ blockId }) => threaded.has(blockId)).map(({ node }) => node.type.name));
          const blocks = whole.filter(({ node }) => types.has(node.type.name)).map(({ node, blockId }) => ({ blockId, key: keyOf(node), threaded: threaded.has(blockId) }));
          lastCut = types.size > 0 ? { nonce: crypto.randomUUID(), artifactId, blocks } : null;
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
          const carried = cut.blocks.every(({ blockId, threaded }) => html.includes(`data-id="${blockId}"`) && !(threaded && live.has(blockId)));
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
      // the paste's blocks of the recorded types: those whose ids the doc did not hold before it, in document order
      const types = new Set(armed.blocks.map(({ key }) => key.slice(0, key.indexOf(':'))));
      const pasted: Array<{ node: PMNode; pos: number }> = [];
      let pending = false;
      state.doc.descendants((node, pos) => {
        if (types.has(node.type.name)) {
          if (node.attrs.id === null) pending = true;
          else if (!armed!.before.has(node.attrs.id as string)) pasted.push({ node, pos });
        }
        return !node.isTextblock;
      });
      if (pending || pasted.length === 0) return null; // UniqueID mints in its own append, before this one sees it
      // the slice's order: each recorded block takes the next pasted block of its key, threaded or not, so a twin's place
      // is its own; only a threaded block's id comes back
      const present = docIds(state.doc);
      const tr = state.tr;
      let next = 0;
      for (const { blockId, key, threaded } of armed.blocks) {
        while (next < pasted.length && keyOf(pasted[next]!.node) !== key) next += 1;
        if (next >= pasted.length) break;
        const { pos } = pasted[next]!;
        next += 1;
        if (threaded && !present.has(blockId)) tr.setNodeAttribute(pos, 'id', blockId);
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
  /** A click, the local caret or a chord drew a passage's thread active (P4-B1: with its cause; the editor's surface decides what follows). */
  onActivate: ((threadId: string, cause: ActivationCause) => void) | null;
  /** P4-B1: ⌃⌘ E then C entered the current comment (the surface focuses its card). */
  onEnter: ((threadId: string) => void) | null;
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
  addOptions: () => ({ doc: null, tabId: null, paste: true, onComment: null, onActivate: null, onEnter: null }),
  // P4-B1: the two-step chords' first key, kept until the second or the window's end
  addStorage: () => ({ chord: null as { key: 'n' | 'p' | 'e'; at: number } | null }),
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
    // P4-B1: Docs' chords: hold ⌃⌘, N then C (next comment after the caret), P then C (previous), E then C (enter the
    // current one). The first key arms for CHORD_WINDOW_MS; without a comment plugin (no doc) nothing is armed.
    const arm = (key: 'n' | 'p' | 'e') => () => {
      if (!this.options.doc) return false;
      this.storage.chord = { key, at: Date.now() };
      return true;
    };
    const complete = () => {
      const armed = this.storage.chord;
      this.storage.chord = null;
      if (!armed || !this.options.doc || Date.now() - armed.at > CHORD_WINDOW_MS) return false;
      const { editor } = this;
      if (armed.key === 'e') {
        const active = activeThread(editor.state);
        if (active !== null) this.options.onEnter?.(active);
        return active !== null;
      }
      return goToThread(editor, this.options.doc, armed.key === 'n' ? 'next' : 'previous');
    };
    return { 'Mod-Alt-m': () => this.options.onComment?.() ?? false, 'Ctrl-Mod-n': arm('n'), 'Ctrl-Mod-p': arm('p'), 'Ctrl-Mod-e': arm('e'), 'Ctrl-Mod-c': complete };
  },
  addProseMirrorPlugins() {
    const { doc, tabId } = this.options;
    if (!doc) return [];
    return [display(doc, this.options.onActivate), ...(this.options.paste ? [paste(doc, tabId)] : []), ...(this.options.artifactId ? [blockCarry(doc, this.options.artifactId)] : []) /* P3-E */];
  },
});

// P4-B1 start: the chords' navigation (the stack's J and K are the surface's, in stack order; these read the document)
const CHORD_WINDOW_MS = 1_500;

/** The open threads of this editor's doc in document order: `[threadId, start]`, each at its earliest live range. */
export function threadOrder(doc: PMNode, ydoc: Doc): Array<[string, number]> {
  const starts: Array<[string, number]> = [];
  for (const [id, ranges] of liveRanges(doc)) {
    if (threadStatus(ydoc, id) !== 'open') continue;
    const first = ranges.reduce((min, range) => Math.min(min, range.from), Infinity);
    if (Number.isFinite(first)) starts.push([id, first]);
  }
  const created = (id: string) => getThread(ydoc, id)?.createdAt ?? 0;
  return starts.sort((a, b) => a[1] - b[1] || created(a[0]) - created(b[0]) || (a[0] < b[0] ? -1 : 1));
}

/** The next or previous open thread after the caret (after the active thread's start when one is active); false with none. */
export function goToThread(editor: Editor, ydoc: Doc, direction: 'next' | 'previous'): boolean {
  const { state } = editor;
  const order = threadOrder(state.doc, ydoc);
  const active = activeThread(state);
  const from = active !== null ? (order.find(([id]) => id === active)?.[1] ?? state.selection.from) : state.selection.from;
  const target = direction === 'next' ? order.find(([id, start]) => start > from || (start === from && id !== active && active === null)) : [...order].reverse().find(([, start]) => start < from);
  if (!target) return false;
  const [threadId, start] = target;
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start)).setMeta(commentDisplayKey, { active: threadId, cause: 'key' } satisfies DisplayMeta).setMeta('addToHistory', false).scrollIntoView());
  return true;
}
// P4-B1 end
