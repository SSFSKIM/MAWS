// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Undo", "Shell"; M4): what one tab's deck editor
// keeps beyond its mounted body (X32's lifetime rule: the tab owns it, so it outlives a body unmounting on a tab
// switch): the replica's doc, the one undo stack, the slide shown, the zoom, and the editor's origin on every write.
//
// A gesture is one transaction and one undo step: `edit` cuts the undo step before and after its write; a drag or a
// burst of typing (`continuing`) keeps writing into the step it started until something else cuts it.
//
// Final fix wave (B4): an edit whose write waits on work first (an upload, a copy of assets between artifacts) is the
// tab's too (`later`): counted while it runs, so the tab's close guard waits for it (B's rule), and written only if the
// session still takes writes when the work is done; a closed tab, a read-only replica or a version shown in place of
// the live deck drops it.
//
// P3-F (L203): speaker notes the dialect refused (over its limit) are the tab's too, kept here per slide until written or
// replaced, so the notes field shows them again when it mounts again; they are never written to the doc. Fix wave: carried
// onto a change made meanwhile they may fit, yet stay unwritten until the owner writes them, and the tab's close guard
// asks before they are lost.
// P3-F (L233): what the editor shows in place of the live deck (`shown`), so the header's Export, which outlives the body,
// exports what is on screen (the design's what-you-see rule, P3-E's Decision Log 31).
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D1): the click model's state beside the selection: where
// an edit's caret goes when it begins (`editText`'s placement, which the text box takes once), whether the stage owns the
// keyboard (ARMED exists only then), whether a gesture is dragging, and whether an input method is composing in the box.
// P3-F F9's typed keys retire: the armed box is focused before the first key.
// P4-B2 (D17): the replica's hold has two reasons, an input method composing and a gesture dragging, and stands while
// either does. A drop's re-assert (the gesture's last values written again where a held remote write moved them) runs
// after the flush that applies what the gesture held: in the gesture's own step, or, when a composition kept the hold
// past the drop, in a step of its own when that composition ends.
import type { Awareness } from '@y/protocols/awareness';
import { transact, type Doc } from '../../yjs';
import { hasSlide, readNotes } from '../../yjs/slides';
import { createDeckUndo, type DeckUndo } from '../../yjs/slides-undo';
import { rebaseText } from '../caret';
import { slideOrder } from '../model';
import { keepingRemovedQuotes } from '../threads'; // M7 fix wave 1

export type Zoom = 'fit' | number;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
/** M6: the panel beside the stage that a header action opens (one at a time; the milestones after add theirs). */
export type DeckRail = 'theme' | 'check' | 'comments' | 'history'; // M7: the threads rail; M8: version history

export interface DeckSessionState {
  currentSlide: string | null;
  zoom: Zoom;
  notesOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** M5: the selected elements of the current slide, in the order they were picked (the last is the inspector's). */
  selection: readonly string[];
  /** M5: the text element edited in place, if any (always one of the selection). */
  editingText: string | null;
  /** M6: the panel the header's Theme or Check opened beside the stage, if any. */
  rail: DeckRail | null;
  /** Final fix wave (B4): edits waiting on their work (an upload, an asset copy) before their write. */
  pending: number;
  /** P3-F (L233): what the editor shows in place of the live deck, if anything. */
  shown: DeckShown;
  /**
   * P4-B2 (D1): whether the stage owns the keyboard: `stage` after a press on its content or a focus of the stage or its
   * text box, `away` after a focus anywhere else (the inspector, the rail, a pin, the popover). ARMED needs `stage`.
   */
  keyboard: 'stage' | 'away';
  /** P4-B2: a gesture is writing frames (from `beginDrag` to `endDrag`). */
  dragging: boolean;
  /** P4-B2: an input method is composing in the text box. */
  composing: boolean;
}

/**
 * P4-B2 (D3 to D7): where an edit's caret goes as it begins: everything selected, the caret at the end, the caret at a
 * client point (a click, T3), the word at a client point (a double-click, T5), or the box's selection kept (the armed
 * box's own key began it, T10 and T11).
 */
export type TextPlacement = { kind: 'all' } | { kind: 'end' } | { kind: 'keep' } | { kind: 'point'; x: number; y: number } | { kind: 'word'; x: number; y: number };

export interface DeckSessionOptions {
  /**
   * The replica's hold (A's provider, parent Decision Log 33 to 35): set while an IME composes, and (P4-B2 D17) while a
   * gesture drags.
   */
  holdRemote?: (on: boolean) => void;
  /**
   * Fix wave 1: the replica's awareness, and who this replica is (`name`, `color` an author colour's custom property,
   * `--author-N`). The session publishes its slide and selection there (`deck`), and the stage outlines the other
   * replicas' selections from it.
   */
  presence?: { awareness: Awareness; name: string; color: string };
  /** Final fix wave (B4): whether the replica refuses writes now (the host's read-only), read when an awaited edit writes. */
  readOnly?: () => boolean;
}

/** What a replica publishes of its deck editor in awareness, beside its name and colour. */
export interface DeckPresence {
  slideId: string | null;
  elementIds: readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);

/**
 * P3-F (L233): what the editor shows: one retained version its history previews, two versions compared, or (null) the
 * live deck, its changes since the last view included.
 */
export type DeckShown = { versionId: number } | 'compare' | null;

/** P3-F (L203): notes the dialect refused on a slide: the owner's text, and the slide's notes it was typed over. */
export interface NotesDraft {
  text: string;
  from: string;
}

/** Times of one showing, read through the e2e seam (Acceptance 7's open-to-interactive). */
export interface DeckTimings {
  openedAt: number;
  syncedAt?: number;
  drawnAt?: number;
  thumbnails?: number;
  /** M8: each version preview's time from its request to its slide drawn with its marks (ms). */
  previewMs?: number[];
}

const TYPING_PAUSE_MS = 1_000; // typing in one field after this long a pause starts a new undo step

/** P4-B2 (D17): why the replica's remote frames wait: an input method composing, a gesture dragging. */
type HoldReason = 'composition' | 'gesture';

export class DeckSession {
  readonly undo: DeckUndo;
  private state: DeckSessionState;
  private readonly listeners = new Set<() => void>();
  private typingIn: { target: string; at: number } | null = null;
  private readonly stopUndo: () => void;
  readonly timings: DeckTimings;
  private disposed = false; // B4
  private writesHeld = false; // B4: the editor shows a version in place of the live deck
  private readonly notesDrafts = new Map<string, NotesDraft>(); // L203
  private placement: { id: string; at: TextPlacement } | null = null; // P4-B2: where the edit's caret goes, taken once
  private readonly holding = new Set<HoldReason>(); // P4-B2 (D17): the hold stands while any reason does
  private reasserts: (() => void)[] = []; // D17: the drops' re-asserts waiting for the hold's flush

