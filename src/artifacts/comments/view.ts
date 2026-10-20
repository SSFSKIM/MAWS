// P4-B1 (D10 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): a document's comments view, Docs' View ›
// Comments: Expand (the margin's cards), Minimize (the icon rail at any width), Hide (an empty margin, the passages'
// highlights kept). Per user: the renderer persists it (settings' `artifacts.commentsView`), the editor takes it as a prop.
export const COMMENTS_VIEWS = ['expand', 'minimize', 'hide'] as const;
export type CommentsView = (typeof COMMENTS_VIEWS)[number];
