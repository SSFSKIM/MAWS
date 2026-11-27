// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the toolbar's Comment (on the one selected
// element, offered when there is a surface to send it to) and Comments (the threads rail, with the open count), B's pair
// in the document's toolbar.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3; G403, G404, both rows the owner saw):
// both are named glyphs. Add comment's tooltip keeps "Comment on the selected element" with its chord, greyed and still
// focusable until one element is selected, its reason in the tooltip; Comments carries its open count as a small corner
// badge (none at zero, the count in its name), "Comments" its tooltip.
import { useSyncExternalStore } from 'react';
import { formatChord } from '@shared/keymap/chord';
import { NamedGlyph } from '../../../../renderer/src/ui/glyph';
import { CommentPlusIcon, CommentsIcon } from '../../../ui/icons';
import type { DeckCommentsApi } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useOpenThreadCount } from './use-threads';

const COMMENT_CHORD = formatChord('Cmd+Alt+M'); // CommentFrame's own key

export function CommentButtons({ api, railOpen, onToggleRail }: { api: DeckCommentsApi; railOpen: boolean; onToggleRail(): void }) {
  const { session } = api;
  const selection = useSyncExternalStore(session.subscribe, () => session.snapshot().selection);
  const open = useOpenThreadCount(session.doc);
  return (
    <>
      {api.canComment && (
        <NamedGlyph label={C.comment} tip={C.commentTip} shortcut={COMMENT_CHORD} unavailable={selection.length !== 1 ? C.commentUnavailable : null} className="deck-button deck-glyph" onClick={() => api.comment()}>
          <CommentPlusIcon />
        </NamedGlyph>
      )}
      <NamedGlyph label={C.commentsOpen(open)} tip={C.comments} pressed={railOpen} className="deck-button deck-glyph deck-glyph-badged" data-comments-toggle onClick={onToggleRail}>
        <CommentsIcon />
        {open > 0 && (
          <span className="deck-glyph-badge" data-comments-count aria-hidden>
            {open}
          </span>
        )}
      </NamedGlyph>
    </>
  );
}
