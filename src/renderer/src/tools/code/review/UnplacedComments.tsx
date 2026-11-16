// The row under Review's toolbar (UX wave U5b, M5 fix 3; §B, Decision Log 20 and 21; D11): the place of every comment
// the surface cannot place (`placementOf`'s table). Drawn while there is one, whether or not a card is open: for each kind
// present its sentence (`UNPLACED_ORDER`, the kinds' one order), then its comments in card 6's look, oldest first, each with Remove. A row's
// press (a click, Enter or Space) opens that comment's card in the row's place, one at a time; read, edit, send, remove,
// a refusal and its retry are the card's own. Past `UNPLACED_ROWS_SHOWN` rows the list scrolls inside the row, so the
// diff stays in sight; an open card is never cut by that bound.
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { CARD_WIDTH } from '../../../side/card/placement';
import { editComment } from '../../../side/card/store';
import { UNPLACED_ORDER } from './comment-place';
import { RemoveComment, type UnplacedComment } from './LineComments';
import { reviewLayout } from './measure';

/** How many rows the list shows before it scrolls inside the row under the toolbar. */
export const UNPLACED_ROWS_SHOWN = 3;

export interface UnplacedCommentsProps {
  passKey: string;
  hostId: string;
  unplaced: readonly UnplacedComment[];
  opened: string | null; // the comment whose card this surface has open: drawn in its row's place when it is one of these
  onRow(element: HTMLElement | null): void; // the element the open card is drawn in, handed to the host
  claimFocus(commentId: string): boolean; // a row drawn again after its card went on Escape takes the keyboard (once)
}

export function UnplacedComments({ passKey, hostId, unplaced, opened, onRow, claimFocus }: UnplacedCommentsProps) {
  const list = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  // The bound: the list's height to the bottom of its last row shown, or the open card's height where that is more.
  useLayoutEffect(() => {
    const element = list.current!;
    const measure = () => {
      const items = [...element.querySelectorAll<HTMLElement>('[data-review-unplaced-item]')];
      if (items.length <= UNPLACED_ROWS_SHOWN) return setMaxHeight(null);
      const last = items[UNPLACED_ROWS_SHOWN - 1];
      const card = items.find((item) => item.hasAttribute('data-review-card-row'));
      setMaxHeight(Math.max(reviewLayout.offsetWithin(last, element) + element.scrollTop + reviewLayout.height(last), card ? reviewLayout.height(card) : 0));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const item of element.querySelectorAll('[data-review-unplaced-item]')) observer.observe(item);
    return () => observer.disconnect();
  }, [unplaced, opened]);
  // The open card in view inside the list (a row below the bound opened it).
  useLayoutEffect(() => {
    if (opened === null) return;
    list.current?.querySelector<HTMLElement>('[data-review-card-row]')?.scrollIntoView?.({ block: 'nearest' });
  }, [opened]);

  return (
    <div data-review-unplaced="" className="shrink-0 border-b border-border px-3 py-2">
      <div ref={list} data-review-unplaced-list="" style={maxHeight === null ? undefined : { maxHeight }} className="flex flex-col gap-0.5 overflow-y-auto">
        {UNPLACED_ORDER.map((sentence) => {
          const own = unplaced.filter((each) => sentence.kinds.includes(each.kind));
          if (own.length === 0) return null;
          return (
            <Fragment key={sentence.name}>
              <p data-review-unplaced-words={sentence.name} className="m-0 py-0.5 text-ui-sm text-fg-muted">
                {sentence.words}
              </p>
              {own.map(({ comment }) =>
                comment.id === opened ? (
                  <div key={comment.id} ref={onRow} data-review-unplaced-item="" data-review-card-row="away" className="whitespace-normal" />
                ) : (
                  <UnplacedRow key={comment.id} passKey={passKey} hostId={hostId} comment={comment} claimFocus={claimFocus} />
                ),
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// One comment in card 6's look: the line it quotes, cut to one line, then its first words; a press opens its card here.
function UnplacedRow({ passKey, hostId, comment, claimFocus }: { passKey: string; hostId: string; comment: UnplacedComment['comment']; claimFocus(commentId: string): boolean }) {
  const edit = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (claimFocus(comment.id)) edit.current?.focus({ preventScroll: true });
  }, [claimFocus, comment.id]);
  const quote = comment.quote?.split('\n')[0] ?? null;
  const words = comment.text.trim();
  return (
    <div data-review-unplaced-item="" data-review-unplaced-comment={comment.id} style={{ maxWidth: CARD_WIDTH }} className="flex w-full min-w-0 shrink-0 items-center gap-1 rounded-sm border border-border bg-bg-raised text-ui-sm">
      <button
        ref={edit}
        type="button"
        data-review-unplaced-edit=""
        title={quote === null ? words : `${quote}\n${words}`}
        onClick={() => editComment(passKey, comment.id, hostId)}
        className="flex min-h-6 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2"
      >
        {quote !== null && <span className="min-w-0 max-w-[50%] shrink-0 truncate font-mono text-fg-muted">{quote}</span>}
        <span className="min-w-0 flex-1 truncate text-fg">{words}</span>
      </button>
      <RemoveComment passKey={passKey} comment={comment} />
    </div>
  );
}
