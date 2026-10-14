// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Filmstrip"; M4): the deck as the editor's chrome
// reads it: the slides in order (hidden, held with its reasons, and a token of each slide's node so a view re-mounts when
// a slide is written anew), the outline's sections placed before their slides, the deck's overrides and faces. Read
// again at every update of the replica, and the same object returned while nothing it shows changed, so a drag's frames
// re-render nothing here.
import { useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { slideToken } from '../../yjs/slides-observe';
import type { DeckFace, DeckSection } from '../deck';
import { heldOf, slideOrder } from '../model';

export interface SlideEntry {
  id: string;
  hidden: boolean;
  held: readonly string[] | null; // the reasons its file does not load
  token: object;
}
export interface SectionHeader {
  key: string;
  description: string;
  /** The slide the header stands before. */
  before: string;
  /** No slide of its own yet (Claude's `before`). */
  empty: boolean;
}
export interface DeckView {
  title: string;
  slides: readonly SlideEntry[];
  sections: readonly SectionHeader[];
  overrides: Readonly<Record<string, string>>;
  faces: Readonly<Record<string, DeckFace>>;
}

export function readDeckView(doc: Doc): DeckView {
  const order = slideOrder(doc);
  const slides = order.map((id): SlideEntry => {
    const s = Y.slideScalars(doc, id);
    return { id, hidden: s['attr:hidden'] !== undefined, held: heldOf(doc, id)?.reasons ?? null, token: slideToken(doc, id)! };
  });
  const present = new Set(order);
  const sections: SectionHeader[] = [];
  for (const [key, value] of Object.entries((Y.deckEntries(doc, 'sections') ?? {}) as Record<string, DeckSection>)) {
    const at = value.start ?? value.before;
    if (typeof at !== 'string' || !present.has(at)) continue;
    sections.push({ key, description: typeof value.description === 'string' ? value.description : '', before: at, empty: value.start === undefined });
  }
  // several headers before one slide: the empty ones first, then by key
  sections.sort((a, b) => order.indexOf(a.before) - order.indexOf(b.before) || Number(b.empty) - Number(a.empty) || (a.key < b.key ? -1 : 1));
  const title = Y.deckScalars(doc).title;
  return {
    title: typeof title === 'string' ? title : '',
    slides,
    sections,
    overrides: (Y.deckEntries(doc, 'dsOverrides') ?? {}) as Record<string, string>,
    faces: (Y.deckEntries(doc, 'faces') ?? {}) as unknown as Record<string, DeckFace>,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameSlides = (a: readonly SlideEntry[], b: readonly SlideEntry[]) =>
  a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.hidden === b[i]!.hidden && s.token === b[i]!.token && sameJson(s.held, b[i]!.held));

/** `next` with every part equal to `prev`'s replaced by `prev`'s, and `prev` itself when nothing changed. */
export function keepEqual(prev: DeckView, next: DeckView): DeckView {
  const view: DeckView = {
    title: next.title,
    slides: sameSlides(prev.slides, next.slides) ? prev.slides : next.slides,
    sections: sameJson(prev.sections, next.sections) ? prev.sections : next.sections,
    overrides: sameJson(prev.overrides, next.overrides) ? prev.overrides : next.overrides,
    faces: sameJson(prev.faces, next.faces) ? prev.faces : next.faces,
  };
  return view.title === prev.title && view.slides === prev.slides && view.sections === prev.sections && view.overrides === prev.overrides && view.faces === prev.faces ? prev : view;
}

const views = new WeakMap<Doc, { view: DeckView; stale: boolean }>();
function current(doc: Doc): DeckView {
  const held = views.get(doc);
  if (held && !held.stale) return held.view;
  const view = held ? keepEqual(held.view, readDeckView(doc)) : readDeckView(doc);
  views.set(doc, { view, stale: false });
  return view;
}

/** The deck view, followed through the replica's updates. */
export function useDeckView(doc: Doc): DeckView {
  return useSyncExternalStore(
    (listener) =>
      onUpdate(doc, () => {
        const held = views.get(doc);
        if (held) held.stale = true;
        listener();
      }),
    () => current(doc),
  );
}
