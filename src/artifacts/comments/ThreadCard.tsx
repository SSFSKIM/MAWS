// X36, the shared comment card (P4-B1, docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D6; the P4 spec's
// §4.3, binding on it; the P4 interface ledger §4, whose prop names and draft rule are fixed): one thread drawn the same
// in a document's margin, the icon rail's overlay, the deck's and the design's pin popover and the All comments panel;
// where it sits is each surface's. Inactive and compacted (`compact`), it shows the first message and the two latest
// replies with the rest counted between (Docs' compaction); active, or where the host never compacts (the panel), every
// message and the reply field. The reply field's text is the host's (`draft`, `onDraftChange`), so a card that goes
// away keeps its draft. A click on the card outside its controls activates it, and the reply field takes the keyboard
// only when that click activated it: a thread the host activates otherwise (the caret, a click on the passage) leaves
// the keyboard where it was. On the focused card, outside a text field: R to the reply field (on a compacted card, R
// activates it as a click does first), E resolves or reopens, J and K the next and previous thread, U and Escape back
// to the text (the prior art's K3); Escape in the reply field exits too and keeps a written draft (X36's draft rule).
// Each key acts only when the host gave its handler. App chrome: comments.css, app tokens only.
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import type { ThreadState } from '../document/threads';
import './comments.css';

/** What the card reads of a thread: the part a document's and a deck's thread states share (`DeckThreadState` is one as
 *  it is; the card's test asserts it). */
export type ThreadCardThread = Pick<ThreadState, 'id' | 'quote' | 'status' | 'orphan' | 'messages' | 'createdBy' | 'createdAt'>;

export interface ThreadCardProps {
  thread: ThreadCardThread;
  /** The surface's active thread: drawn current, every message shown, its reply field there. */
  active: boolean;
  /** Compact the card while it is inactive (the margin, the popover's list); the panel shows every thread whole. */
  compact: boolean;
  /** A click on the card outside its controls, or on its quoted passage. */
  onActivate(): void;
  onReply(body: string): void;
  onResolve(): void;
  onReopen(): void;
  /** The reply field's text, held by the host. */
  draft: string;
  onDraftChange(text: string): void;
  /** J. */
  onNext?(): void;
  /** K. */
  onPrevious?(): void;
  /** U and Escape: back to the text. Escape in the reply field too, the draft kept. */
  onExit?(): void;
  /** The card's place among its surface's threads, 1-based, in its accessible name ("2 of 6"). */
  position?: { index: number; count: number };
  /** Draw the quoted passage (the panel); the margin and the popover sit beside the passage itself. */
  showQuote?: boolean;
  /** The thread's tab when it is not the one shown, beside the quote. */
  tabTitle?: string | null;
  /** The store is read-only: no reply field, Resolve and Reopen disabled. */
  readOnly?: boolean;
}

/** The latest replies a compacted card keeps after the first message. */
const COMPACT_LATEST = 2;
const NAME_WORDS = 8;

const firstWords = (text: string): string => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, NAME_WORDS).join(' ') + (words.length > NAME_WORDS ? '…' : '');
};

function accessibleName(thread: ThreadCardThread, position: ThreadCardProps['position']): string {
  const first = thread.messages[0];
  const author = actorDisplay(first?.by ?? thread.createdBy).name;
  const words = first ? firstWords(first.body) : `“${firstWords(thread.quote)}”`;
  return `${author}: ${words}${position ? ` (${position.index} of ${position.count})` : ''}`;
}

const CONTROLS = 'button, textarea, input, select, a, [contenteditable]';
const isTextField = (target: EventTarget): boolean =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) &&
  !(target instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type));

