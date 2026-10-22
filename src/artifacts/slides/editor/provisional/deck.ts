// P4-A2 G2.3 (X35, the slide editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md
// G-R1, G-R2, G-R5; §4.2's four rules [binding]): what a publish streaming into an open deck (or design: a board is a
// slide of the deck model with a size) draws, read from the layers' store (`ProvisionalLayers`, one per handle in the
// tab's state). Each slide a layer's files name is "being written" from the frame that names its file; its file so far
// is merged over the live slide (`provisionalSlide`, G-R2) and, once it differs, written into a scratch doc, so the
// canvases draw it with the canvas's own code: what the layer draws is what the commit will draw. The live doc is never
// written (rule 1). A slide's drawing follows the live slide as it changes (a change made meanwhile is drawn under the
// agent's), and goes when the layer goes: at a refusal at once, at the commit in the call that integrates the write
// (the store's rule 2), so the canvases' own patch of the write and the layer's withdrawal land in one task.
import type { ArtifactProvisional } from '@shared/artifacts/provisional';
import { openFile, type ProvisionalLayers } from '../../../provisional';
import { newDoc, onUpdate, transact, type Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { slideToken } from '../../../yjs/slides-observe';
import { DECK_PATH, slideIdOf, slidePath } from '../../deck';
import { insertSlide, readSlide, slideFile } from '../../model';
import { loadSlide } from '../../parse';
import { provisionalOrder, provisionalSlide, type ProvisionalSlide } from '../../provisional';
import { publishDeck } from '../../publish';

/** Where a slide stands in a world of slides (a design's board: its frame), in its own px. */
export interface ProvisionalFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which of a publish's files are slides (and which one is the index) for the artifact's kind. */
export interface ProvisionalFiles {
  slideOf(path: string): string | null;
  indexPath: string;
  /**
   * P4-A2 G2.4 (G-R6): where a slide new to the artifact will stand, from the streamed index and its file so far; null
   * until the index places it. Absent for a deck, whose slides have no place but their order.
   */
  frameOf?(live: Doc, slideId: string, index: { text: string; open: boolean }, file: string): ProvisionalFrame | null;
}
/** A deck's files: `project/slides/<id>.html` and `project/deck.json`. */
export const DECK_FILES: ProvisionalFiles = { slideOf: slideIdOf, indexPath: DECK_PATH };

/** A slide a streaming publish is writing. */
export interface WrittenSlide {
  toolUseId: string;
  /** The agent as presence names it, and its author colour (`--author-n`). */
  name: string;
  color: string;
  /** Not (yet) a slide of the live deck. */
  isNew: boolean;
  /** What differs from the live slide, the file drawn into the scratch doc; null while nothing does (or it is held). */
  drawn: ProvisionalSlide | null;
  /** A new slide's place once the index gives it (`ProvisionalFiles.frameOf`); null otherwise. */
  frame: ProvisionalFrame | null;
  /**
   * A new slide's own call's index (`deck.json`, `canvas.json`) as far as it streamed, if the call sends one; null for a
   * slide the live deck holds. Another call streaming at once names its own new slides, never this one.
   */
  index: StreamedIndex | null;
}

/** A publish's index file as far as it streamed. */
export interface StreamedIndex {
  text: string;
  open: boolean;
}

export interface DeckProvisionalSnapshot {
  /** The slides being written, in the order their files arrived. */
  slides: ReadonlyMap<string, WrittenSlide>;
}

const EMPTY: DeckProvisionalSnapshot = Object.freeze({ slides: new Map() });

/**
 * The deck's order with each new slide being written at its place in its own call's streamed index (G-R5): each call's
 * new slides placed in turn, in the order the calls began, so one call's index never unplaces another call's slide.
 */
export function writtenOrder(snapshot: DeckProvisionalSnapshot, liveOrder: readonly string[]): readonly string[] {
  const calls = new Map<string, { index: StreamedIndex | null; added: string[] }>();
  for (const [id, slide] of snapshot.slides) {
    if (!slide.isNew || slide.drawn === null) continue;
    const call = calls.get(slide.toolUseId) ?? { index: slide.index, added: [] };
    call.added.push(id);
    calls.set(slide.toolUseId, call);
  }
  let order = liveOrder;
  for (const { index, added } of calls.values()) order = provisionalOrder(order, added, index?.text, index?.open ?? false);
  return order;
}

interface Computed {
  op: object; // the store's file op: the same object while its file did not grow
  open: boolean;
  isNew: boolean;
  drawn: ProvisionalSlide | null;
}

export class DeckProvisional {
  private drawing: Doc = newDoc();
  /** The provisional slides; renewed when the last drawing goes so deleted Yjs history cannot accumulate. */
  get scratch(): Doc { return this.drawing; }
  private current: DeckProvisionalSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly computed = new Map<string, Computed>();
  private readonly written = new Map<string, string>(); // the file the scratch holds, by slide
  private readonly observed = new Map<string, { token: object; stop: () => void }>(); // the live slides being written
  private readonly dirty = new Set<string>(); // live slides changed since they were last merged

  constructor(
    private readonly layers: ProvisionalLayers,
    readonly live: Doc,
    private readonly files: ProvisionalFiles = DECK_FILES,
  ) {}

  /** Starts following the store and the live doc; returns the stop, which clears every trace. */
  attach(): () => void {
    const offLayers = this.layers.subscribe(() => this.recompute());
    // after every observer of the update (the canvases' patches included): a written slide changed, or one that was
    // new now exists (the write arrived) or one that existed is gone
    const offUpdate = onUpdate(this.live, () => {
      if (this.current.slides.size === 0) return;
      if (this.dirty.size > 0 || [...this.current.slides].some(([id, slide]) => slide.isNew === Y.hasSlide(this.live, id))) this.recompute();
    });
    this.recompute();
    return () => {
      offLayers();
      offUpdate();
      for (const { stop } of this.observed.values()) stop();
      this.observed.clear();
      this.dirty.clear();
      this.computed.clear();
      this.forget([...this.written.keys()]);
      this.commit(EMPTY);
    };
  }

  snapshot = (): DeckProvisionalSnapshot => this.current;

  /** Told once per change of the snapshot, synchronously; returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private recompute(): void {
    const files: { id: string; layer: ArtifactProvisional; text: string; drawn: ProvisionalSlide | null; own: { index: StreamedIndex | null } }[] = [];
    for (const layer of this.layers.get().values()) {
      const open = openFile(layer);
      const own: { index: StreamedIndex | null } = { index: null }; // this call's index, which may stream before or after its files
      for (const op of layer.ops) {
        if (op.op !== 'file') continue;
        if (op.path === this.files.indexPath) {
          own.index = { text: op.text, open: op.path === open };
          continue;
        }
        const id = this.files.slideOf(op.path);
        if (id !== null) files.push({ id, layer, text: op.text, drawn: this.draw(id, op, op.path === open), own });
      }
    }
    // a new slide's place from its own call's index (another call streaming at once names other new slides, not this one)
    const slides = new Map<string, WrittenSlide>();
    for (const { id, layer, text, drawn, own } of files) {
      const isNew = !Y.hasSlide(this.live, id);
      const frame = isNew && own.index && this.files.frameOf ? this.files.frameOf(this.live, id, own.index, text) : null;
      const slide: WrittenSlide = { toolUseId: layer.toolUseId, name: layer.name, color: layer.color, isNew, drawn, frame, index: isNew ? own.index : null };
      const was = this.current.slides.get(id);
      slides.set(id, was && sameSlide(was, slide) ? was : slide);
    }
    this.dirty.clear();
    for (const id of [...this.computed.keys()]) if (!slides.has(id)) this.computed.delete(id);
    this.fit(slides);
    this.observe(slides);
    const same = slides.size === this.current.slides.size && [...slides].every(([id, slide]) => this.current.slides.get(id) === slide);
    if (!same) this.commit(slides.size === 0 ? EMPTY : { slides });
    // after the commit: a withdrawn ghost entry keeps the drawing it froze on it, not one the scratch already dropped
    this.forget([...this.written.keys()].filter((id) => !slides.has(id)));
  }

  // The slide's drawing for the file so far, merged again only when the file grew, the live slide changed or came.
  private draw(id: string, op: { text: string }, open: boolean): ProvisionalSlide | null {
    const isNew = !Y.hasSlide(this.live, id);
    const was = this.computed.get(id);
    if (was && was.op === op && was.open === open && was.isNew === isNew && !this.dirty.has(id)) return was.drawn;
    let drawn = provisionalSlide(id, isNew ? null : readSlide(this.live, id), op.text, open);
    if (drawn && was?.drawn && sameDrawn(drawn, was.drawn)) drawn = was.drawn;
    if (drawn && this.written.get(id) !== drawn.file && !this.write(id, drawn.file)) drawn = null;
    this.computed.set(id, { op, open, isNew, drawn });
    return drawn;
  }

  // The provisional file into the scratch doc, by the deck's own publish (property by property, so the canvas over it
  // patches only what changed); the first time, the slide made from it (its size is `fit`'s).
  private write(id: string, file: string): boolean {
    try {
      if (Y.hasSlide(this.scratch, id)) {
        const path = slidePath(id);
        if (publishDeck(this.scratch, { [path]: slideFile(this.scratch, id) }, { [path]: file }, true).held.length > 0) return false;
      } else {
        const loaded = loadSlide(file, { fileId: id });
        if (!loaded.ok) return false;
        transact(this.scratch, () => insertSlide(this.scratch, loaded.slide, null));
      }
    } catch {
      return false; // a merge the publish refuses (a limit the merged slide passes) is not drawn
    }
    this.written.set(id, file);
    return true;
  }

  // A board's size on its scratch slide (its section's, which the canvas draws at): the live board's as it is now (a
  // resize meanwhile followed), a new board's from its frame once placed; a deck's slide has none.
  private fit(slides: ReadonlyMap<string, WrittenSlide>): void {
    const writes: [string, number, number][] = [];
    for (const [id, slide] of slides) {
      if (!this.written.has(id)) continue;
      const size = slide.isNew ? slide.frame : Y.slideScalars(this.live, id);
      if (typeof size?.w !== 'number' || typeof size.h !== 'number') continue;
      const now = Y.slideScalars(this.scratch, id);
      if (now.w !== size.w || now.h !== size.h) writes.push([id, size.w, size.h]);
    }
    if (writes.length === 0) return;
    transact(this.scratch, () => {
      for (const [id, w, h] of writes) {
        Y.setSlideKey(this.scratch, id, 'w', w);
        Y.setSlideKey(this.scratch, id, 'h', h);
      }
    });
  }

  private forget(ids: readonly string[]): void {
    if (ids.length === 0) return;
    transact(this.scratch, () => ids.forEach((id) => Y.hasSlide(this.scratch, id) && Y.deleteSlide(this.scratch, id)));
    ids.forEach((id) => this.written.delete(id));
    if (this.written.size === 0) {
      this.drawing.destroy();
      this.drawing = newDoc();
    }
  }

  // One observer per live slide being written, bound to its node as it is now (a slide written anew is a new node).
  private observe(slides: ReadonlyMap<string, WrittenSlide>): void {
    for (const [id, { token, stop }] of [...this.observed]) {
      if (slides.get(id)?.isNew === false && slideToken(this.live, id) === token) continue;
      stop();
      this.observed.delete(id);
    }
    for (const [id, slide] of slides) {
      if (slide.isNew || this.observed.has(id)) continue;
      this.observed.set(id, { token: slideToken(this.live, id)!, stop: Y.observeSlide(this.live, id, () => this.dirty.add(id)) });
    }
  }

  private commit(next: DeckProvisionalSnapshot): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((key) => b.has(key));
const sameDrawn = (a: ProvisionalSlide, b: ProvisionalSlide) => a.file === b.file && sameSet(a.changed, b.changed) && sameSet(a.added, b.added) && sameSet(a.removed, b.removed);
const sameFrame = (a: ProvisionalFrame | null, b: ProvisionalFrame | null) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
const sameSlide = (a: WrittenSlide, b: WrittenSlide) => a.toolUseId === b.toolUseId && a.name === b.name && a.color === b.color && a.isNew === b.isNew && a.drawn === b.drawn && sameFrame(a.frame, b.frame) && sameIndex(a.index, b.index);
const sameIndex = (a: StreamedIndex | null, b: StreamedIndex | null) => a === b || (a !== null && b !== null && a.text === b.text && a.open === b.open);
