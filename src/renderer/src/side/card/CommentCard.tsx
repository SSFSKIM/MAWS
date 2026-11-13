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
//
// P4-B1 (D8 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md; X36's draft rule, the prior art's C3 to C6):
// a composing card whose field holds text is kept on Escape, the keyboard going back to its host's control, and one whose
// field is empty is discarded when the focus leaves the card for elsewhere (the focus is where the person put it). A
// click on the composing card's body, off its controls, puts the caret at the end of the field.
//
// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M2; decisions 8, 9 and 16): the row holds
// the "Send to main" checkbox and Send, with the lines that say why a send can't go as it stands under it; a screenshot
// the route can never carry is not drawn. A send to main that went tells the host's place where it went. The card names
// the receiving session ("Session: <title>") on every host exactly when it is not the session the main area shows.
import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { MESSAGE_COMMENTS_MAX } from '@shared/anchor/message'; // Decision Log 52
import type { AppSessionId } from '@shared/graph/ids';
import { GlyphMark } from '../../attention/GlyphMark';
import { glyphFor } from '../../attention/glyph';
import { shownSession } from '../../panel/host'; // UX wave U5a
import { FIELD, PRIMARY, QUIET } from '../../sessions/ui';
import { useLayout } from '../../stores/layout';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useSessions } from '../../stores/sessions';
import { receivingTitle } from '../actions';
import { usePassForm } from '../comment-form';
import { CommentFormLines, CommentRefusal, ScreenshotThumbnail, SendToMainBox } from '../CommentFormParts';
import { SIDE_COPY } from '../copy';
import type { CardFrame } from './CardHost';
import { CardThread, openThreadAsTab } from './CardThread';
import { cardPosition, type CardStyle } from './placement';
import { composingOf, discardComment, editComment, leaveCard, useCommentCard, type OpenCard, type PassComment } from './store';

const COPY = SIDE_COPY.card;
const FORM = SIDE_COPY.composer;
// Where the host's layout puts the card, in the host's box: `cardPosition` (P4-B2: moved to the portable placement, where
// the pin popover places itself the same way).

// The corner touching the pin is squared (Desktop's card at its click point).
// P2-F L148: in the browser's strip the card is in flow under the page, with 8 px of margin the strip clips at (its
// half-column cap): it casts the strip's shadow, whose every layer reaches at most 8 px, where the floating shadow's wide
// blurs (and the composer's 80 px light layer) were trimmed at the sides and bottom. Over a frame it floats.
const shadowOf = (style: CardStyle) => (style.mode === 'strip' ? 'shadow-strip' : 'shadow-float');
// P4-B1: the margin's card is in flow in its entry, as the strip's is
const flowOf = (style: CardStyle) => (style.mode === 'strip' || style.mode === 'margin' ? 'relative' : 'absolute');
const cornerOf = (style: CardStyle, pinned: boolean) => (!pinned ? '' : style.mode === 'below' ? 'rounded-tl-none' : style.mode === 'above' ? 'rounded-bl-none' : '');

interface Props {
  card: OpenCard;
  style: CardStyle;
  pinned: boolean;
  frame: CardFrame;
  visible: boolean; // its host is on screen
  onDismiss(): void; // a thread card's Close or Escape: it closes, the keyboard going back to the host's control
  restoreFocus?(): void; // the host's control, after a composing card went or kept its draft on Escape
}

// UX wave U5a: the comment a composing card edits, read where it is acted on (its words are the store's).
const editing = (card: OpenCard) => composingOf(card);
const typed = (card: OpenCard) => (editing(card)?.comment.text.trim() ?? '') !== '';
const inFlight = (card: OpenCard) => editing(card)?.comment.flight != null;

