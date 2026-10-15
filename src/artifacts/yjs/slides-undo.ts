// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Undo"): the deck editor's one undo stack, in the
// binding module (Yjs only through src/artifacts/yjs/). A `Y.UndoManager` over the deck's `deck` and `slides` roots that
// tracks only the editor's own origin, so the agent's publishes, the host's repairs and another replica's edits are never
// undone by the owner's ⌘Z. A step is one gesture, not a stretch of time: the editor calls `cut()` where a gesture starts
// and ends, and every write in between (a drag's pointer frames, a burst of typing) merges into that one step.
// M7: the scope takes the `threads` root too, so a thread key an editor gesture writes under the editor's origin is
// undone with that gesture; the conversation (a thread's creation, its messages, resolve, reopen, a withdrawn draft) is
// written under the comments' own origin, which the stack never tracks, so ⌘Z never takes a comment back (B's rule,
// the parent's Decision Log 32).
// M7 fix wave 1: an undo or a redo that removes a commented element (an undo of its creation, a redo of its deletion)
// is no removal writer, so the step stores the element's last text itself: the commented elements' quotes read just
// before it, written for those it took away in a transaction right after it, under the comments' origin (never undone).
// Offline the two merge into one frame, which the host's forwarding keeps (Decision Log 31).
import * as Y from '@y/y';
import { captureQuotes, storeDeletedQuotes } from '../slides/threads';
import type { Doc } from './doc';
import { DECK_ROOT, SLIDES_ROOT, THREADS_ROOT } from './slides';

/** The origin of the thread writes an undo or a redo makes (the editor's comments' origin, which the stack never tracks). */
const COMMENTS_ORIGIN = 'deck-comments';

export interface DeckUndo {
  /** The origin the editor writes with; only writes carrying it are undoable. */
  readonly origin: object;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Ends the current step: the next tracked write starts a new one. */
  cut(): void;
  /** P3-C M5: also track another writer's origin (the text box's binding, D8 "Undo"); returns the untrack. */
  track(origin: unknown): () => void;
  /** Forgets both stacks (a restore replaced what they refer to). */
  clear(): void;
  /** Called whenever either stack changes. */
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

// Writes merge into the current step until `cut()`: time never splits a gesture (a slow drag stays one step).
const NEVER = Number.MAX_SAFE_INTEGER;
const EVENTS = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const;

export function createDeckUndo(doc: Doc, origin: object = { editor: 'deck' }): DeckUndo {
  const manager = new Y.UndoManager([doc.get(DECK_ROOT), doc.get(SLIDES_ROOT), doc.get(THREADS_ROOT)], { captureTimeout: NEVER, trackedOrigins: new Set([origin]) });
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  for (const name of EVENTS) manager.on(name, changed);
  // M7 fix wave 1: a step, keeping the last text of every commented element it removes
  const step = (run: () => unknown): boolean => {
    manager.stopCapturing();
    const quotes = captureQuotes(doc);
    const done = run() !== null;
    if (done && quotes.size > 0) storeDeletedQuotes(doc, quotes, COMMENTS_ORIGIN);
    return done;
  };
  return {
    origin,
    undo: () => step(() => manager.undo()),
    redo: () => step(() => manager.redo()),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    cut: () => manager.stopCapturing(),
    track: (other) => {
      manager.addTrackedOrigin(other);
      return () => manager.removeTrackedOrigin(other);
    },
    clear: () => manager.clear(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => {
      for (const name of EVENTS) manager.off(name, changed);
      listeners.clear();
      manager.destroy();
    },
  };
}
