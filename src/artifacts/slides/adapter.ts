// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D5): the presentation kind's host-side behaviour on A's
// `KindAdapter` (src/artifacts/host.ts): a new deck's first content, the files a read returns, the three-way publish,
// the repair after every update and restore, what a restore keeps, and the turn's summary; M3 adds the files' paths
// (A's `paths`, so a publish answers without reading the deck). Portable: the engine host registers it (M3), P4's
// network store the same. M7 (D9): the threads mirror (`artifact_threads`) of every thread an update touched, from
// `afterUpdate` and, over every thread, `afterRestore`; and (Decision Log 31's ruling) a commented element's last text
// stored in its thread when the element is deleted, read just before the deletion on each of its routes: a replica's
// frame (`beforeApply`'s forwarding edit), the agent's publish (`publish`) and a restore (`revertScope` reads, then
// `afterRestore` writes). While the element lives its quote is derived by every reader, so no keystroke writes a thread.
// P4-B2 D19: a restore carries the host's record of each Google Fonts face's fetch (`revertScope` reads the live records,
// `afterRestore` sets each on the restored face it still answers), so a deck restored to before the fetch draws its face
// offline at once and the host never fetches it again.
import type { Actor } from '@shared/artifacts/actor';
import type { KindAdapter, ThreadChange, ThreadRow } from '../host';
import { transact, type Doc } from '../yjs';
import { conversationsSince, deckEntries, setDeckEntry, slidesDeletedIn, touchedSlides, touchedThreads, type Json } from '../yjs/slides';
import { carryRecord, DECK_PATH, googleRecord, slideIdOf, type DeckFace, type DeckJson } from './deck';
import { deckFiles, deckPaths, importSlide, repair, writeDeckKeys } from './model';
import { loadSlide } from './parse';
import { publishDeck } from './publish';
import { escAttr, escText } from './serialize';
import { captureQuotes, getThread, listThreads, storeDeletedQuotes, storedQuotes, type DeckThread } from './threads';

export const COVER_ID = 'cover';

/**
 * The cover a new deck starts with (D5): the shape of D's `layouts/title.html` with its placeholders stripped, every
 * value a design-system token with a fallback, so the deck restyles by its system.
 */
export function coverSlide(title: string): string {
  const role = (name: 'title' | 'subtitle', size: number, line: number, weight: number, color: string) =>
    [
      `font-family:var(--ds-font-display, system-ui, sans-serif)`,
      `font-size:var(--ds-type-${name}-size, ${size}px)`,
      `line-height:var(--ds-type-${name}-line, ${line})`,
      `font-weight:var(--ds-type-${name}-weight, ${weight})`,
      `color:var(${color})`,
    ].join(';');
  return [
    `<section id="${COVER_ID}" style="background:var(--ds-color-bg, #ffffff);padding:128px;display:flex;flex-direction:column;justify-content:flex-end;gap:30px">`,
    `  <h1 id="title" style="${escAttr(role('title', 96, 1.1, 700, '--ds-color-text, #1a1a1a'))}">${escText(title)}</h1>`,
    `  <p id="subtitle" style="${escAttr(role('subtitle', 40, 1.3, 500, '--ds-color-text-muted, #6a7179'))}"></p>`,
    `</section>`,
  ].join('\n');
}

/** A new deck's index and cover slide, written into `doc` in one transaction. */
export function writeInitialDeck(doc: Doc, title: string, at: Date): void {
  const loaded = loadSlide(coverSlide(title), { fileId: COVER_ID });
  if (!loaded.ok) throw new Error(`the cover slide does not load: ${loaded.held.reasons.join('; ')}`);
  const deck: DeckJson = { v: 4, createdOnFiles: { v: 1, at: at.toISOString().replace(/\.\d{3}Z$/, 'Z') }, title, cover: COVER_ID, order: [COVER_ID] };
  transact(doc, () => {
    writeDeckKeys(doc, deck);
    importSlide(doc, loaded.slide, 'a0');
  });
}

