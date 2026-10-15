// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D5): the presentation kind's host-side behaviour on A's
// `KindAdapter` (src/artifacts/host.ts): a new deck's first content, the files a read returns, the three-way publish,
// the repair after every update and restore, what a restore keeps, and the turn's summary; M3 adds the files' paths
// (A's `paths`, so a publish answers without reading the deck). Portable: the engine host registers it (M3), P4's
// network store the same. M7 (D9): the threads mirror (`artifact_threads`) of every thread an update touched, and the
// quote of a commented element refreshed while it lives, both from `afterUpdate` and, over every thread, `afterRestore`.
import type { Actor } from '@shared/artifacts/actor';
import type { KindAdapter, ThreadChange, ThreadRow } from '../host';
import { transact, type Doc } from '../yjs';
import { conversationsSince, touchedSlides, touchedThreads } from '../yjs/slides';
import { DECK_PATH, slideIdOf, type DeckJson } from './deck';
import { deckFiles, deckPaths, importSlide, repair, writeDeckKeys } from './model';
import { loadSlide } from './parse';
import { publishDeck } from './publish';
import { escAttr, escText } from './serialize';
import { getThread, listThreads, refreshQuotes, type DeckThread } from './threads';

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
  return {
    kind: 'presentation',
    initial: (doc, { title }) => writeInitialDeck(doc, title, now()),
    readFiles: deckFiles,
    paths: deckPaths,
    publish: publishDeck,
    // The repair lands as the triggering actor's write (the doc is that actor's host replica; X29 has no system actor),
    // scoped to the slides the update touched; a full scan when they cannot be told.
    afterUpdate: (live, { update }) => {
      const touched = touchedSlides(live, update);
      if (touched === null) repair(live);
      else if (touched.size > 0) repair(live, { slides: touched });
      // M7: the quotes of commented elements on the touched slides, then the mirror rows of every thread changed
      const quoted = touched === null ? refreshQuotes(live) : touched.size > 0 ? refreshQuotes(live, { slides: touched }) : [];
      const threads = mirrorRows(live, [...touchedThreads(live, update), ...quoted]);
      return threads ? { threads } : undefined;
    },
    revertScope: (live, old) => ({ keep: conversationsSince(live, old) }),
    afterRestore: (live) => {
      repair(live);
      refreshQuotes(live); // M7
      const upsert = listThreads(live).map(threadRow);
      return upsert.length ? { threads: { upsert } } : undefined;
    },
    summarizeTurn: summarizeDeckTurn,
  };
}
