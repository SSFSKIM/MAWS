// The threads model (D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4 as amended by S5, Decision Log 31
// and 32; X26): a comment is the `comment {threadId}` mark on the text (schema.ts) plus a thread in the document's root
// `threads`, so threads sync, version and restore with the text. Copied and typed from P3-0's `s5/lib/comments.mjs`
// (the editor's plugins go to editor/comments/ in M4).
//
//   threads.attr[threadId] = Node('thread') {
//     attrs: tabId, blockId, quote, anchor {start, end, block} (relative positions as JSON), status 'open' | 'resolved',
//            createdBy, createdAt, resolvedBy?, resolvedAt?, reopenedBy?, reopenedAt?
//     children: the messages {id, by, at, body}, a sequence, so a reply racing a resolve or another reply lands
//   }
//
// Orphaned is never stored: a thread is orphaned when it is open and no live text carries its mark, so undo, a restore
// and a cut pasted back un-orphan it with no write. Resolve and reopen write the map only, never the text.
import type { Actor } from '@shared/artifacts/actor';
import { transact, type Doc, type Node } from '../yjs';
import {
  YNode,
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromJSON,
  createRelativePositionFromTypeIndex,
  relativePositionToJSON,
} from '../yjs/document';
import { yattr2markname } from '../yjs/prosemirror';
import { listTabs, tabBody } from './tabs';

export const THREADS = 'threads';

export type ThreadStatus = 'open' | 'resolved';

/** Relative positions as Yjs's JSON: the passage's start and end, and the gap its top-level block sits in. */
export interface ThreadAnchor {
  start: unknown;
  end: unknown;
  block: unknown;
}

export interface ThreadMessage {
  id: string;
  by: Actor;
  at: number;
  body: string;
}

export interface Thread {
  id: string;
  tabId: string;
  blockId: string | null;
  quote: string;
  anchor: ThreadAnchor | null;
  status: ThreadStatus;
  createdBy: Actor;
  createdAt: number;
  resolvedBy: Actor | null;
  resolvedAt: number | null;
  reopenedBy: Actor | null;
  reopenedAt: number | null;
  messages: ThreadMessage[];
}

export interface ThreadState extends Thread {
  /** Some live text carries the thread's mark. */
  live: boolean;
  /** Open, and no live text carries the mark (derived, never stored). */
  orphan: boolean;
}

const threadsRoot = (doc: Doc): Node => doc.get(THREADS);
const threadNode = (doc: Doc, id: string): Node | undefined => {
  const node: unknown = threadsRoot(doc).getAttr(id);
  return node instanceof YNode ? node : undefined;
};

function readThread(node: Node, id: string): Thread {
  const attr = <T>(name: string): T | null => (node.getAttr(name) as T | undefined) ?? null;
  return {
    id,
    tabId: String(attr<string>('tabId') ?? ''),
    blockId: attr<string>('blockId'),
    quote: String(attr<string>('quote') ?? ''),
    anchor: attr<ThreadAnchor>('anchor'),
    status: attr<ThreadStatus>('status') ?? 'open',
    createdBy: attr<Actor>('createdBy') ?? { kind: 'human' },
    createdAt: Number(attr<number>('createdAt') ?? 0),
    resolvedBy: attr<Actor>('resolvedBy'),
    resolvedAt: attr<number>('resolvedAt'),
    reopenedBy: attr<Actor>('reopenedBy'),
    reopenedAt: attr<number>('reopenedAt'),
    messages: node.toArray().filter((message): message is ThreadMessage => typeof message === 'object' && message !== null && !(message instanceof YNode)),
  };
}

/** A thread's status alone (the editor's display reads it per live mark), or null when there is no such thread. */
export const threadStatus = (doc: Doc, id: string): ThreadStatus | null => {
  const node = threadNode(doc, id);
  return node ? ((node.getAttr('status') as ThreadStatus | undefined) ?? 'open') : null;
};

/** Calls `listener` after every transaction that changed the threads map or a thread in it; returns the unsubscribe. */
export function observeThreads(doc: Doc, listener: () => void): () => void {
  const root = threadsRoot(doc);
  const observer = () => listener();
  root.observeDeep(observer);
  return () => root.unobserveDeep(observer);
}

export const getThread = (doc: Doc, id: string): Thread | null => {
  const node = threadNode(doc, id);
  return node ? readThread(node, id) : null;
};

