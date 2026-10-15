// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; the parent's §4.4 thread model and §4.5 object
// anchors; its Decision Log 31 and 32): the deck's comment threads, shaped as B's (src/artifacts/document/threads.ts)
// where it applies, anchored by ids to one element of one slide instead of to a passage of text.
//
//   threads.attr[threadId] = <thread> {
//     attrs: slideId, elementId, quote, status 'open' | 'resolved', createdBy, createdAt, resolvedBy?, resolvedAt?,
//            reopenedBy?, reopenedAt?
//     children: the messages {id, by, at, body}, a sequence, so a reply racing a resolve or another reply lands
//   }
//
// The anchor is ids only (`resolveAnchor`), so a move, a restyle, a slide re-order and a republish that keeps the id
// keep it (S6). The quote is the element's text (or its tag and alt), refreshed by the host while the element lives
// (`refreshQuotes`, the adapter's `afterUpdate`), so a deleted element's thread shows the last text it had. Orphaned is
// never stored: open, and the anchor does not resolve, so undo, a restore and a paste that brings the id back un-orphan
// it with no write. Resolve and reopen write the thread only. Yjs only through the seam (src/artifacts/yjs/slides.ts).
import { customAlphabet } from 'nanoid';
import type { Actor } from '@shared/artifacts/actor';
import type { ThreadMessage, ThreadStatus } from '../document/threads';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { CONTAINER_TAGS, type TextBlock } from './ir';
import { childLists, readFlat, resolveAnchor, ROOT, type FlatElement } from './model';

export type { ThreadMessage, ThreadStatus };

/** A new thread's id (B's alphabet and length). */
export const newThreadId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/** The longest quote kept: a container's or a table's text is cut here. */
export const QUOTE_MAX = 500;

export interface DeckThread {
  id: string;
  slideId: string;
  elementId: string;
  quote: string;
  status: ThreadStatus;
  createdBy: Actor;
  createdAt: number;
  resolvedBy: Actor | null;
  resolvedAt: number | null;
  reopenedBy: Actor | null;
  reopenedAt: number | null;
  messages: ThreadMessage[];
}

export interface DeckThreadState extends DeckThread {
  /** The element is in the deck. */
  live: boolean;
  /** Open, and the element is gone (derived, never stored). */
  orphan: boolean;
}

const isMessage = (m: unknown): m is ThreadMessage => typeof m === 'object' && m !== null && typeof (m as ThreadMessage).id === 'string' && typeof (m as ThreadMessage).body === 'string';

function readThread(doc: Doc, id: string): DeckThread {
  const s = Y.threadScalars(doc, id);
  const attr = <T>(name: string): T | null => (s[name] as T | undefined) ?? null;
  return {
    id,
    slideId: String(attr<string>('slideId') ?? ''),
    elementId: String(attr<string>('elementId') ?? ''),
    quote: String(attr<string>('quote') ?? ''),
    status: attr<ThreadStatus>('status') ?? 'open',
    createdBy: attr<Actor>('createdBy') ?? { kind: 'human' },
    createdAt: Number(attr<number>('createdAt') ?? 0),
    resolvedBy: attr<Actor>('resolvedBy'),
    resolvedAt: attr<number>('resolvedAt'),
    reopenedBy: attr<Actor>('reopenedBy'),
    reopenedAt: attr<number>('reopenedAt'),
    messages: (Y.threadMessages(doc, id) as unknown[]).filter(isMessage),
  };
}

export const getThread = (doc: Doc, id: string): DeckThread | null => (Y.hasThread(doc, id) ? readThread(doc, id) : null);

/** A thread's status alone, or null when there is no such thread. */
export const threadStatus = (doc: Doc, id: string): ThreadStatus | null => (Y.hasThread(doc, id) ? ((Y.threadScalars(doc, id).status as ThreadStatus | undefined) ?? 'open') : null);

