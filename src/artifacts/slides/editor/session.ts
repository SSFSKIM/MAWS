// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Undo", "Shell"; M4): what one tab's deck editor
// keeps beyond its mounted body (X32's lifetime rule: the tab owns it, so it outlives a body unmounting on a tab
// switch): the replica's doc, the one undo stack, the slide shown, the zoom, and the editor's origin on every write.
//
// A gesture is one transaction and one undo step: `edit` cuts the undo step before and after its write; a drag or a
// burst of typing (`continuing`) keeps writing into the step it started until something else cuts it.
import type { Awareness } from '@y/protocols/awareness';
import { transact, type Doc } from '../../yjs';
import { createDeckUndo, type DeckUndo } from '../../yjs/slides-undo';
import { slideOrder } from '../model';

export type Zoom = 'fit' | number;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export interface DeckSessionState {
  currentSlide: string | null;
  zoom: Zoom;
  canUndo: boolean;
  canRedo: boolean;
  /** M5: the selected elements of the current slide, in the order they were picked (the last is the inspector's). */
  selection: readonly string[];
  /** M5: the text element edited in place, if any (always one of the selection). */
  editingText: string | null;
}

export interface DeckSessionOptions {
  /** The replica's composition hold (A's provider, parent Decision Log 33 to 35): set while an IME composes. */
  holdRemote?: (on: boolean) => void;
  /**
   * Fix wave 1: the replica's awareness, and who this replica is (`name`, `color` an author colour's custom property,
   * `--author-N`). The session publishes its slide and selection there (`deck`), and the stage outlines the other
   * replicas' selections from it.
   */
  presence?: { awareness: Awareness; name: string; color: string };
}

/** What a replica publishes of its deck editor in awareness, beside its name and colour. */
export interface DeckPresence {
  slideId: string | null;
  elementIds: readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);

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
    private readonly options: DeckSessionOptions = {},
  ) {
    this.undo = createDeckUndo(doc, { editor: 'deck' });
    this.state = { currentSlide: slideOrder(doc)[0] ?? null, zoom: 'fit', canUndo: false, canRedo: false, selection: NONE, editingText: null };
    this.timings = { openedAt };
    this.stopUndo = this.undo.subscribe(() => this.set({ canUndo: this.undo.canUndo(), canRedo: this.undo.canRedo() }));
    this.publish();
  }

  /** The awareness other replicas' selections are read from (null without one). */
  get awareness(): Awareness | null {
    return this.options.presence?.awareness ?? null;
  }

  // this replica's slide and selection, in its awareness beside its name and colour
  private published = '';
  private publish(): void {
    const presence = this.options.presence;
    if (!presence) return;
    const deck: DeckPresence = { slideId: this.state.currentSlide, elementIds: this.state.selection };
    const key = JSON.stringify(deck);
    if (key === this.published) return;
    this.published = key;
    presence.awareness.setLocalState({ ...(presence.awareness.getLocalState() ?? {}), name: presence.name, color: presence.color, deck });
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
    this.publish();
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * One gesture: its own undo step and one transaction (fix wave 1: the writers it calls nest in it), written with the
   * editor's origin (the writer takes it as its last argument).
   */
  edit(write: (origin: object) => void): void {
    this.step(() => transact(this.doc, () => write(this.origin), this.origin));
  }

  /**
   * A step of its own around writes another writer makes with its own origin (the text box's binding, whose writes must
   * keep it): the undo cut before and after, no transaction of the editor's.
   */
  step(run: () => void): void {
    this.typingIn = null;
    this.undo.cut();
    try {
      run();
    } finally {
      this.undo.cut();
    }
  }

  /** A write that continues the current step while the same field keeps being typed in (a pause or another field cuts). */
  typing(target: string, write: (origin: object) => void, now: number = performance.now()): void {
    if (this.typingIn === null || this.typingIn.target !== target || now - this.typingIn.at > TYPING_PAUSE_MS) this.undo.cut();
    this.typingIn = { target, at: now };
    transact(this.doc, () => write(this.origin), this.origin);
  }

  /** Typing that another writer (the text box's binding) writes: cuts the undo step as `typing` would, writes nothing. */
  noteTyping(target: string, now: number = performance.now()): void {
    this.typing(target, () => {}, now);
  }

  /** Makes the undo stack take another writer's origin as the editor's own (the text box's binding); returns the undo. */
  trackOrigin(origin: unknown): () => void {
    return this.undo.track(origin);
  }

  /** The composition hold: remote updates wait while an IME composes in the text box (no-op without a replica). */
  holdRemote(on: boolean): void {
    this.options.holdRemote?.(on);
  }

  /** Selects elements of the current slide (in pick order); ends a text edit whose element is no longer selected. */
  select(ids: readonly string[]): void {
    const same = ids.length === this.state.selection.length && ids.every((id, i) => id === this.state.selection[i]);
    const selection = same ? this.state.selection : ids.length ? Object.freeze([...ids]) : NONE;
    this.set({ selection, editingText: this.state.editingText !== null && ids.includes(this.state.editingText) ? this.state.editingText : null });
  }

  /** Starts (or with null ends) editing a text element in place; it becomes the selection. */
  editText(id: string | null): void {
    if (id !== null) this.set({ selection: Object.freeze([id]), editingText: id });
    else this.set({ editingText: null });
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
    if (slideId === this.state.currentSlide) return;
    this.set({ currentSlide: slideId, selection: NONE, editingText: null });
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
    const presence = this.options.presence;
    if (presence && presence.awareness.getLocalState()) presence.awareness.setLocalStateField('deck', null);
    this.stopUndo();
    this.undo.destroy();
    this.listeners.clear();
  }
}