/**
 * "Published N slides (M changed, K added, J removed)" over a turn's publish answers (`changed`, `removed`, `added`),
 * then the lines of its thread answers (`artifact_reply`, `artifact_resolve`; M7), one per line.
 */
export function summarizeDeckTurn(results: unknown[]): string {
  const lines = results.flatMap((result) => {
    const line = (result as { line?: unknown } | null)?.line;
    return typeof line === 'string' ? [line] : [];
  });
  const publishes = results.filter((result) => typeof (result as { line?: unknown } | null)?.line !== 'string');
  if (publishes.length === 0 && lines.length > 0) return lines.join('\n');
  return [summarizePublishes(publishes), ...lines].join('\n');
}

function summarizePublishes(results: unknown[]): string {
  const added = new Set<string>();
  const changed = new Set<string>();
  const removed = new Set<string>();
  let index = false;
  const paths = (v: unknown): string[] => (Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []);
  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue;
    const r = result as Record<string, unknown>;
    const fresh = new Set(paths(r.added));
    for (const p of paths(r.removed)) {
      if (slideIdOf(p) === null) continue;
      if (added.delete(p)) continue; // added and removed in one turn: nothing
      changed.delete(p);
      removed.add(p);
    }
    for (const p of paths(r.changed)) {
      if (p === DECK_PATH) index = true;
      if (slideIdOf(p) === null) continue;
      if (fresh.has(p)) {
        removed.delete(p);
        added.add(p);
      } else if (!added.has(p)) changed.add(p);
    }
  }
  const n = added.size + changed.size + removed.size;
  if (n === 0) return index ? 'Published the deck’s index' : 'Published the deck';
  return `Published ${n} slide${n === 1 ? '' : 's'} (${changed.size} changed, ${added.size} added, ${removed.size} removed)`;
}

// One row of the threads mirror (B's shape, src/artifacts/document/adapter.ts): the library and the session panel list
// threads from it without opening the deck.
const threadRow = (thread: DeckThread): ThreadRow => ({
  threadId: thread.id,
  status: thread.status,
  quote: thread.quote,
  createdAt: thread.createdAt,
  updatedAt: Math.max(thread.createdAt, thread.resolvedAt ?? 0, thread.reopenedAt ?? 0, ...thread.messages.map((message) => message.at)),
  ...(thread.status === 'resolved' && thread.resolvedAt != null ? { resolvedAt: thread.resolvedAt } : {}),
  ...(thread.createdBy.kind === 'session' ? { appSessionId: (thread.createdBy as Extract<Actor, { kind: 'session' }>).appSessionId } : {}),
});

/** The faces whose host record validates, by key: what a restore carries (D19). */
function liveRecords(doc: Doc): Map<string, DeckFace> {
  const out = new Map<string, DeckFace>();
  for (const [key, face] of Object.entries((deckEntries(doc, 'faces') ?? {}) as Record<string, DeckFace>)) if (face && typeof face === 'object' && googleRecord(face)) out.set(key, face);
  return out;
}

/** Sets each carried record on the restored face it answers and that holds none (inside the restore's write). */
function carryRecords(doc: Doc, records: ReadonlyMap<string, DeckFace>): void {
  const faces = (deckEntries(doc, 'faces') ?? {}) as Record<string, DeckFace>;
  for (const [key, live] of records) {
    const restored = faces[key];
    if (!restored || typeof restored !== 'object' || googleRecord(restored)) continue;
    const carried = carryRecord(restored, live);
    if (carried !== restored) setDeckEntry(doc, 'faces', key, carried as Json);
  }
}

