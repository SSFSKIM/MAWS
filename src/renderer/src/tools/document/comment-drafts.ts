// The document's unsent comment, one per artifact (P4-B1 D8 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md;
// X36's draft rule: "one draft per artifact; a hidden card keeps its draft"): what the owner has typed in a comment on a
// document's passage and not sent. UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3,
// decision 17): the comment lives in the card's pass (`side/card/store.ts`), which a document's host keeps at one unsent
// comment (`holds: 'one'`); these are readers over it, so the editor's Comment (`DocumentComments.draft`), the tab's close
// guard and the card read the same text. Kept outside React: the tab state reads it without a body on screen.
import { useCommentCard, type PassComment } from '../../side/card/store';

/** The artifact's unsent comment (not in flight), whatever its text, and its pass; null when there is none. */
export function unsentCommentOf(artifactId: string): { pass: string; comment: PassComment; threadId: string } | null {
  let found: { pass: string; comment: PassComment; threadId: string } | null = null;
  for (const [key, pass] of useCommentCard.getState().passes) {
    if (pass.host !== 'artifact' || pass.subject !== artifactId) continue;
    for (const comment of pass.comments) {
      const { anchor } = comment;
      if (comment.flight === null && anchor.kind === 'artifact-comment' && anchor.threadId !== undefined) found = { pass: key, comment, threadId: anchor.threadId };
    }
  }
  return found;
}

/** The artifact's unsent comment with text in it: the thread it is on and the text; null when there is none. */
export function commentDraftOf(artifactId: string): { threadId: string; text: string } | null {
  const unsent = unsentCommentOf(artifactId);
  return unsent && unsent.comment.text.trim() !== '' ? { threadId: unsent.threadId, text: unsent.comment.text } : null;
}