  constructor(
    readonly doc: Doc,
    openedAt: number = performance.now(),
    private readonly options: DeckSessionOptions = {},
  ) {
    this.undo = createDeckUndo(doc, { editor: 'deck' });
    this.state = { currentSlide: slideOrder(doc)[0] ?? null, zoom: 'fit', notesOpen: false, canUndo: false, canRedo: false, selection: NONE, editingText: null, rail: null, pending: 0, shown: null, keyboard: 'away', dragging: false, composing: false };
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
    if (this.placement && this.placement.id !== next.editingText) this.placement = null; // its edit ended before its box took it
    this.publish();
    this.notify();
  }
  private notify(): void {
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

  /** B4: whether a write may land now: the tab is open, the replica takes writes and the editor shows the live deck. */
  writable(): boolean {
    return !this.disposed && !this.writesHeld && !(this.options.readOnly?.() ?? false);
  }

  /** B4: the editor shows a version in place of the live deck (no write lands behind it), or the live deck again. */
  holdWrites(on: boolean): void {
    this.writesHeld = on;
  }

  /**
   * B4: an edit whose write waits on `work`. It is counted in `pending` until it settles (the tab's close guard waits
   * for it), and `write` runs with the work's value only if the session is still `writable` then: true when written,
   * false when dropped. The work's rejection is the caller's.
   */
  async later<T>(work: Promise<T>, write: (value: T) => void): Promise<boolean> {
    this.set({ pending: this.state.pending + 1 });
    try {
      const value = await work;
      if (!this.writable()) return false;
      write(value);
      return true;
    } finally {
      if (!this.disposed) this.set({ pending: this.state.pending - 1 }); // after the write: the guard then sees it unsaved
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

  /** L203: the notes the dialect refused on a slide, kept until written or replaced; null without any. */
  notesDraft(slideId: string): NotesDraft | null {
    return this.notesDrafts.get(slideId) ?? null;
  }
  /** L203: keeps the refused notes of a slide, or with null forgets them (written, or short enough again). */
  keepNotesDraft(slideId: string, draft: NotesDraft | null): void {
    if (draft) this.notesDrafts.set(slideId, draft);
    else this.notesDrafts.delete(slideId);
  }
  /**
   * L203 fix wave: the notes kept unwritten for a slide, carried onto its notes as they are now; null without any, or
   * once the slide is gone. Within the limit after a change made elsewhere, they are still unwritten: the owner writes them.
   */
  unwrittenNotes(slideId: string): string | null {
    const draft = this.notesDrafts.get(slideId);
    if (!draft || !hasSlide(this.doc, slideId)) return null;
    const now = readNotes(this.doc, slideId);
    return draft.from === now ? draft.text : rebaseText(draft.from, draft.text, now);
  }
  /** L203 fix wave: whether any slide's notes are kept unwritten (lost with the tab: its close guard asks). */
  hasUnwrittenNotes(): boolean {
    return [...this.notesDrafts.keys()].some((id) => this.unwrittenNotes(id) !== null);
  }

  /** The composition hold: remote updates wait while an IME composes in the text box (no-op without a replica). */
  holdRemote(on: boolean): void {
    this.hold('composition', on);
  }

  /**
   * P4-B2 (D17): one replica hold for two reasons, standing while either does. A reason beginning sets it again, which
   * restarts the provider's 5 s cap; the last reason ending releases it (the held frames applied) and then runs the
   * drops' re-asserts that waited for that flush, while the session takes writes.
   */
  private hold(reason: HoldReason, on: boolean): void {
    if (on) {
      this.holding.add(reason);
      this.options.holdRemote?.(true);
      return;
    }
    if (!this.holding.delete(reason) || this.holding.size > 0) return;
    const reasserts = this.reasserts.splice(0);
    try {
      this.options.holdRemote?.(false);
    } finally {
      // the provider applied its frames even when a listener of them threw
      const run = () => {
        for (const reassert of reasserts) if (this.writable()) reassert();
      };
      // the drop's own re-assert lands in its gesture's step (endDrag cuts after it); one a composition put off, alone
      if (reasserts.length > 0) {
        if (reason === 'gesture') run();
        else this.step(run);
      }
    }
  }

  /** Selects elements of the current slide (in pick order); ends a text edit whose element is no longer selected. */
  select(ids: readonly string[]): void {
    const same = ids.length === this.state.selection.length && ids.every((id, i) => id === this.state.selection[i]);
    const selection = same ? this.state.selection : ids.length ? Object.freeze([...ids]) : NONE;
    this.set({ selection, editingText: this.state.editingText !== null && ids.includes(this.state.editingText) ? this.state.editingText : null });
  }

  /**
   * Starts (or with null ends) editing a text element in place; it becomes the selection. P4-B2: `at` is where the caret
   * goes (everything selected when not given), which the element's text box takes once (`takePlacement`), whether it
   * mounts now or is already mounted ARMED (the flip to EDIT: no remount, no focus change).
   */
  editText(id: string | null, options: { at?: TextPlacement } = {}): void {
    if (id !== null) this.placement = { id, at: options.at ?? { kind: 'all' } };
    if (id !== null) this.set({ selection: Object.freeze([id]), editingText: id, keyboard: 'stage' });
    else this.set({ editingText: null });
    if (id !== null) this.notify(); // a box already mounted takes the placement now
  }

  /** P4-B2: where the edit of `id` puts its caret, once; null when there is nothing to place. */
  takePlacement(id: string): TextPlacement | null {
    if (this.placement?.id !== id || this.state.editingText !== id) return null;
    const { at } = this.placement;
    this.placement = null;
    return at;
  }

  /** P4-B2 (D1): whether the stage owns the keyboard (ARMED needs it). */
  setKeyboard(keyboard: 'stage' | 'away'): void {
    this.set({ keyboard });
  }

  /** P4-B2: an input method composing in the text box, or done. */
  setComposing(composing: boolean): void {
    this.set({ composing });
  }

  /** A drag: the writes between `begin` and `end` are one undo step. P4-B2 (D17): the replica's remote frames wait. */
  beginDrag(): void {
    this.typingIn = null;
    this.undo.cut();
    this.hold('gesture', true);
    this.set({ dragging: true });
  }
  /**
   * The drop. P4-B2 (D17): the gesture's hold reason ends, and with it (no composition holding) the hold, its frames
   * applied before the step's closing cut; `reassert` then writes the gesture's last values again where a held write
   * moved them, in the gesture's step, if the session still takes writes (it re-checks its own targets). A composition
   * still holding keeps the hold, and the re-assert waits for its flush. A throw leaves no reason, step or drag standing.
   */
  endDrag(reassert?: () => void): void {
    try {
      if (reassert && this.holding.has('gesture')) this.reasserts.push(reassert);
      this.hold('gesture', false);
    } finally {
      this.undo.cut();
      this.set({ dragging: false });
    }
  }

  undoStep(): void {
    this.typingIn = null;
    keepingRemovedQuotes(this.doc, () => this.undo.undo()); // M7 fix wave 1: a removed commented element keeps its text
  }
  redoStep(): void {
    this.typingIn = null;
    keepingRemovedQuotes(this.doc, () => this.undo.redo()); // M7 fix wave 1
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
  setNotesOpen(notesOpen: boolean): void {
    this.set({ notesOpen });
  }
  /** L233: the editor shows a retained version, two compared, or (null) the live deck. */
  showVersion(shown: DeckShown): void {
    const now = this.state.shown;
    const same = shown === null || shown === 'compare' ? now === shown : now !== null && now !== 'compare' && now.versionId === shown.versionId;
    if (!same) this.set({ shown });
  }
  /** M6: opens a panel beside the stage, or closes it when it is the one open. */
  toggleRail(rail: DeckRail): void {
    this.set({ rail: this.state.rail === rail ? null : rail });
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
    this.disposed = true; // B4: an awaited edit still running writes nothing
    // D17: a drag or a composition the tab closed on holds nothing after it, and re-asserts nothing; the hold is
    // released last, so a listener of its flush that throws leaves nothing here undone
    this.reasserts = [];
    const holding = this.holding.size > 0;
    this.holding.clear();
    try {
      const presence = this.options.presence;
      if (presence && presence.awareness.getLocalState()) presence.awareness.setLocalStateField('deck', null);
      this.stopUndo();
      this.undo.destroy();
      this.listeners.clear();
    } finally {
      if (holding) this.options.holdRemote?.(false);
    }
  }
}