function mirrorRows(doc: Doc, threadIds: Iterable<string>): ThreadChange | undefined {
  const upsert: ThreadRow[] = [];
  const remove: string[] = [];
  for (const id of [...new Set(threadIds)].sort()) {
    const thread = getThread(doc, id);
    if (thread) upsert.push(threadRow(thread));
    else remove.push(id);
  }
  if (upsert.length === 0 && remove.length === 0) return undefined;
  return { ...(upsert.length ? { upsert } : {}), ...(remove.length ? { remove } : {}) };
}

export function createPresentationAdapter(options: { now?: () => Date } = {}): KindAdapter {
  const now = options.now ?? (() => new Date());
  // Per artifact, the quotes a restore's `revertScope` read from the live deck just before its write, for its
  // `afterRestore` (Decision Log 27 of A: a kind's per-artifact state); taken by the next restore of that artifact.
  const beforeRestore = new Map<string, { quotes: Map<string, string>; faces: Map<string, DeckFace> }>();
  // Fix wave 1: the threads a frame's forwarding edit stored a quote in, for the `afterUpdate` that follows it on the same
  // replica (A calls both in one frame), whose mirror rows otherwise cover only what the frame itself touched.
  const forwarded = new WeakMap<Doc, string[]>();
  return {
    kind: 'presentation',
    initial: (doc, { title }) => writeInitialDeck(doc, title, now()),
    readFiles: deckFiles,
    paths: deckPaths,
    // The agent's publish: the commented elements' quotes read first, stored for those its removals take away.
    publish: (live, base, sent, force) => {
      const quotes = captureQuotes(live);
      const outcome = publishDeck(live, base, sent, force);
      if (quotes.size > 0) storeDeletedQuotes(live, quotes);
      return outcome;
    },
    // A replica's frame that deletes content of a slide with threads: their quotes read before it lands, the forwarding
    // edit storing those of the elements it took away. A frame that deletes nothing in the slides has none. Fix wave 1: a
    // quote the frame wrote itself (the replica's removal writer, which read text this host may never have had, as in a
    // reconnecting replica's merged rewrite and deletion) is kept; the threads written are mirrored by `afterUpdate`.
    beforeApply: (live, incoming) => {
      const slides = slidesDeletedIn(live, incoming);
      if (slides !== null && slides.size === 0) return null;
      const quotes = captureQuotes(live, slides === null ? {} : { slides });
      if (quotes.size === 0) return null;
      const before = storedQuotes(live, quotes.keys());
      return (doc) => {
        const written = storeDeletedQuotes(doc, quotes, undefined, before);
        if (written.length > 0) forwarded.set(doc, written);
      };
    },
    // The repair lands as the triggering actor's write (the doc is that actor's host replica; X29 has no system actor),
    // scoped to the slides the update touched; a full scan when they cannot be told.
    afterUpdate: (live, { update }) => {
      const touched = touchedSlides(live, update);
      if (touched === null) repair(live);
      else if (touched.size > 0) repair(live, { slides: touched });
      // M7: the mirror rows of every thread the update changed, and (fix wave 1) of those its forwarding edit wrote
      const carried = forwarded.get(live) ?? [];
      forwarded.delete(live);
      const threads = mirrorRows(live, [...touchedThreads(live, update), ...carried]);
      return threads ? { threads } : undefined;
    },
    revertScope: (live, old, { artifactId }) => {
      beforeRestore.set(artifactId, { quotes: captureQuotes(live), faces: liveRecords(live) });
      return { keep: conversationsSince(live, old) };
    },
    afterRestore: (live, { artifactId }) => {
      repair(live);
      const before = beforeRestore.get(artifactId);
      beforeRestore.delete(artifactId);
      if (before) storeDeletedQuotes(live, before.quotes); // M7: the elements the restore took away keep their last text
      if (before?.faces.size) transact(live, () => carryRecords(live, before.faces)); // D19
      const upsert = listThreads(live).map(threadRow);
      return upsert.length ? { threads: { upsert } } : undefined;
    },
    summarizeTurn: summarizeDeckTurn,
  };
}