/** Every thread, oldest first (ties by id, so every replica lists them in one order). */
export function listThreads(doc: Doc): DeckThread[] {
  return Y.threadIds(doc)
    .filter((id) => Y.hasThread(doc, id))
    .map((id) => readThread(doc, id))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Calls `listener` after every transaction that changed the threads root or a thread in it; returns the unsubscribe. */
export const observeThreads = Y.observeThreads;

/** The state the UI and the agent see: each thread with whether its element lives and the derived `orphan`. */
export function threadStates(doc: Doc): DeckThreadState[] {
  return listThreads(doc).map((thread) => {
    const live = resolveAnchor(doc, thread).live;
    return { ...thread, live, orphan: thread.status === 'open' && !live };
  });
}

export interface NewDeckThread {
  threadId: string;
  slideId: string;
  elementId: string;
  quote: string;
  by: Actor;
  at: number;
  /** The first message, if the comment was written with one. */
  body?: string;
  messageId?: string;
}

/** Writes a thread record (one transaction). */
export function addThread(doc: Doc, { threadId, slideId, elementId, quote, by, at, body, messageId = `${threadId}:m0` }: NewDeckThread, origin?: unknown): void {
  transact(
    doc,
    () => {
      Y.createThread(doc, threadId, { slideId, elementId, quote, status: 'open', createdBy: by as unknown as Y.Json, createdAt: at });
      if (body != null) Y.postMessage(doc, threadId, { id: messageId, by: by as unknown as Y.Json, at, body });
    },
    origin,
  );
}

const existing = (doc: Doc, threadId: string): void => {
  if (!Y.hasThread(doc, threadId)) throw new Error(`no thread ${threadId}`);
};

export function reply(doc: Doc, threadId: string, message: ThreadMessage, origin?: unknown): void {
  existing(doc, threadId);
  transact(doc, () => Y.postMessage(doc, threadId, message as unknown as Y.Json), origin);
}

function setStatus(doc: Doc, threadId: string, status: ThreadStatus, by: Actor, at: number, origin: unknown): void {
  existing(doc, threadId);
  const who = status === 'resolved' ? 'resolved' : 'reopened';
  transact(
    doc,
    () => {
      Y.setThreadKey(doc, threadId, 'status', status);
      Y.setThreadKey(doc, threadId, `${who}By`, by as unknown as Y.Json);
      Y.setThreadKey(doc, threadId, `${who}At`, at);
    },
    origin,
  );
}
export const resolve = (doc: Doc, threadId: string, by: Actor, at: number, origin?: unknown): void => setStatus(doc, threadId, 'resolved', by, at, origin);
export const reopen = (doc: Doc, threadId: string, by: Actor, at: number, origin?: unknown): void => setStatus(doc, threadId, 'open', by, at, origin);

/**
 * Withdraws a comment nothing was said in yet (its card closed unsent; B's rule): the thread goes. A thread with a
 * message, or one someone resolved, is never discarded (false).
 */
export function discardThread(doc: Doc, threadId: string, origin?: unknown): boolean {
  if (!Y.hasThread(doc, threadId)) return false;
  const thread = readThread(doc, threadId);
  if (thread.messages.length > 0 || thread.status !== 'open' || thread.resolvedAt !== null) return false;
  transact(doc, () => Y.deleteThread(doc, threadId), origin);
  return true;
}

// ── the quote: what the element says, or what it is ──

const blocksText = (blocks: readonly TextBlock[]): string => blocks.map((b) => b.inline.map((r) => ('text' in r ? r.text : ' ')).join('')).join('\n');
const clip = (text: string): string => (text.length <= QUOTE_MAX ? text : `${text.slice(0, QUOTE_MAX - 1)}…`);

function quoteOf(e: FlatElement, lists: Map<string, FlatElement[]>): string {
  const texts: string[] = [];
  const walk = (el: FlatElement) => {
    if (el.text) {
      const t = blocksText(el.text).trim();
      if (t) texts.push(t);
    }
    if (CONTAINER_TAGS.has(el.tag)) for (const child of lists.get(el.id) ?? []) walk(child);
  };
  walk(e);
  if (texts.length > 0) return clip(texts.join('\n'));
  const what = e.attrs.alt ?? e.attrs['aria-label'];
  if (what) return clip(`${e.tag} “${what}”`);
  const kind = e.tag === 'x-shape' ? e.attrs.kind : e.tag === 'x-icon' ? e.attrs.name : undefined;
  return kind ? `${e.tag} ${kind}` : e.tag;
}

/** An element's quote (its text, its descendants' text for a container, else its tag and alt or kind); '' when gone. */
export function elementQuote(doc: Doc, slideId: string, elementId: string): string {
  if (!Y.hasElement(doc, slideId, elementId)) return '';
  const flat = readFlat(doc, slideId);
  const e = flat.find((el) => el.id === elementId);
  return e ? quoteOf(e, childLists(flat)) : '';
}

/** A slide's title as a comment's label names it: its first heading's text in paint order, else its first text. */
export function slideTitle(doc: Doc, slideId: string): string {
  if (!Y.hasSlide(doc, slideId)) return '';
  const lists = childLists(readFlat(doc, slideId));
  let heading: string | null = null;
  let first: string | null = null;
  const walk = (parent: string) => {
    for (const e of lists.get(parent) ?? []) {
      if (heading !== null) return;
      const text = e.text ? blocksText(e.text).trim() : '';
      if (text && /^h[1-3]$/.test(e.tag)) heading = text;
      else if (text && first === null) first = text;
      if (CONTAINER_TAGS.has(e.tag)) walk(e.id);
    }
  };
  walk(ROOT);
  return clip((heading ?? first ?? '').replace(/\s+/g, ' '));
}

/**
 * The host's quote refresh (D9; the adapter's `afterUpdate` and `afterRestore`): for every thread whose element lives
 * (on `slides` when given), the element's quote now; written in one transaction, only where it drifted. A thread whose
 * element is gone keeps the last quote it had. Returns the ids rewritten.
 */
export function refreshQuotes(doc: Doc, options: { slides?: Iterable<string> } = {}, origin?: unknown): string[] {
  const only = options.slides ? new Set(options.slides) : null;
  const bySlide = new Map<string, { id: string; elementId: string; quote: string }[]>();
  for (const id of Y.threadIds(doc)) {
    if (!Y.hasThread(doc, id)) continue;
    const s = Y.threadScalars(doc, id);
    const slideId = String(s.slideId ?? '');
    if ((only && !only.has(slideId)) || !Y.hasSlide(doc, slideId)) continue;
    const list = bySlide.get(slideId) ?? [];
    list.push({ id, elementId: String(s.elementId ?? ''), quote: String(s.quote ?? '') });
    bySlide.set(slideId, list);
  }
  const drifted: { id: string; quote: string }[] = [];
  for (const [slideId, threads] of bySlide) {
    const flat = readFlat(doc, slideId);
    const byId = new Map(flat.map((e) => [e.id, e]));
    const lists = childLists(flat);
    for (const t of threads) {
      const e = byId.get(t.elementId);
      if (!e) continue;
      const quote = quoteOf(e, lists);
      if (quote !== t.quote) drifted.push({ id: t.id, quote });
    }
  }
  if (drifted.length > 0) transact(doc, () => drifted.forEach(({ id, quote }) => Y.setThreadKey(doc, id, 'quote', quote)), origin);
  return drifted.map((d) => d.id).sort();
}