/** Every thread, oldest first (ties by id, so every replica lists them in one order). */
export function listThreads(doc: Doc): Thread[] {
  const out: Thread[] = [];
  for (const [id, node] of threadsRoot(doc).attrEntries()) if (node instanceof YNode) out.push(readThread(node, String(id)));
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

export interface NewThread {
  threadId: string;
  tabId: string;
  blockId: string | null;
  quote: string;
  anchor: ThreadAnchor;
  by: Actor;
  at: number;
  /** The first message, if the comment was written with one. */
  body?: string;
  messageId?: string;
}

/**
 * Writes a thread record (one transaction). Write it before the mark (Decision Log 31): the host strips a mark whose
 * thread is absent, and a crash between the two must leave a thread without a mark, not an invisible mark.
 */
export function addThread(doc: Doc, { threadId, tabId, blockId, quote, anchor, by, at, body, messageId = `${threadId}:m0` }: NewThread, origin?: unknown): void {
  transact(
    doc,
    () => {
      const thread = new YNode('thread');
      threadsRoot(doc).setAttr(threadId, thread);
      thread.setAttr('tabId', tabId);
      thread.setAttr('blockId', blockId);
      thread.setAttr('quote', quote);
      thread.setAttr('anchor', anchor);
      thread.setAttr('status', 'open');
      thread.setAttr('createdBy', by);
      thread.setAttr('createdAt', at);
      if (body != null) thread.insert(0, [{ id: messageId, by, at, body } satisfies ThreadMessage]);
    },
    origin,
  );
}

const existing = (doc: Doc, threadId: string): Node => {
  const node = threadNode(doc, threadId);
  if (!node) throw new Error(`no thread ${threadId}`);
  return node;
};

export const reply = (doc: Doc, threadId: string, message: ThreadMessage, origin?: unknown): void => {
  const node = existing(doc, threadId);
  transact(doc, () => node.push([message]), origin);
};

export function resolve(doc: Doc, threadId: string, by: Actor, at: number, origin?: unknown): void {
  const node = existing(doc, threadId);
  transact(
    doc,
    () => {
      node.setAttr('status', 'resolved');
      node.setAttr('resolvedBy', by);
      node.setAttr('resolvedAt', at);
    },
    origin,
  );
}

export function reopen(doc: Doc, threadId: string, by: Actor, at: number, origin?: unknown): void {
  const node = existing(doc, threadId);
  transact(
    doc,
    () => {
      node.setAttr('status', 'open');
      node.setAttr('reopenedBy', by);
      node.setAttr('reopenedAt', at);
    },
    origin,
  );
}

// ── live marks ──
// A body's text, as v14 renders it: string inserts with their formats, and child nodes.
interface DeltaOp {
  insert?: string | unknown[];
  format?: Record<string, unknown> | null;
}
const opsOf = (node: Node): Iterable<DeltaOp> => (node.toDelta() as unknown as { children: Iterable<DeltaOp> }).children;
export const isCommentKey = (key: string): boolean => yattr2markname(key) === 'comment';
const threadIdOf = (value: unknown): string | null => {
  const id = (value as { threadId?: unknown } | null)?.threadId;
  return typeof id === 'string' ? id : null;
};

/** One character position in a body: a node and an index in its content. */
export interface Spot {
  node: Node;
  index: number;
}
export interface Extent {
  first: Spot;
  last: Spot;
}

/**
 * Every live comment mark under `root`, in one walk: thread id → the first and last character carrying it. A mark
 * split across blocks spans from its first block to its last.
 */
export const markExtents = (root: Node): Map<string, Extent> => markExtentsOf([root]);

/** `markExtents` over several nodes in order (some top-level blocks of one body), as if they were one. */
export function markExtentsOf(nodes: Iterable<Node>): Map<string, Extent> {
  const out = new Map<string, Extent>();
  const walk = (node: Node): void => {
    let index = 0;
    for (const op of opsOf(node)) {
      if (typeof op.insert === 'string') {
        for (const [key, value] of Object.entries(op.format ?? {})) {
          const id = isCommentKey(key) ? threadIdOf(value) : null;
          if (!id) continue;
          const last = { node, index: index + op.insert.length };
          const seen = out.get(id);
          if (seen) seen.last = last;
          else out.set(id, { first: { node, index }, last });
        }
        index += op.insert.length;
      } else if (Array.isArray(op.insert)) {
        for (const child of op.insert) {
          if (child instanceof YNode) walk(child);
          index += 1;
        }
      }
    }
  };
  for (const node of nodes) walk(node);
  return out;
}

/** The thread ids live text carries under `root` (a tab body). */
export const liveIdsY = (root: Node): Set<string> => new Set(markExtents(root).keys());

/** The thread ids live text carries in any tab of the document. */
export function liveThreadIds(doc: Doc): Set<string> {
  const ids = new Set<string>();
  for (const tab of listTabs(doc)) {
    const body = tabBody(doc, tab.id);
    if (body) for (const id of liveIdsY(body)) ids.add(id);
  }
  return ids;
}

/** The state the UI and the agent see: each thread with `live` and the derived `orphan`. */
export const threadStates = (doc: Doc, liveIds: ReadonlySet<string>): ThreadState[] =>
  listThreads(doc).map((thread) => ({ ...thread, live: liveIds.has(thread.id), orphan: thread.status === 'open' && !liveIds.has(thread.id) }));

// ── the anchor: where the passage is, or was ──
const rposJSON = (node: Node, index: number, assoc = 0): unknown => relativePositionToJSON(createRelativePositionFromTypeIndex(node, index, assoc));
const absolute = (doc: Doc, json: unknown) => (json == null ? null : createAbsolutePositionFromRelativePosition(createRelativePositionFromJSON(json), doc, false));
/** The id of a node or of its nearest ancestor that has one. */
const blockIdOf = (node: Node | null): string | null => {
  for (let at = node; at; at = at.parent) {
    const id: unknown = at.getAttr('id');
    if (typeof id === 'string') return id;
  }
  return null;
};
const isLive = (node: Node): boolean => {
  for (let at: Node | null = node; at; at = at.parent) if (at._item?.deleted) return false;
  return true;
};

/** The anchor of an extent: its two ends, and the gap of its top-level block in the body (which survives the block). */
function anchorOf(root: Node, extent: Extent): { anchor: ThreadAnchor; blockId: string | null } {
  let top = extent.first.node;
  while (top.parent && top.parent !== root) top = top.parent;
  const at = top.parent ? top.parent.toArray().indexOf(top) : -1;
  return {
    anchor: {
      start: rposJSON(extent.first.node, extent.first.index),
      end: rposJSON(extent.last.node, extent.last.index, -1),
      block: at >= 0 ? rposJSON(top.parent!, at) : null,
    },
    blockId: blockIdOf(extent.first.node),
  };
}

/** The anchor of thread `threadId`'s live mark under `root`, or null when no live text carries it. */
export function anchorOfMark(root: Node, threadId: string): ThreadAnchor | null {
  const extent = markExtents(root).get(threadId);
  return extent ? anchorOf(root, extent).anchor : null;
}

export type Located =
  | { how: 'text'; blockId: string; index: number; endIndex: number | null }
  | { how: 'block' | 'block-gap'; blockId: string | null; index: number }
  | { how: 'none'; blockId: null };

/**
 * Where a thread's passage is or was, with no editor: the stored pair resolved without following undone deletions
 * (what every replica agrees on), else the block's own gap in the body and the nearest surviving block there.
 */
export function locate(doc: Doc, thread: Pick<Thread, 'anchor' | 'blockId'>): Located {
  const start = absolute(doc, thread.anchor?.start);
  const end = absolute(doc, thread.anchor?.end);
  const startBlock = start ? blockIdOf(start.type) : null;
  if (start && startBlock && isLive(start.type)) return { how: 'text', blockId: startBlock, index: start.index, endIndex: end && end.type === start.type ? end.index : null };
  const block = absolute(doc, thread.anchor?.block);
  if (block && isLive(block.type)) {
    const kids = block.type.toArray().filter((kid): kid is Node => kid instanceof YNode);
    const here = kids[block.index];
    const before = kids[block.index - 1];
    if (here && here.getAttr('id') === thread.blockId) return { how: 'block', blockId: thread.blockId, index: block.index };
    const pick = before ?? here ?? kids[kids.length - 1];
    return { how: 'block-gap', blockId: pick ? blockIdOf(pick) : null, index: block.index };
  }
  return { how: 'none', blockId: null };
}

const sameSpot = (doc: Doc, json: unknown, spot: Spot): boolean => {
  const at = absolute(doc, json);
  return !!at && at.type === spot.node && at.index === spot.index;
};

/** Which threads and blocks a refresh or a strip reads: the threads, and per tab the top-level blocks carrying them. */
export interface ThreadScope {
  threads: ReadonlySet<string>;
  blocks(tabId: string): Iterable<Node>;
}

/**
 * The host's anchor refresh (S5's A6, run at the per-update hook beside the id repair): splits, joins, type changes,
 * moves and cut-and-paste re-create text under new item ids, so a stored pair drifts. For every thread whose mark is
 * live and whose pair no longer brackets it, rewrite the pair, its block and its tab from the mark. One walk per tab
 * (with a `scope`, of only the blocks carrying the scope's threads); one transaction, written only when something
 * drifted. Returns the ids rewritten.
 */
export function refreshAnchors(doc: Doc, origin?: unknown, scope?: ThreadScope): string[] {
  const drifted: Array<{ node: Node; tabId: string; anchor: ThreadAnchor; blockId: string | null; id: string }> = [];
  const seen = new Set<string>();
  for (const tab of listTabs(doc)) {
    const body = tabBody(doc, tab.id);
    if (!body) continue;
    for (const [id, extent] of scope ? markExtentsOf(scope.blocks(tab.id)) : markExtents(body)) {
      if (scope && !scope.threads.has(id)) continue;
      const node = threadNode(doc, id);
      if (!node || seen.has(id)) continue;
      seen.add(id);
      const stored = (node.getAttr('anchor') as ThreadAnchor | undefined) ?? null;
      if (stored && node.getAttr('tabId') === tab.id && sameSpot(doc, stored.start, extent.first) && sameSpot(doc, stored.end, extent.last)) continue;
      drifted.push({ node, tabId: tab.id, id, ...anchorOf(body, extent) });
    }
  }
  if (drifted.length > 0) {
    transact(
      doc,
      () => {
        for (const { node, tabId, anchor, blockId } of drifted) {
          node.setAttr('anchor', anchor);
          node.setAttr('blockId', blockId);
          if (node.getAttr('tabId') !== tabId) node.setAttr('tabId', tabId);
        }
      },
      origin,
    );
  }
  return drifted.map((entry) => entry.id);
}

/**
 * Removes every comment mark whose thread is not in the threads map (a pasted or foreign mark, or a crash between the
 * mark and its thread); with `blocks`, only in those top-level blocks of each tab. One transaction, written only when
 * there is one. Returns the stripped thread ids.
 */
export function stripMarklessComments(doc: Doc, origin?: unknown, blocks?: (tabId: string) => Iterable<Node>): string[] {
  const threads = threadsRoot(doc);
  const strays: Array<{ node: Node; index: number; length: number; key: string; id: string }> = [];
  const walk = (node: Node): void => {
    let index = 0;
    for (const op of opsOf(node)) {
      if (typeof op.insert === 'string') {
        for (const [key, value] of Object.entries(op.format ?? {})) {
          const id = isCommentKey(key) ? threadIdOf(value) : null;
          if (id != null && !threads.hasAttr(id)) strays.push({ node, index, length: op.insert.length, key, id });
        }
        index += op.insert.length;
      } else if (Array.isArray(op.insert)) {
        for (const child of op.insert) {
          if (child instanceof YNode) walk(child);
          index += 1;
        }
      }
    }
  };
  for (const tab of listTabs(doc)) {
    if (blocks) for (const block of blocks(tab.id)) walk(block);
    else {
      const body = tabBody(doc, tab.id);
      if (body) walk(body);
    }
  }
  if (strays.length > 0) transact(doc, () => strays.forEach(({ node, index, length, key }) => node.format(index, length, { [key]: null })), origin);
  return [...new Set(strays.map((stray) => stray.id))];
}

/**
 * Withdraws a comment nothing was said in yet (M4: its card dismissed unsent): the thread and every mark carrying it, in
 * one transaction, so no replica sees a mark without its thread. A thread with a message is never discarded (false).
 */
export function discardThread(doc: Doc, threadId: string, origin?: unknown): boolean {
  const node = threadNode(doc, threadId);
  if (!node || node.length > 0) return false;
  transact(
    doc,
    () => {
      threadsRoot(doc).deleteAttr(threadId);
      stripMarklessComments(doc, origin);
    },
    origin,
  );
  return true;
}
