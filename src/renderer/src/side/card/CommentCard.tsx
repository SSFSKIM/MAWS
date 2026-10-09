// The comment card (P2-E1 document, D5; X21): a small non-modal panel beside the element a comment is about, Claude
// Desktop's measure (300 px). Its composer half is the sheet's form at card size, through the same hook and parts
// (`comment-form.ts`, `CommentFormParts.tsx`), so the phases and the sends cannot drift: a header naming the anchor
// (its full label and locator as the title) with Close, the producer's screenshot, an autosizing field (1 to 6 lines),
// and one row with the destination, compact, and Send. Escape with focus inside dismisses it, answered here so the
// viewer's picking listener (which skips an answered Escape) never sees it; a composition's Escape is the input
// method's. No focus trap and no `aria-modal`: the person reads the page while the card is open.
import type { CSSProperties, KeyboardEvent } from 'react';
import { FIELD, PRIMARY } from '../../sessions/ui';
import { useCommentForm } from '../comment-form';
import { CommentRefusal, DestinationControl, ScreenshotThumbnail } from '../CommentFormParts';
import { SIDE_COPY } from '../copy';
import type { CardStyle } from './placement';
import { cardGone, type OpenCard } from './store';

const COPY = SIDE_COPY.card;
const FORM = SIDE_COPY.composer;
const DOCK_INSET = 8;

// Where the host's layout puts the card, in the host's box.
function positionOf(style: CardStyle): CSSProperties {
  switch (style.mode) {
    case 'below':
      return { left: style.left, top: style.top, width: style.width, maxHeight: style.maxHeight };
    case 'above':
      return { left: style.left, bottom: style.bottom, width: style.width, maxHeight: style.maxHeight };
    case 'docked':
      return { left: DOCK_INSET, bottom: DOCK_INSET, width: style.width, maxHeight: style.maxHeight };
  }
}

// The corner touching the pin is squared (Desktop's card at its click point).
const cornerOf = (style: CardStyle, pinned: boolean) => (!pinned ? '' : style.mode === 'below' ? 'rounded-tl-none' : style.mode === 'above' ? 'rounded-bl-none' : '');

export function CommentCard({ card, style, pinned, onDismiss }: { card: OpenCard; style: CardStyle; pinned: boolean; onDismiss(): void }) {
  const { anchor, parent, serial } = card;
  const form = useCommentForm({ anchor, parent, gone: () => cardGone(serial), onSent: onDismiss });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onDismiss();
  };
  return (
    <div
      role="dialog"
      aria-label={COPY.title(anchor.label)}
      data-comment-card=""
      data-anchor-kind={anchor.kind}
      data-anchor-locator={anchor.locator}
      data-card-phase={card.phase.kind}
      data-placement={style.mode}
      style={positionOf(style)}
      onKeyDown={onKeyDown}
      className={`pointer-events-auto absolute flex flex-col gap-2 overflow-y-auto rounded-lg border border-border-strong bg-bg-raised p-2.5 text-ui text-fg shadow-float ${cornerOf(style, pinned)}`}
    >
      <header className="flex min-w-0 items-center gap-1">
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui-sm font-medium text-fg" title={`${anchor.label}\n${anchor.locator}`}>
          {anchor.label}
        </h3>
        <button
          type="button"
          aria-label={COPY.close}
          title={COPY.close}
          onClick={onDismiss}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      {form.screenshot !== null && <ScreenshotThumbnail parent={parent} screenshot={form.screenshot} disabled={form.sending} onRemove={form.removeScreenshot} />}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.send(form.destination);
        }}
      >
        <textarea
          aria-label={FORM.field}
          placeholder={FORM.placeholder}
          autoFocus
          rows={1}
          value={form.text}
          disabled={form.sending}
          onChange={(event) => form.setText(event.target.value)}
          onKeyDown={form.onKeyDown}
          className={`${FIELD} max-h-[calc(6lh+0.5rem)] resize-none leading-snug field-sizing-content disabled:text-fg-muted`}
        />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <DestinationControl form={form} compact />
          </div>
          <button type="submit" disabled={!form.canSend(form.destination)} className={PRIMARY}>
            {form.submitLabel}
          </button>
        </div>
      </form>
      <CommentRefusal form={form} />
    </div>
  );
}
