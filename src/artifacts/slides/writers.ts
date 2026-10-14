// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Filmstrip"; M4): the filmstrip's slide gestures on
// the model, beside model.ts's element writers (kept apart while M3 edits model.ts's neighbours): one gesture one
// transaction with the caller's origin. Removing a slide carries the deck's references with it, as Claude asks of an
// agent (`deck-files.md`: "a `cover` or a section's `start` that named it set to the next slide's id").
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { DECK_LIMITS, type DeckSection } from './deck';
import type { SlideIR } from './ir';
import { heldOf, insertSlide, readSlide, slideOrder } from './model';
import { loadSlide } from './parse';

/**
 * Removes a slide. The deck's `cover` moves to the next slide (else the one before, else it goes); a section starting at
 * it starts at the next slide, or sits empty before it when that slide starts another section, and goes when no slide
 * follows (an empty section needs a slide to stand before).
 */
export function removeSlide(doc: Doc, slideId: string, origin?: unknown): void {
  const order = slideOrder(doc);
  const at = order.indexOf(slideId);
  const next = at >= 0 ? (order[at + 1] ?? null) : null;
  const before = at > 0 ? order[at - 1]! : null;
  const sections = Y.deckEntries(doc, 'sections') as Record<string, DeckSection> | undefined;
  const starts = new Set(Object.values(sections ?? {}).map((s) => s.start));
  transact(
    doc,
    () => {
      Y.deleteSlide(doc, slideId);
      if (Y.deckScalars(doc).cover === slideId) {
        const cover = next ?? before;
        if (cover === null) Y.deleteDeckKey(doc, 'cover');
        else Y.setDeckKey(doc, 'cover', cover);
      }
      for (const [key, section] of Object.entries(sections ?? {})) {
        if (section.start !== slideId && section.before !== slideId) continue;
        const rest: DeckSection = { ...section };
        delete rest.start;
        delete rest.before;
        if (next === null) Y.deleteDeckEntry(doc, 'sections', key);
        else if (section.start === slideId && !starts.has(next)) Y.setDeckEntry(doc, 'sections', key, { ...rest, start: next } as Y.Json);
        else Y.setDeckEntry(doc, 'sections', key, { ...rest, before: next } as Y.Json);
      }
    },
    origin,
  );
}

/** A copy of a slide right after it, under `newId`: its content, attributes and notes. A held slide is not copied. */
export function duplicateSlide(doc: Doc, slideId: string, newId: string, origin?: unknown): void {
  if (heldOf(doc, slideId)) throw new Error(`slide ${slideId} is held: its file does not load, so there is nothing to copy`);
  needRoom(doc);
  insertSlide(doc, { ...readSlide(doc, slideId), id: newId }, slideId, origin);
}

/** Sets a section of the outline (a rename, a new one), or removes it with null. */
export function setSection(doc: Doc, key: string, section: DeckSection | null, origin?: unknown): void {
  transact(
    doc,
    () => {
      if (section === null) Y.deleteDeckEntry(doc, 'sections', key);
      else Y.setDeckEntry(doc, 'sections', key, section as Y.Json);
    },
    origin,
  );
}

// Each replica's mint counter: never reset while the replica lives, so an id it gave out (a slide since removed) is
// never given again.
const minted = new WeakMap<Doc, number>();
function mint(doc: Doc, prefix: string, used: ReadonlySet<string>): string {
  const client = doc.clientID.toString(36); // the whole clientID (at most 11 characters for 2^53), so no two replicas share a prefix
  for (;;) {
    const n = (minted.get(doc) ?? 0) + 1;
    minted.set(doc, n);
    const id = `${prefix}${client}-${n}`; // `-` is outside base36: the clientID and the counter never run together
    if (!used.has(id)) return id;
  }
}

/**
 * A new slide id, `s<clientID base36>-<n>`: the writing replica's whole clientID and its own counter, so two replicas
 * adding slides at once never mint the same key (one would overwrite the other's slide), and a replica never reuses
 * one. An id the deck already holds, or in `taken` (a batch's own), is skipped.
 */
export function mintSlideId(doc: Doc, taken: Iterable<string> = []): string {
  return mint(doc, 's', new Set([...Y.slideIds(doc), ...taken]));
}

/** A key for a new section of the outline, `section<clientID base36>-<n>`, on the same counter as slide ids. */
export function mintSectionKey(doc: Doc): string {
  return mint(doc, 'section', new Set(Object.keys(Y.deckEntries(doc, 'sections') ?? {})));
}

/** Sets one of the deck's design-system overrides (`dsOverrides`, X28's `TokenOverrides`), or removes it with null. */
export function setDeckOverride(doc: Doc, name: string, value: string | null, origin?: unknown): void {
  transact(
    doc,
    () => {
      if (value === null) Y.deleteDeckEntry(doc, 'dsOverrides', name);
      else Y.setDeckEntry(doc, 'dsOverrides', name, value);
    },
    origin,
  );
}

/** How many more slides the deck holds (`DECK_LIMITS.slides`, the loader's and the publish's bound). */
export const slideRoom = (doc: Doc): number => DECK_LIMITS.slides - Y.slideIds(doc).length;

function needRoom(doc: Doc): void {
  if (slideRoom(doc) <= 0) throw new Error(`a deck holds at most ${DECK_LIMITS.slides} slides`);
}

/** A new slide after `afterId` (first when null), refused past the deck's slide limit. */
export function addSlide(doc: Doc, ir: SlideIR, afterId: string | null, origin?: unknown): void {
  needRoom(doc);
  insertSlide(doc, ir, afterId, origin);
}

/** A blank slide: the design system's ground, the 128 px margins, a column. Built through the loader, as every write is. */
export function blankSlide(id: string): SlideIR {
  const loaded = loadSlide(`<section id="${id}" style="background:var(--ds-color-bg, #ffffff); padding:128px; display:flex; flex-direction:column; gap:32px"></section>`, { fileId: id });
  if (!loaded.ok) throw new Error(`a blank slide does not load: ${loaded.held.reasons.join('; ')}`);
  return loaded.slide;
}
