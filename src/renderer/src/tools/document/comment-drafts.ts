// The document's unsent comment, one per artifact (P4-B1 D8 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md;
// X36's draft rule: "one draft per artifact; a hidden card keeps its draft"): what the owner has typed in the compose card
// of a document's card host and not sent. The host records the field's text as it changes and drops it when the card
// closes, is replaced, turns into its thread or its field empties; the editor's Comment refocuses it instead of starting
// a second comment (`DocumentComments.draft`), the tab's close guard asks before it is lost, and a card host remounted
// (a tab switch, the margin's cards giving way to the panel) gives the card its text back. Kept outside React, by
// artifact id: the tab state reads it without a body on screen.

export interface CommentDraft {
  hostId: string; // the document card host the card is on
  serial: number; // the card (P2's store: a new open is a new card)
  threadId: string;
  text: string;
}

const drafts = new Map<string, CommentDraft>();

/** The artifact's unsent comment: the thread its compose card is on and the field's text; null when there is none. */
export function commentDraftOf(artifactId: string): { threadId: string; text: string } | null {
  const draft = drafts.get(artifactId);
  return draft ? { threadId: draft.threadId, text: draft.text } : null;
}

/** The host's whole entry (its card and host), for the host's own checks. */
export const commentDraftEntry = (artifactId: string): CommentDraft | null => drafts.get(artifactId) ?? null;

/** The compose card's field changed: a blank field is no draft. */
export function recordCommentDraft(artifactId: string, draft: CommentDraft): void {
  if (draft.text.trim() === '') {
    if (drafts.get(artifactId)?.serial === draft.serial) drafts.delete(artifactId);
    return;
  }
  drafts.set(artifactId, draft);
}

/** The draft's card went (closed, replaced, sent, or its host gone): only that host's draft is dropped. */
export function dropCommentDraft(artifactId: string, hostId: string, keep?: { serial: number }): void {
  const draft = drafts.get(artifactId);
  if (draft?.hostId === hostId && draft.serial !== keep?.serial) drafts.delete(artifactId);
}