export function CommentCard({ card, style, pinned, frame, visible, onDismiss, restoreFocus }: Props) {
  const { anchor, serial, phase } = card;
  const thread = phase.kind === 'thread' ? phase : null;
  const ref = useRef<HTMLDivElement>(null);
  const inThread = thread !== null;
  const shown = useLayout((s) => shownSession(s.main)); // UX wave U5a (decision 16)
  // the composer's field goes with the composing phase: focus stays in the card, so Escape still reaches it
  useEffect(() => {
    if (inThread && !ref.current?.contains(document.activeElement)) ref.current?.focus();
  }, [inThread]);
  // UX wave U5a: the person's Close drops the comment (one in flight is only left); the keyboard goes back to the host
  const close = () => {
    const at = editing(card);
    if (thread !== null || at === null) return onDismiss();
    if (at.comment.flight !== null) leaveCard(serial);
    else discardComment(at.key, at.comment.id);
    restoreFocus?.();
  };
  // P2-F F-C1: an Escape a nested layer answered (the turn summary's Radix popover), or one from a portal that bubbles
  // through the card's React tree from outside its DOM, is that layer's, not the card's
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    if (thread !== null) return onDismiss();
    // P4-B1 (C6; X36), every host's since UX wave U5a: a draft is kept, the keyboard going back to the host's control;
    // a field with nothing typed is discarded
    if (!typed(card) && !inFlight(card)) return close();
    if (restoreFocus) restoreFocus();
    else leaveCard(serial);
  };
  // P4-B1 (C4): the focus leaving the card for somewhere else with nothing typed discards it. Focus going nowhere is a
  // click on something unfocusable (the margin, the page's ground) or the window losing focus: told apart on the next
  // task, when a window blur has left the document without focus; a card gone meanwhile (a remount) is not asked
  const discardBlurred = () => {
    const at = editing(card);
    if (at && at.comment.flight === null && !typed(card)) discardComment(at.key, at.comment.id);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (thread !== null || event.currentTarget.contains(next) || typed(card)) return;
    if (next !== null) return discardBlurred();
    setTimeout(() => {
      const root = ref.current;
      if (root && document.hasFocus() && !root.contains(document.activeElement) && useCommentCard.getState().open?.serial === serial) discardBlurred();
    }, 0);
  };
  // P4-B1 (C5): a click on the composing card's body, off its controls, puts the caret at the end of the field
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (thread !== null || (event.target as Element).closest('button, a, input, textarea, select, label, [role="button"]')) return;
    const field = ref.current?.querySelector('textarea');
    if (field) focusAtEnd(field);
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
      data-card-serial={serial} // P4-B1: the document's focusDraft finds its field by it
      // P4-B1: in the margin a thread takes its content's height up to the cap (the entry is measured, and the stack would
      // hold room for a mostly empty card)
      style={{ ...cardPosition(style), ...(thread && style.mode !== 'margin' && { height: style.maxHeight }) }}
      onKeyDown={onKeyDown}
      onBlur={onBlur} // P4-B1
      onClick={onClick} // P4-B1
      // UX wave U5a (decision 23): the card itself never scrolls; its composing region does
      className={`pointer-events-auto ${flowOf(style) /* P4-B1 */} flex flex-col gap-2 overflow-hidden rounded-lg border border-border-strong bg-bg-raised p-2.5 text-ui text-fg ${shadowOf(style)} outline-none ${cornerOf(style, pinned)}`}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-1">
        {thread && <ThreadGlyph child={thread.child} />}
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui-sm font-medium text-fg" title={`${anchor.label}\n${anchor.locator}`}>
          {anchor.label}
        </h3>
        {frame.actions?.(card) /* P3-B */}
        {thread && (
          <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => openThreadAsTab(serial, thread.child)}>
            {COPY.openAsTab}
          </button>
        )}
        <button
          type="button"
          aria-label={COPY.close}
          title={COPY.close}
          onClick={close}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      {!thread && shown !== card.parent && <ParentName parent={card.parent} /> /* P3-F1; UX wave U5a: the one rule */}
      {thread ? <CardThread card={card} child={thread.child} echo={thread.echo} frame={frame} visible={visible} /> : phase.kind === 'composing' && <CardComposer card={card} passKey={phase.pass} commentId={phase.comment} {...(restoreFocus && { restoreFocus })} />}
    </div>
  );
}

// The thread's phase at a glance, as the sidebar draws it (working, waiting, failed).
function ThreadGlyph({ child }: { child: AppSessionId }) {
  const record = useSessions((s) => s.records.get(child) ?? null);
  const digest = useSessions((s) => s.digests.get(child) ?? null);
  const listing = useSessions((s) => s.listed.get(child)); // P5 O7 M10: a remote lane B record's state (`listedStateOf`)
  const pending = useAttention((s) => selectPendingOf(s, child));
  return record === null ? null : <GlyphMark glyph={glyphFor(record, digest, pending, listing)} className="w-[12px] shrink-0" />;
}

// P3-F1: the session a composing card's comment goes to, when the main area shows another (UX wave U5a).
function ParentName({ parent }: { parent: AppSessionId }) {
  const title = useSessions((s) => receivingTitle(s, parent));
  return (
    <p data-card-parent={parent} className="m-0 shrink-0 truncate text-ui-sm text-fg-muted" title={title}>
      {COPY.parent(title)}
    </p>
  );
}

