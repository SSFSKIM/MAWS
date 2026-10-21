// P4-B2 K6 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10; the plan review's P1): the Edit menu's Undo
// and Redo reach a deck's or a design's own stack (the session's one undo stack) while the focus is on one of the
// editor's own editable surfaces, and stay the page's native command everywhere else. The host passes the registration
// in (the renderer's edit-claimant registry), so the editors stay portable.
import { useEffect, type RefObject } from 'react';
import type { DeckSession } from './session';

export interface EditClaimant {
  claims(active: Element): boolean;
  undo(): void;
  redo(): void;
}
/** The host's registration of a claimant; the returned disposer withdraws it. */
export type RegisterEditClaimant = (claimant: EditClaimant) => () => void;

const STAGE = '[data-stage-surface]';
/**
 * The surfaces whose gestures and typing are the deck's stack: the stage (a deck's, or a design's world), a slide text
 * box on it, the deck's notes field. An element merely inside the editor (an inspector field, a reply, a rail, an
 * iframe) keeps its own undo.
 */
export function isDeckEditSurface(active: Element): boolean {
  if (active.matches(STAGE) || active.matches('.deck-notes-field')) return true;
  // D15's A3: the stage moves the focus onto the one selected element's own node, which is the stage's as it is (never
  // what the node holds: an embed's frame keeps its own undo)
  if (active.matches('[data-eid]') && active.closest(STAGE) != null) return true;
  return active.matches('.deck-textbox') && active.parentElement?.closest(STAGE) != null;
}

/**
 * Registers the editor rooted at `root` as a claimant of its own surfaces, its undo and redo the session's steps, while
 * it takes edits: nothing is claimed read-only or while a version of its history shows (`off`), the conditions under
 * which the editor's own ⌘Z steps aside.
 */
export function useEditClaim(register: RegisterEditClaimant | undefined, root: RefObject<HTMLElement | null>, session: DeckSession, off: boolean): void {
  useEffect(() => {
    if (!register || off) return;
    return register({
      claims: (active) => root.current?.contains(active) === true && isDeckEditSurface(active),
      undo: () => session.undoStep(),
      redo: () => session.redoStep(),
    });
  }, [register, root, session, off]);
}
