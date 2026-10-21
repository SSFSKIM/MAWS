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
// a host whose frame opts in keeps a composing card whose field holds text on Escape, handing the keyboard back to its
// own control (`onEscapeKept`), and discards one whose field is empty when the focus leaves the card for elsewhere
// (`onDiscard`: the focus is where the person put it). A click on the composing card's body, off its controls, puts the
// caret at the end of the field. The field's text is told to the frame as it changes (`onDraft`), and a remounted card
// starts from the frame's (`draftOf`).
import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { GlyphMark } from '../../attention/GlyphMark';
import { glyphFor } from '../../attention/glyph';
import { displayTitle } from '../../sessions/title'; // P3-F1
import { FIELD, PRIMARY, QUIET } from '../../sessions/ui';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useSessions } from '../../stores/sessions';
import { useCommentForm } from '../comment-form';
import { CommentRefusal, DestinationControl, ScreenshotThumbnail } from '../CommentFormParts';
import { SIDE_COPY } from '../copy';
import type { CardFrame } from './CardHost';
import { CardThread, openThreadAsTab } from './CardThread';
import { cardPosition, type CardStyle } from './placement';
import { cardGone, enterThread, type OpenCard } from './store';

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
  onDismiss(): void;
  // P4-B1 start: the card closes with the focus left where it went (a blur's discard)
  onDiscard(): void;
  // Escape kept a non-empty draft (the frame's `keepDraftOnEscape`): the host's control takes the keyboard back
  onEscapeKept?(): void;
  // P4-B1 end
}

export function CommentCard({ card, style, pinned, frame, visible, onDismiss, onDiscard, onEscapeKept /* P4-B1 */ }: Props) {
  const { anchor, serial, phase } = card;
  const thread = phase.kind === 'thread' ? phase : null;
  const ref = useRef<HTMLDivElement>(null);
  // P4-B1: the composing field's text, which Escape and a blur read (the composer reports it as it changes)
  const draft = useRef(thread ? '' : (frame.draftOf?.(card) ?? ''));
  const composingEmpty = () => thread === null && draft.current.trim() === '';
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
    // P4-B1 (C6; X36): a draft is kept, the keyboard going back to the text; an empty field is discarded as before
    if (frame.keepDraftOnEscape && thread === null && !composingEmpty()) onEscapeKept?.();
    else onDismiss();
  };
  // P4-B1 (C4): the focus leaving the card for somewhere else with nothing typed discards it. Focus going nowhere is a
  // click on something unfocusable (the margin, the page's ground) or the window losing focus: told apart on the next
  // task, when a window blur has left the document without focus; a card gone meanwhile (a remount) is not asked
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!frame.discardOnBlurEmpty || event.currentTarget.contains(next) || !composingEmpty()) return;
    if (next !== null) return onDiscard();
    setTimeout(() => {
      const root = ref.current;
      if (root && document.hasFocus() && !root.contains(document.activeElement) && composingEmpty()) onDiscard();
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
      className={`pointer-events-auto ${flowOf(style) /* P4-B1 */} flex flex-col gap-2 rounded-lg border border-border-strong bg-bg-raised p-2.5 text-ui text-fg ${shadowOf(style)} outline-none ${thread ? 'overflow-hidden' : 'overflow-y-auto'} ${cornerOf(style, pinned)}`}
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
          onClick={onDismiss}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      {!thread && frame.namesParent && <ParentName parent={card.parent} /> /* P3-F1 */}
      {thread ? <CardThread card={card} child={thread.child} echo={thread.echo} frame={frame} visible={visible} /> : <CardComposer card={card} frame={frame} onDismiss={onDismiss} onText={(text) => (draft.current = text)} /* P4-B1 */ />}
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

// P3-F1: the session a composing card's comment goes to, for a host with no chat beside it.
function ParentName({ parent }: { parent: AppSessionId }) {
  const title = useSessions((s) => displayTitle(s.records.get(parent)));
  return (
    <p data-card-parent={parent} className="m-0 shrink-0 truncate text-ui-sm text-fg-muted" title={title}>
      {COPY.parent(title)}
    </p>
  );
}

// The composer half. Its Side thread is not revealed while the card holds it (the card becomes the thread); a card closed
// or replaced before the fork answered asks for the reveal, so a thread is never created unseen. Send to main closes it.
function CardComposer({ card, frame, onDismiss, onText }: { card: OpenCard; frame: CardFrame; onDismiss(): void; onText(text: string): void }) { // P4-B1: onText
  const { anchor, parent, serial } = card;
  const gone = () => cardGone(serial);
  const { onSending, onDraft } = frame; // P3-B; P4-B1: onDraft
  const initial = card.phase.kind === 'composing' ? card.phase.destination : undefined; // P3-F1
  const text = frame.draftOf?.(card) ?? ''; // P4-B1: a remounted card's kept draft
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
  const form = useCommentForm({ anchor, parent, gone, reveal: gone, onSent: ({ child, text }) => (child ? enterThread(serial, child, text) : onDismiss()), ...(onSending && { onSending: (sending) => onSending(card, sending) }), ...(initial && { destination: initial }) /* P3-F1 */, text /* P4-B1 */, sendKey: `card:${serial}` /* P4-B3: a remount of the card (a moved document) keeps its send */ });
  // P4-B1: the field's text, told to the card and the frame as the person changes it
  const setText = (value: string) => {
    form.setText(value);
    onText(value);
    onDraft?.(card, value);
  };
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
          ref={field} // P4-B1: focused on mount by the layout effect above (C6), in place of autoFocus
          rows={1}
          value={form.text}
          disabled={form.sending}
          onChange={(event) => setText(event.target.value) /* P4-B1 */}
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

// P4-B1 (C6): the last composer to unmount, by its card, and whether the keyboard was in its card then (one card per
// window, so one record).
let lastUnmount: { serial: number; focused: boolean } | null = null;

// P4-B1 (C5): the field takes the keyboard with the caret after its text.
export function focusAtEnd(field: HTMLTextAreaElement): void {
  field.focus();
  const end = field.value.length;
  field.setSelectionRange(end, end);
}
