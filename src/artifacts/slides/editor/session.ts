// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Undo", "Shell"; M4): what one tab's deck editor
// keeps beyond its mounted body (X32's lifetime rule: the tab owns it, so it outlives a body unmounting on a tab
// switch): the replica's doc, the one undo stack, the slide shown, the zoom, and the editor's origin on every write.
//
// A gesture is one transaction and one undo step: `edit` cuts the undo step before and after its write; a drag or a
// burst of typing (`continuing`) keeps writing into the step it started until something else cuts it.
import type { Doc } from '../../yjs';
import { createDeckUndo, type DeckUndo } from '../../yjs/slides-undo';
import { slideOrder } from '../model';

export type Zoom = 'fit' | number;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export interface DeckSessionState {
  currentSlide: string | null;
  zoom: Zoom;
  canUndo: boolean;
  canRedo: boolean;
}

/** Times of one showing, read through the e2e seam (Acceptance 7's open-to-interactive). */
export interface DeckTimings {
  openedAt: number;
  syncedAt?: number;
  drawnAt?: number;
  thumbnails?: number;
}

const TYPING_PAUSE_MS = 1_000; // typing in one field after this long a pause starts a new undo step

export class DeckSession {
  readonly undo: DeckUndo;
  private state: DeckSessionState;
  private readonly listeners = new Set<() => void>();
  private typingIn: { target: string; at: number } | null = null;
  private readonly stopUndo: () => void;
  readonly timings: DeckTimings;

  constructor(
    readonly doc: Doc,
    openedAt: number = performance.now(),
  ) {
    this.undo = createDeckUndo(doc, { editor: 'deck' });
    this.state = { currentSlide: slideOrder(doc)[0] ?? null, zoom: 'fit', canUndo: false, canRedo: false };
    this.timings = { openedAt };
    this.stopUndo = this.undo.subscribe(() => this.set({ canUndo: this.undo.canUndo(), canRedo: this.undo.canRedo() }));
  }

  get origin(): object {
    return this.undo.origin;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): DeckSessionState => this.state;

  private set(patch: Partial<DeckSessionState>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof DeckSessionState)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** One gesture: its own undo step, written with the editor's origin (the writer takes it as its last argument). */
  edit(write: (origin: object) => void): void {
    this.typingIn = null;
    this.undo.cut();
    write(this.origin);
    this.undo.cut();
  }

  /** A write that continues the current step while the same field keeps being typed in (a pause or another field cuts). */
  typing(target: string, write: (origin: object) => void, now: number = performance.now()): void {
    if (this.typingIn === null || this.typingIn.target !== target || now - this.typingIn.at > TYPING_PAUSE_MS) this.undo.cut();
    this.typingIn = { target, at: now };
    write(this.origin);
  }

  /** A drag: the writes between `begin` and `end` are one undo step. */
  beginDrag(): void {
    this.typingIn = null;
    this.undo.cut();
  }
  endDrag(): void {
    this.undo.cut();
  }

  undoStep(): void {
    this.typingIn = null;
    this.undo.undo();
  }
  redoStep(): void {
    this.typingIn = null;
    this.undo.redo();
  }

  /** The first showing is drawn: the stage and every thumbnail (the e2e seam's open-to-interactive). */
  markDrawn(thumbnails: number, at: number = performance.now()): void {
    if (this.timings.drawnAt !== undefined) return;
    this.timings.drawnAt = at;
    this.timings.thumbnails = thumbnails;
  }

  show(slideId: string | null): void {
    this.set({ currentSlide: slideId });
  }
  setZoom(zoom: Zoom): void {
    this.set({ zoom });
  }

  /** The slide to show when the current one is gone: the one now at its place, else the last. */
  reconcile(order: readonly string[], previous: readonly string[]): void {
    const current = this.state.currentSlide;
    if (current !== null && order.includes(current)) return;
    if (order.length === 0) return this.show(null);
    const at = current === null ? 0 : Math.max(0, previous.indexOf(current));
    this.show(order[Math.min(at, order.length - 1)]!);
  }

  dispose(): void {
    this.stopUndo();
    this.undo.destroy();
    this.listeners.clear();
  }
}
