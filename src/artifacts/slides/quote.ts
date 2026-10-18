// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Decision Log 31; M7 fix wave 1): a comment's quote,
// what its element says or what it is, and the store of it a writer makes as it removes commented elements. Kept apart
// from threads.ts so the model's own removal writers (model.ts, writers.ts, writers-elements.ts) store a removed
// element's last text in their transaction without importing the thread module (which reads the model).
import type { Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { CONTAINER_TAGS, type TextBlock } from './ir';
import type { FlatElement } from './model';

/** The longest quote kept: a container's or a table's text is cut here. */
export const QUOTE_MAX = 500;

export const blocksText = (blocks: readonly TextBlock[]): string => blocks.map((b) => b.inline.map((r) => ('text' in r ? r.text : ' ')).join('')).join('\n');
export const clipQuote = (text: string): string => (text.length <= QUOTE_MAX ? text : `${text.slice(0, QUOTE_MAX - 1)}…`);

/**
 * P3-E (E1; the P3-E spec's Decision Log 13 (2)): a design's board is a slide node carrying its frame as plain numbers
 * (`x`, `y`, `w`, `h`), and a board-level comment anchors its `ROOT`. Its quote is the board's title, else its id; null
 * when the slide is not a board (a deck's slide has no frame, so a deck's anchors read as before).
 */
export function boardQuote(doc: Doc, slideId: string): string | null {
  if (!Y.hasSlide(doc, slideId)) return null;
  const s = Y.slideScalars(doc, slideId);
  if (![s.x, s.y, s.w, s.h].every((v) => typeof v === 'number')) return null;
  const title = typeof s.title === 'string' ? s.title.trim() : '';
  return clipQuote(title || slideId);
}

/** An element's quote: its text, a container's descendants' text, else its tag with alt or aria-label, or its kind. */
export function quoteOf(e: FlatElement, lists: ReadonlyMap<string, FlatElement[]>): string {
  const texts: string[] = [];
  const walk = (el: FlatElement) => {
    if (el.text) {
      const t = blocksText(el.text).trim();
      if (t) texts.push(t);
    }
    if (CONTAINER_TAGS.has(el.tag)) for (const child of lists.get(el.id) ?? []) walk(child);
  };
  walk(e);
  if (texts.length > 0) return clipQuote(texts.join('\n'));
  const what = e.attrs.alt ?? e.attrs['aria-label'];
  if (what) return clipQuote(`${e.tag} “${what}”`);
  const kind = e.tag === 'x-shape' ? e.attrs.kind : e.tag === 'x-icon' ? e.attrs.name : undefined;
  return kind ? `${e.tag} ${kind}` : e.tag;
}

/**
 * A removal writer's store of the last text (fix wave 1): before it deletes `removed` (element ids of `slideId`; null,
 * the whole slide), every thread anchored there gets its element's quote now, written where it differs, in the caller's
 * transaction. So the deletion and the text it took away travel in one update, and a reconnecting replica's merged frame
 * (a rewrite, then the deletion) carries the rewritten text the host could not have read. `read` is called only when a
 * thread is anchored there (the slide's elements with their text, and their child lists).
 */
export function storeRemovedQuotes(doc: Doc, slideId: string, removed: ReadonlySet<string> | null, read: () => { flat: FlatElement[]; lists: ReadonlyMap<string, FlatElement[]> }): void {
  const anchored: { id: string; elementId: string; quote: string }[] = [];
  for (const id of Y.threadIds(doc)) {
    if (!Y.hasThread(doc, id)) continue;
    const s = Y.threadScalars(doc, id);
    const elementId = String(s.elementId ?? '');
    if (s.slideId === slideId && (removed === null || removed.has(elementId))) anchored.push({ id, elementId, quote: String(s.quote ?? '') });
  }
  if (anchored.length === 0) return;
  const { flat, lists } = read();
  const byId = new Map(flat.map((e) => [e.id, e]));
  for (const t of anchored) {
    const e = byId.get(t.elementId);
    const quote = e ? quoteOf(e, lists) : t.elementId === '' && removed === null ? boardQuote(doc, slideId) : null; // P3-E: a board's ROOT
    if (quote !== null && quote !== t.quote) Y.setThreadKey(doc, t.id, 'quote', quote);
  }
}
