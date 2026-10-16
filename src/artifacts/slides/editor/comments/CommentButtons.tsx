// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the toolbar's Comment (on the one selected
// element, offered when there is a surface to send it to) and Comments (the threads rail, with the open count), B's pair
// in the document's toolbar.
import { useSyncExternalStore } from 'react';
import type { DeckCommentsApi } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useOpenThreadCount } from './use-threads';

export function CommentButtons({ api, railOpen, onToggleRail }: { api: DeckCommentsApi; railOpen: boolean; onToggleRail(): void }) {
  const { session } = api;
  const selection = useSyncExternalStore(session.subscribe, () => session.snapshot().selection);
  const open = useOpenThreadCount(session.doc);
  return (
    <>
      {api.canComment && (
        <button type="button" className="deck-button" title={C.commentTitle} disabled={selection.length !== 1} onClick={() => api.comment()}>
          {C.comment}
        </button>
      )}
      <button type="button" className="deck-button" aria-label={C.commentsOpen(open)} aria-pressed={railOpen} data-comments-toggle onClick={onToggleRail}>
        {C.comments}
        {open > 0 ? ` ${open}` : ''}
      </button>
    </>
  );
}