export function ThreadCard({ thread, active, compact, onActivate, onReply, onResolve, onReopen, draft, onDraftChange, onNext, onPrevious, onExit, position, showQuote = false, tabTitle = null, readOnly = false }: ThreadCardProps) {
  const replyField = useRef<HTMLTextAreaElement>(null);
  // set by the card's own click, so the activation that click causes moves the keyboard to the reply field; cleared
  // once the activation lands or the focus leaves the card
  const clicked = useRef(false);
  useEffect(() => {
    if (active && clicked.current) replyField.current?.focus();
    clicked.current = false;
  }, [active]);

  const open = thread.status === 'open';
  const whole = active || !compact;
  const replying = whole && open && !readOnly;
  const { messages } = thread;
  const hidden = whole ? 0 : Math.max(0, messages.length - 1 - COMPACT_LATEST);
  const head = hidden > 0 ? messages.slice(0, 1) : messages;
  const tail = hidden > 0 ? messages.slice(-COMPACT_LATEST) : [];

  const activateByClick = () => {
    clicked.current = true;
    onActivate();
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
    activateByClick();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
    if (event.defaultPrevented || event.nativeEvent.isComposing || isTextField(event.target) || metaKey || ctrlKey || altKey || shiftKey) return;
    const action = (() => {
      switch (key) {
        case 'r':
          // a compacted card has no field yet: R activates it as a click does, and the field takes the keyboard once
          // the activation lands (an open, writable thread only)
          if (replyField.current) return () => replyField.current?.focus();
          return open && !readOnly ? activateByClick : null;
        case 'e':
          return readOnly ? null : open ? onResolve : onReopen;
        case 'j':
          return onNext;
        case 'k':
          return onPrevious;
        case 'u':
        case 'Escape':
          return onExit;
        default:
          return null;
      }
    })();
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <article
      className="thread-card"
      role="group"
      aria-label={accessibleName(thread, position)}
      aria-current={active ? 'true' : undefined}
      tabIndex={0}
      data-thread={thread.id}
      data-status={thread.status}
      data-orphan={thread.orphan ? '' : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clicked.current = false;
      }}
    >
      {showQuote && (
        // the class names after the card's own are the panel's long-standing hooks (the e2e cases read them)
        <button type="button" className="thread-card-quote doc-thread-quote" aria-label={`Show passage: ${thread.quote}`} onClick={activateByClick}>
          {tabTitle !== null && <span className="thread-card-tab doc-thread-tab">{tabTitle}</span>}
          <span className="thread-card-quote-text doc-thread-quote-text">{thread.quote}</span>
        </button>
      )}
      {thread.orphan && <p className="thread-card-note">The commented passage was removed.</p>}
      {head.length > 0 && <Messages messages={head} />}
      {hidden > 0 && (
        <>
          <p className="thread-card-more">{`${hidden} more ${hidden === 1 ? 'reply' : 'replies'}`}</p>
          <Messages messages={tail} />
        </>
      )}
      {replying && <ReplyField ref={replyField} draft={draft} onDraftChange={onDraftChange} onReply={onReply} onExit={onExit} />}
      <div className="thread-card-actions">
        {open ? (
          <button type="button" className="thread-card-button" disabled={readOnly} onClick={onResolve}>
            Resolve
          </button>
        ) : (
          <button type="button" className="thread-card-button" disabled={readOnly} onClick={onReopen}>
            Reopen
          </button>
        )}
      </div>
    </article>
  );
}

function Messages({ messages }: { messages: ThreadCardThread['messages'] }) {
  return (
    <ol className="thread-card-messages">
      {messages.map((message) => {
        const who = actorDisplay(message.by);
        return (
          <li key={message.id} className="thread-card-message">
            <span className="thread-card-author">
              <span className="thread-card-chip" style={{ background: `var(${who.color})` }} aria-hidden />
              {who.name}
            </span>
            <span className="thread-card-body">{message.body}</span>
          </li>
        );
      })}
    </ol>
  );
}

// The thread's reply field (lifted from the threads rail, its text now the host's): Enter posts, Shift+Enter breaks a
// line, an input method's composition keeps its Enter and its Escape.
function ReplyField({ ref, draft, onDraftChange, onReply, onExit }: { ref: Ref<HTMLTextAreaElement>; draft: string; onDraftChange(text: string): void; onReply(body: string): void; onExit?: () => void }) {
  const body = draft.trim();
  const post = () => {
    if (body === '') return;
    onReply(body);
    onDraftChange('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && onExit) {
      event.preventDefault();
      onExit();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      post();
    }
  };
  return (
    <form
      className="thread-card-reply"
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <textarea ref={ref} className="thread-card-reply-field" aria-label="Reply" placeholder="Reply…" rows={1} value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={onKeyDown} />
      <button type="submit" className="thread-card-button" disabled={body === ''}>
        Reply
      </button>
    </form>
  );
}
