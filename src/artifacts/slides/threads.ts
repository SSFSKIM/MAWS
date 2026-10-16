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
// keep it (S6). The quote is the element's text (or its tag and alt): every reader derives it from the element while the
// element lives, and the stored quote is written only when the thread is made and when its element is deleted (the
// adapter reads the text just before the deletion: `captureQuotes`, then `storeDeletedQuotes`), so a deleted element's
// thread shows the last text it had and no keystroke writes a thread (Decision Log 31's ruling, revising D9). Orphaned is
// never stored: open, and the anchor does not resolve, so undo, a restore and a paste that brings the id back un-orphan
// it with no write. Resolve and reopen write the thread only. Yjs only through the seam (src/artifacts/yjs/slides.ts).
import { customAlphabet } from 'nanoid';
import type { Actor } from '@shared/artifacts/actor';
import type { ThreadMessage, ThreadStatus } from '../document/threads';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { CONTAINER_TAGS } from './ir';
import { childLists, readFlat, resolveAnchor, ROOT } from './model';
import { blocksText, boardQuote /* P3-E */, clipQuote as clip, quoteOf, QUOTE_MAX } from './quote';

export type { ThreadMessage, ThreadStatus };

/** The origin of every thread write the deck editor makes: never tracked by the deck's undo (M7). */
export const COMMENTS_ORIGIN = 'deck-comments';

/** A new thread's id (B's alphabet and length). */
export const newThreadId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export { QUOTE_MAX };

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

/** A thread, its quote the element's own while the element lives (else the stored one). */
export const getThread = (doc: Doc, id: string): DeckThread | null => (Y.hasThread(doc, id) ? withLiveQuotes(doc, [readThread(doc, id)])[0]! : null);

/** A thread's status alone, or null when there is no such thread. */
export const threadStatus = (doc: Doc, id: string): ThreadStatus | null => (Y.hasThread(doc, id) ? ((Y.threadScalars(doc, id).status as ThreadStatus | undefined) ?? 'open') : null);

/** Every thread, oldest first (ties by id, so every replica lists them in one order); quotes as `getThread`'s. */
export function listThreads(doc: Doc): DeckThread[] {
  const threads = Y.threadIds(doc)
    .filter((id) => Y.hasThread(doc, id))
    .map((id) => readThread(doc, id))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return withLiveQuotes(doc, threads);
}

/** Calls `listener` after every transaction that changed the threads root or a thread in it; returns the unsubscribe. */
export const observeThreads = Y.observeThreads;

/** How many threads are open, orphans included (the header's unresolved count). */
export const openThreadCount = (doc: Doc): number => Y.threadIds(doc).filter((id) => threadStatus(doc, id) === 'open').length;

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

/** An element's quote (its text, its descendants' text for a container, else its tag and alt or kind); '' when gone. */
export function elementQuote(doc: Doc, slideId: string, elementId: string): string {
  if (elementId === ROOT) return boardQuote(doc, slideId) ?? ''; // P3-E (E1, the P3-E spec's Decision Log 13 (2)): a board's ROOT
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

// Each slide's elements read once for the threads anchored on it: the quote of every element that lives.
function liveQuotesBySlide(doc: Doc, anchors: Iterable<{ id: string; slideId: string; elementId: string }>): Map<string, string> {
  const bySlide = new Map<string, { id: string; elementId: string }[]>();
  for (const a of anchors) {
    if (!Y.hasSlide(doc, a.slideId)) continue;
    const list = bySlide.get(a.slideId) ?? [];
    list.push(a);
    bySlide.set(a.slideId, list);
  }
  const quotes = new Map<string, string>();
  for (const [slideId, threads] of bySlide) {
    const flat = readFlat(doc, slideId);
    const byId = new Map(flat.map((e) => [e.id, e]));
    const lists = childLists(flat);
    for (const t of threads) {
      const e = byId.get(t.elementId);
      if (e) quotes.set(t.id, quoteOf(e, lists));
      else if (t.elementId === ROOT && boardQuote(doc, slideId) !== null) quotes.set(t.id, boardQuote(doc, slideId)!); // P3-E: a board's ROOT
    }
  }
  return quotes;
}

function withLiveQuotes(doc: Doc, threads: DeckThread[]): DeckThread[] {
  const live = liveQuotesBySlide(doc, threads);
  return threads.map((t) => (live.has(t.id) ? { ...t, quote: live.get(t.id)! } : t));
}

/**
 * The quotes of the threads whose elements live (on `slides` when given), by thread id: what the adapter reads just
 * before an update, a publish or a restore that may delete an element, for `storeDeletedQuotes` after it.
 */
export function captureQuotes(doc: Doc, options: { slides?: Iterable<string> } = {}): Map<string, string> {
  const only = options.slides ? new Set(options.slides) : null;
  const anchors: { id: string; slideId: string; elementId: string }[] = [];
  for (const id of Y.threadIds(doc)) {
    if (!Y.hasThread(doc, id)) continue;
    const s = Y.threadScalars(doc, id);
    const slideId = String(s.slideId ?? '');
    if (!only || only.has(slideId)) anchors.push({ id, slideId, elementId: String(s.elementId ?? '') });
  }
  return liveQuotesBySlide(doc, anchors);
}

/**
 * Runs a step that may remove commented elements without a removal writer (an undo of an element's creation, a redo of
 * its deletion; M7 fix wave 1), keeping their last text: the commented elements' quotes read just before it, stored for
 * those it removed in a transaction right after it, under the comments' origin (never undone). Offline the two merge into
 * one frame, whose quote the host's forwarding keeps (Decision Log 31). Answers the step's own answer.
 */
export function keepingRemovedQuotes(doc: Doc, step: () => boolean): boolean {
  const quotes = captureQuotes(doc);
  const done = step();
  if (done && quotes.size > 0) storeDeletedQuotes(doc, quotes, COMMENTS_ORIGIN);
  return done;
}

/** Each thread's stored quote now, by id (of `ids` when given): what a frame is compared with after it lands. */
export function storedQuotes(doc: Doc, ids?: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids ?? Y.threadIds(doc)) if (Y.hasThread(doc, id)) out.set(id, String(Y.threadScalars(doc, id).quote ?? ''));
  return out;
}

/**
 * Stores, for every thread `captured` whose element is gone now, the quote it had just before (one transaction, only
 * where the stored quote differs): the quote a deleted element's thread keeps. With `storedBefore` (fix wave 1), a
 * thread whose stored quote is no longer the one it had then is left alone: the frame that deleted the element wrote
 * its quote too (the replica's removal writer, which read text the host never had). Returns the ids written.
 */
export function storeDeletedQuotes(doc: Doc, captured: ReadonlyMap<string, string>, origin?: unknown, storedBefore?: ReadonlyMap<string, string>): string[] {
  const written: { id: string; quote: string }[] = [];
  for (const [id, quote] of captured) {
    if (!Y.hasThread(doc, id)) continue;
    const s = Y.threadScalars(doc, id);
    if (resolveAnchor(doc, { slideId: String(s.slideId ?? ''), elementId: String(s.elementId ?? '') }).live) continue;
    const stored = String(s.quote ?? '');
    if (storedBefore?.has(id) && storedBefore.get(id) !== stored) continue; // the frame wrote it
    if (stored !== quote) written.push({ id, quote });
  }
  if (written.length > 0) transact(doc, () => written.forEach(({ id, quote }) => Y.setThreadKey(doc, id, 'quote', quote)), origin);
  return written.map((w) => w.id).sort();
}
