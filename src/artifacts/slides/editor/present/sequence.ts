// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D13; M6): the show's order, read from the model. The
// show is the deck's slides in order without the hidden ones. A slide's builds (`data-build-in` and `data-build-out`
// on its pinned elements: an effect, an order 1 to 50, `auto`) play as clicks: builds sort by their order number (the
// unnumbered after, in the slide's order); builds of one number are one click, played together; an `auto` build plays
// by itself right after the builds before it (a beat later in the same click, its number's click when it has one), or
// on the slide's entry when nothing precedes it. A position is a slide and how many clicks have played on it (0 to `clicks`); next plays the slide's next
// click or moves to the next slide, back undoes a click or returns to the previous slide fully built. Positions name
// slides by id, so a re-order or a removal while the show runs keeps the show where it can be. Portable (§4.10).
import type { Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { childLists, readFlat, ROOT, slideOrder } from '../../model';

export const BUILD_EFFECTS = ['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop'] as const;
export type BuildEffect = (typeof BUILD_EFFECTS)[number];
export type Transition = 'fade' | 'push' | 'magic';

export interface BuildEvent {
  /** The element's id. */
  id: string;
  kind: 'in' | 'out';
  effect: BuildEffect;
  order: number | null;
  auto: boolean;
}
/** Builds played together. */
export type Beat = BuildEvent[];

export interface SlideSteps {
  slideId: string;
  /** How the slide leaves (`data-transition`); null cuts. */
  transition: Transition | null;
  /** `groups[0]`: the beats played on entry (auto builds before any click); `groups[k]`: the k-th click's beats. */
  groups: Beat[][];
  clicks: number;
}

export interface Position {
  slideId: string;
  /** Clicks played on the slide. */
  build: number;
}

function parseBuild(value: string | undefined): Omit<BuildEvent, 'id' | 'kind'> | null {
  if (!value) return null;
  const words = value.trim().split(/\s+/);
  const effect = words.find((w): w is BuildEffect => (BUILD_EFFECTS as readonly string[]).includes(w));
  if (!effect) return null;
  const order = words.find((w) => /^\d+$/.test(w));
  return { effect, order: order === undefined ? null : Number(order), auto: words.includes('auto') };
}

/** The show's slides: the deck's order without the hidden ones. */
export function showSlides(doc: Doc): string[] {
  return slideOrder(doc).filter((id) => Y.slideScalars(doc, id)['attr:hidden'] === undefined);
}

/** A slide's transition and builds. */
export function slideSteps(doc: Doc, slideId: string): SlideSteps {
  const transition = Y.hasSlide(doc, slideId) ? (Y.slideScalars(doc, slideId)['attr:data-transition'] as Transition | undefined) : undefined;
  const events: (BuildEvent & { at: number })[] = [];
  if (Y.hasSlide(doc, slideId)) {
    // the slide's elements in its own order (paint order within each parent), depth first
    const lists = childLists(readFlat(doc, slideId, false));
    let at = 0;
    const walk = (parent: string) => {
      for (const e of lists.get(parent) ?? []) {
        for (const kind of ['in', 'out'] as const) {
          const build = parseBuild(e.attrs[`data-build-${kind}`]);
          if (build) events.push({ id: e.id, kind, ...build, at: at++ });
        }
        walk(e.id);
      }
    };
    walk(ROOT);
  }
  events.sort((a, b) => (a.order ?? 51) - (b.order ?? 51) || a.at - b.at);
  // fix wave 1: builds of one order number are gathered first (an unnumbered build is a set of its own); a set with a
  // build that is not `auto` is a click, those builds its first beat and its `auto` ones a beat each after; a set of
  // `auto` builds only follows the click before it (or the entry), a beat each
  const sets: BuildEvent[][] = [];
  for (const { id, kind, effect, order, auto } of events) {
    const event: BuildEvent = { id, kind, effect, order, auto };
    const last = sets.at(-1);
    if (order !== null && last && last[0]!.order === order) last.push(event);
    else sets.push([event]);
  }
  const groups: Beat[][] = [[]];
  for (const set of sets) {
    const clicked = set.filter((e) => !e.auto);
    const beats = set.filter((e) => e.auto).map((e) => [e]);
    if (clicked.length) groups.push([clicked, ...beats]);
    else groups[groups.length - 1]!.push(...beats);
  }
  return { slideId, transition: transition ?? null, groups, clicks: groups.length - 1 };
}

/** The elements hidden after `build` clicks: those not yet built in, and those built out. */
export function hiddenAt(steps: SlideSteps, build: number): Set<string> {
  const hidden = new Set<string>();
  const shown = new Set<string>();
  steps.groups.forEach((group, g) => {
    for (const beat of group)
      for (const e of beat) {
        if (e.kind === 'in' && g > build && !shown.has(e.id)) hidden.add(e.id);
        if (e.kind === 'in' && g <= build) {
          shown.add(e.id);
          hidden.delete(e.id);
        }
        if (e.kind === 'out' && g <= build) hidden.add(e.id);
      }
  });
  return hidden;
}

const at = (slideId: string, build: number): Position => ({ slideId, build });

export function firstPosition(doc: Doc): Position | null {
  const first = showSlides(doc)[0];
  return first === undefined ? null : at(first, 0);
}

export function lastPosition(doc: Doc): Position | null {
  const last = showSlides(doc).at(-1);
  return last === undefined ? null : at(last, slideSteps(doc, last).clicks);
}

/** Where the show starts: the slide asked for, else the next visible slide after it, else the first. */
export function startPosition(doc: Doc, slideId: string | null): Position | null {
  const show = showSlides(doc);
  if (slideId !== null) {
    if (show.includes(slideId)) return at(slideId, 0);
    const order = slideOrder(doc);
    const from = order.indexOf(slideId);
    const after = from < 0 ? undefined : order.slice(from + 1).find((id) => show.includes(id));
    if (after !== undefined) return at(after, 0);
  }
  return firstPosition(doc);
}

/**
 * The slide a position stands at in the show, by its place in the deck when its slide left the show: a hidden slide's in
 * the deck now, a removed one's in `seen`, the deck's order as last seen holding it (P3-F).
 */
function placeOf(doc: Doc, show: readonly string[], slideId: string, seen: readonly string[] = []): { index: number; inShow: boolean } {
  const index = show.indexOf(slideId);
  if (index >= 0) return { index, inShow: true };
  const live = slideOrder(doc);
  const order = live.includes(slideId) ? live : seen;
  const from = order.indexOf(slideId);
  // the show's next slide after it stands in its place, else (at the end) the one before it; a slide never seen: the
  // show's start, as startPosition takes it
  if (from < 0) return { index: 0, inShow: false };
  const after = order.slice(from + 1).find((id) => show.includes(id));
  return { index: after === undefined ? show.length : show.indexOf(after), inShow: false };
}

export function nextPosition(doc: Doc, pos: Position): Position | null {
  const show = showSlides(doc);
  const { index, inShow } = placeOf(doc, show, pos.slideId);
  if (inShow && pos.build < slideSteps(doc, pos.slideId).clicks) return at(pos.slideId, pos.build + 1);
  const next = show[inShow ? index + 1 : index];
  return next === undefined ? null : at(next, 0);
}

export function prevPosition(doc: Doc, pos: Position): Position | null {
  const show = showSlides(doc);
  const { index, inShow } = placeOf(doc, show, pos.slideId);
  if (inShow && pos.build > 0) return at(pos.slideId, Math.min(pos.build - 1, slideSteps(doc, pos.slideId).clicks));
  const prev = show[index - 1];
  return prev === undefined ? null : at(prev, slideSteps(doc, prev).clicks);
}

/**
 * The position itself when it still stands in the show (its build within the slide's clicks), else the nearest one;
 * `seen` is the deck's order as last seen holding the position's slide, where a slide removed since stood.
 */
export function settlePosition(doc: Doc, pos: Position, seen?: readonly string[]): Position | null {
  const show = showSlides(doc);
  const { index, inShow } = placeOf(doc, show, pos.slideId, seen);
  if (inShow) return at(pos.slideId, Math.min(pos.build, slideSteps(doc, pos.slideId).clicks));
  const near = show[index] ?? show[index - 1];
  return near === undefined ? null : at(near, 0);
}