// The composer half, over one comment of its pass (UX wave U5a). Send sends the pass; what becomes of the card then is
// the send's (§D): it closes and its host's place says where the comments went, or it becomes the side thread. A send
// that took the card away gives the keyboard back to the host's control.
function CardComposer({ card, passKey, commentId, restoreFocus }: { card: OpenCard; passKey: string; commentId: string; restoreFocus?(): void }) {
  const { parent, serial } = card;
  const form = usePassForm(passKey, commentId);
  // P4-B1 (C6): the field takes the keyboard when the card first shows, and on a remount (its host moved) only if the
  // keyboard was in the card when the previous mount went, so a kept draft drawn again elsewhere does not pull it back.
  // Asked in the mount's layout effect, which runs after the previous mount's cleanup in the same commit (a render runs
  // before it).
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (lastUnmount?.serial !== serial || lastUnmount.focused) element?.focus();
    return () => {
      lastUnmount = { serial, focused: element?.closest('[data-comment-card]')?.contains(document.activeElement) ?? false };
    };
  }, [serial]);
  if (form.comment === null) return null; // sent or dropped: the card goes in the same update
  const send = (to: 'thread' | 'main') =>
    void form.send(to).then(() => {
      if (useCommentCard.getState().open === null) restoreFocus?.();
    });
  return (
    <form
      className="flex min-h-0 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send(form.destination);
      }}
    >
      <div data-card-scroll="" className="flex min-h-0 shrink flex-col gap-2 overflow-y-auto">
        {form.others.length > 0 && <OtherComments passKey={passKey} hostId={card.hostId} comments={form.others} />}
        {form.screenshot !== null && form.showScreenshot && <ScreenshotThumbnail parent={parent} screenshot={form.screenshot} disabled={form.sending} onRemove={form.removeScreenshot} />}
        <textarea
          aria-label={FORM.field}
          placeholder={FORM.placeholder}
          ref={field} // P4-B1: focused on mount by the layout effect above (C6), in place of autoFocus
          rows={1}
          value={form.text}
          disabled={form.sending}
          onChange={(event) => form.setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (event.shiftKey && !event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send(form.destination);
          }}
          className={`${FIELD} max-h-[calc(6lh+0.5rem)] shrink-0 resize-none leading-snug field-sizing-content disabled:text-fg-muted`}
        />
      </div>
      <div data-send-row="" className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <SendToMainBox form={form} />
        </div>
        <button type="submit" disabled={!form.canSend(form.destination)} className={PRIMARY}>
          {form.submitLabel}
        </button>
      </div>
      <CommentFormLines form={form} />
      {card.limit && form.others.length + 1 >= MESSAGE_COMMENTS_MAX && ( /* Decision Log 52: a pick its full pass did not take */
        <p data-pass-limit="" className="m-0 text-ui-sm text-fg-muted">
          {COPY.limit(MESSAGE_COMMENTS_MAX)}
        </p>
      )}
      <CommentRefusal form={form} onSend={send} />
    </form>
  );
}

// UX wave U5a (§C part 3): the pass's other comments, one line each (the element's label, the first words, Remove); a
// click edits that one. At most three lines show; more scroll within the list.
function OtherComments({ passKey, hostId, comments }: { passKey: string; hostId: string | null; comments: PassComment[] }) {
  return (
    <ul data-pass-comments="" className="m-0 max-h-[72px] shrink-0 list-none overflow-y-auto p-0">
      {comments.map((comment) => (
        <li key={comment.id} data-pass-comment={comment.id} className="flex h-6 min-w-0 items-center gap-1 text-ui-sm">
          <button type="button" className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate rounded-sm px-1 text-left hover:bg-bg-hover" title={`${comment.anchor.label}\n${comment.text}`} onClick={() => editComment(passKey, comment.id, hostId ?? undefined)}>
            <span className="shrink-0 font-medium text-fg">{comment.anchor.label}</span>
            <span className="min-w-0 truncate text-fg-muted">{comment.text.trim()}</span>
          </button>
          <button
            type="button"
            aria-label={COPY.removeComment}
            title={COPY.removeComment}
            disabled={comment.flight !== null}
            onClick={() => discardComment(passKey, comment.id)}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-2.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

// P4-B1 (C6): the last composer to unmount, by its card, and whether the keyboard was in its card then (one card per
// window, so one record).
let lastUnmount: { serial: number; focused: boolean } | null = null;

// P4-B1 (C5): the field takes the keyboard with the caret after its text.
export function focusAtEnd(field: HTMLTextAreaElement): void {
  field.focus();
  const end = field.value.length;
  field.setSelectionRange(end, end);
}
