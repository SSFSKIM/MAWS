// The comment card (P2-E1 document, D5 and D6; X21): a small non-modal panel beside the element a comment is about,
// Claude Desktop's measure (300 px). Composing, it is the sheet's form at card size, through the same hook and parts
// (`comment-form.ts`, `CommentFormParts.tsx`), so the phases and the sends cannot drift: a header naming the anchor
// (its full label and locator as the title) with Close, the producer's screenshot, an autosizing field (1 to 6 lines),
// and one row with the destination, compact, and Send. Its Side thread turns the card into that thread (`CardThread`),
// its header then leading with the thread's phase glyph and offering Open as tab; the card takes its placement's whole
// height then, the thread being a bounded scroll. A thread whose card went before the fork answered is revealed as the
// sheet reveals one. Escape with focus inside dismisses it, answered here so the viewer's picking listener (which skips
// an answered Escape) never sees it; a composition's Escape is the input method's, and a nested layer's (answered, or
// from a portal outside the card's DOM) that layer's. No focus trap and no `aria-modal`: the person reads the page while
// the card is open.
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { GlyphMark } from '../../attention/GlyphMark';
import { glyphFor } from '../../attention/glyph';
import { FIELD, PRIMARY, QUIET } from '../../sessions/ui';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useSessions } from '../../stores/sessions';
import { useCommentForm } from '../comment-form';
import { CommentRefusal, DestinationControl, ScreenshotThumbnail } from '../CommentFormParts';
import { SIDE_COPY } from '../copy';
import type { CardFrame } from './CardHost';
import { CardThread, openThreadAsTab } from './CardThread';
import type { CardStyle } from './placement';
import { cardGone, enterThread, type OpenCard } from './store';

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
    case 'strip': // P2-E2: in flow in its host's strip, the margin its inset
      return { margin: DOCK_INSET, width: style.width, maxHeight: style.maxHeight };
  }
}

// The corner touching the pin is squared (Desktop's card at its click point).
// P2-F L148: in the browser's strip the card is in flow under the page, with 8 px of margin the strip clips at (its
// half-column cap): it casts the strip's shadow, whose every layer reaches at most 8 px, where the floating shadow's wide
// blurs (and the composer's 80 px light layer) were trimmed at the sides and bottom. Over a frame it floats.
const shadowOf = (style: CardStyle) => (style.mode === 'strip' ? 'shadow-strip' : 'shadow-float');
const cornerOf = (style: CardStyle, pinned: boolean) => (!pinned ? '' : style.mode === 'below' ? 'rounded-tl-none' : style.mode === 'above' ? 'rounded-bl-none' : '');

interface Props {
  card: OpenCard;
  style: CardStyle;
  pinned: boolean;
  frame: CardFrame;
  visible: boolean; // its host is on screen
  onDismiss(): void;
}

export function CommentCard({ card, style, pinned, frame, visible, onDismiss }: Props) {
  const { anchor, serial, phase } = card;
  const thread = phase.kind === 'thread' ? phase : null;
  const ref = useRef<HTMLDivElement>(null);
  const inThread = thread !== null;
  // the composer's field goes with the composing phase: focus stays in the card, so Escape still reaches it
  useEffect(() => {
    if (inThread && !ref.current?.contains(document.activeElement)) ref.current?.focus();
  }, [inThread]);
  // P2-F F-C1: an Escape a nested layer answered (the turn summary's Radix popover), or one from a portal that bubbles
  // through the card's React tree from outside its DOM, is that layer's, not the card's
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    onDismiss();
  };
  return (
    <div
      ref={ref}
      role="dialog"
      tabIndex={-1}
      aria-label={COPY.title(anchor.label)}
      data-comment-card=""
      data-anchor-kind={anchor.kind}
      data-anchor-locator={anchor.locator}
      data-card-phase={phase.kind}
      data-placement={style.mode}
      style={{ ...positionOf(style), ...(thread && { height: style.maxHeight }) }}
      onKeyDown={onKeyDown}
      className={`pointer-events-auto ${style.mode === 'strip' ? 'relative' : 'absolute'} flex flex-col gap-2 rounded-lg border border-border-strong bg-bg-raised p-2.5 text-ui text-fg ${shadowOf(style)} outline-none ${thread ? 'overflow-hidden' : 'overflow-y-auto'} ${cornerOf(style, pinned)}`}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-1">
        {thread && <ThreadGlyph child={thread.child} />}
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui-sm font-medium text-fg" title={`${anchor.label}\n${anchor.locator}`}>
          {anchor.label}
        </h3>
        {thread && (
          <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => openThreadAsTab(serial, thread.child)}>
            {COPY.openAsTab}
          </button>
        )}
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
      {thread ? <CardThread card={card} child={thread.child} echo={thread.echo} frame={frame} visible={visible} /> : <CardComposer card={card} onDismiss={onDismiss} />}
    </div>
  );
}

// The thread's phase at a glance, as the sidebar draws it (working, waiting, failed).
function ThreadGlyph({ child }: { child: AppSessionId }) {
  const record = useSessions((s) => s.records.get(child) ?? null);
  const digest = useSessions((s) => s.digests.get(child) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, child));
  return record === null ? null : <GlyphMark glyph={glyphFor(record, digest, pending)} className="w-[12px] shrink-0" />;
}

// The composer half. Its Side thread is not revealed while the card holds it (the card becomes the thread); a card closed
// or replaced before the fork answered asks for the reveal, so a thread is never created unseen. Send to main closes it.
function CardComposer({ card, onDismiss }: { card: OpenCard; onDismiss(): void }) {
  const { anchor, parent, serial } = card;
  const gone = () => cardGone(serial);
  const form = useCommentForm({ anchor, parent, gone, reveal: gone, onSent: ({ child, text }) => (child ? enterThread(serial, child, text) : onDismiss()) });
  return (
    <>
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
    </>
  );
}
