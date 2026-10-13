// The comment surface the document editor offers its host (D9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// the editor writes a thread and its mark when the person comments a selection and draws the open threads and the
// threads rail; the card that takes the comment to an agent session is P2's (X21), which lives in the renderer, so the
// renderer passes it in through this interface (src/artifacts/ stays portable, §4.10). Without a surface, commenting
// is not offered (the rail still lists, resolves and reopens what others wrote).
import type { ReactNode } from 'react';
import type { Actor } from '@shared/artifacts/actor';
import type { Doc } from '../../../yjs';

/** A passage just commented: its new thread, the tab it is in, and the quoted text. */
export interface CommentedPassage {
  threadId: string;
  tabId: string;
  tabTitle: string;
  quote: string;
}

/** A box in the overlay's own coordinates (its top-left 0,0), in CSS pixels. */
export interface PassageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the overlay drawn over the page can ask of the editor. */
export interface CommentOverlayProps {
  doc: Doc;
  /** The passage of a thread's live mark in the shown tab, or null when none is on screen there. */
  locate(threadId: string): PassageRect | null;
  /** Changes whenever passages may have moved (an edit, a scroll, a resize): locate again. */
  layoutKey: string;
  /** Draws a thread as the active one, or none. */
  setActive(threadId: string | null): void;
  resolve(threadId: string): void;
  reopen(threadId: string): void;
  /** The person's comment as it was sent: the thread's next message, in the thread. */
  record(threadId: string, body: string): void;
  /** Withdraws a thread nothing was said in yet (its card closed unsent): the thread and its mark go. */
  discard(threadId: string): void;
  /** Gives the editor the focus back (after the card went). */
  focus(): void;
}

export interface DocumentComments {
  /** Called once the editor wrote a new thread and its mark: open the card for it. */
  opened(passage: CommentedPassage): void;
  /** What to draw over the page's scroll box, filling it (P2's card host); called on each of the overlay's renders. */
  overlay(props: CommentOverlayProps): ReactNode;
}

/** Who writes the editor's thread changes, and when. */
export interface CommentAuthor {
  actor: Actor;
  now(): number;
}
