// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck's threads rail beside the stage, B's
// ThreadsRail (src/artifacts/document/editor/comments/ThreadsRail.tsx) for a deck: every thread oldest first, each
// with its slide, the element's quote, its messages (the person's, an agent's `artifact_reply`), a reply field and
// Resolve; an orphan (open, its element deleted) says so and keeps the element's last text; resolved threads are listed
// apart, each reopenable. Showing a thread shows its slide and selects its element. A reply, resolve and reopen write
// the thread only, under the comments' origin (outside undo); the active thread (its card's, a clicked pin's) is the
// rail's selected one, scrolled into view. App chrome, so it reads the app's tokens.
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; V5): a thread's reply field reads and writes the
// editor's reply drafts, the pin popover's too, so a reply typed in either is there in the other. Show opens the
// thread's pin popover (the controller's, V11) and the rail stays open.
// WR 49: conversations whose targets were deleted stay out of both sections until explicitly revealed.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { newThreadId, reopen, reply, resolve, type DeckThreadState } from '../../threads';
import { useDeckView } from '../deck-view';
import { COMMENTS_ORIGIN, type DeckCommentsApi } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useReplyDrafts } from './drafts';
import { useDeckThreadStates } from './use-threads';
import { targetNumber } from './targets';
import './comments.css';

/**
 * P3-E (E1 M4; the P3-E spec's Decision Log 29): the rail's words for an artifact whose threads are not on slides (a
 * design's boards): the empty text, and per thread where it is, its Show button's name and its orphan note (`index`: the
 * thread's slide's place, 1-based, null when it is gone). Absent, C's own words.
 */
export interface CommentsRailLabels {
  empty: string;
  target(thread: DeckThreadState, index: number | null): { location: string; show: string; orphan: string };
}

export function CommentsRail({ api, onClose, labels }: { api: DeckCommentsApi; onClose(): void; labels?: CommentsRailLabels /* P3-E */ }) {
  const { session, author, readOnly, active } = api;
  const doc = session.doc;
  const threads = useDeckThreadStates(doc);
  const drafts = useReplyDrafts(api.drafts); // P4-B2
  const [showResolved, setShowResolved] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  // the slides' numbers follow the deck at once, as the filmstrip's do (the thread list waits for a quiet moment)
  const slides = useDeckView(doc).slides;
  const numbers = new Map(slides.map((slide, i) => [slide.id, i + 1]));
  // WR 49: missing targets stay hidden even when their conversation has been resolved.
  const shown = threads.filter((thread) => showDeleted || thread.live);
  const open = shown.filter((thread) => thread.status === 'open');
  const resolved = shown.filter((thread) => thread.status === 'resolved');
  const item = (thread: DeckThreadState) => (
    <ThreadItem
      key={thread.id}
      thread={thread}
      number={labels ? undefined : targetNumber(doc, threads, thread)}
      slide={numbers.get(thread.slideId) ?? null}
      copy={labels?.target(thread, numbers.get(thread.slideId) ?? null)} // P3-E
      selected={thread.id === active}
      readOnly={readOnly}
      draft={drafts.get(thread.id) ?? ''} // P4-B2
      onDraftChange={(text) => api.drafts.set(thread.id, text)}
      onShow={() => api.show(thread)}
      onReply={(body) => !readOnly && reply(doc, thread.id, { id: `${thread.id}:${newThreadId()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)}
      onResolve={() => !readOnly && resolve(doc, thread.id, author.actor, author.now(), COMMENTS_ORIGIN)}
      onReopen={() => !readOnly && reopen(doc, thread.id, author.actor, author.now(), COMMENTS_ORIGIN)}
    />
  );
  return (
    <aside className="deck-inspector deck-comments" aria-label={C.rail} data-deck-rail="comments">
      <header className="deck-comments-header">
        <h2 className="deck-inspector-title">{C.rail}</h2>
        <button type="button" className="deck-button" aria-label={C.close} title={C.close} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="deck-comments-body">
        {threads.some((thread) => !thread.live) && (
          <button type="button" className="deck-comments-section" aria-pressed={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>
            {showDeleted ? 'Hide deleted-target comments' : 'Show deleted-target comments'}
          </button>
        )}
        {open.length === 0 ? <p className="deck-comments-empty">{labels?.empty ?? C.empty /* P3-E */}</p> : open.map(item)}
        {resolved.length > 0 && (
          <section className="deck-comments-resolved" aria-label={C.resolved(resolved.length)}>
            <button type="button" className="deck-comments-section" aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>
              {C.resolved(resolved.length)}
            </button>
            {showResolved && resolved.map(item)}
          </section>
        )}
      </div>
    </aside>
  );
}

interface ItemProps {
  number?: number;
  thread: DeckThreadState;
  slide: number | null;
  /** P3-E: the thread's words from the rail's labels, else C's. */
  copy?: { location: string; show: string; orphan: string };
  selected: boolean;
  readOnly: boolean;
  /** P4-B2: the thread's reply draft, the editor's. */
  draft: string;
  onDraftChange(text: string): void;
  onShow(): void;
  onReply(body: string): void;
  onResolve(): void;
  onReopen(): void;
}

function ThreadItem({ thread, slide, copy, number, selected, readOnly, draft, onDraftChange, onShow, onReply, onResolve, onReopen }: ItemProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <article
      ref={ref}
      className="deck-thread"
      aria-current={selected ? 'true' : undefined}
      aria-label={`${C.thread(thread.quote)}${number === undefined ? '' : ` · Element ${number}`}`}
      data-thread={thread.id}
      data-status={thread.status}
      data-orphan={thread.orphan ? '' : undefined}
      data-element={thread.elementId}
    >
      <button type="button" className="deck-thread-quote" aria-label={copy?.show ?? C.show(thread.quote) /* P3-E */} onClick={onShow}>
        <span className="deck-thread-slide">{copy?.location ?? C.slide(slide) /* P3-E */}</span>
        <span className="deck-thread-quote-text">{thread.quote}{number === undefined ? '' : ` · Element ${number}`}</span>
      </button>
      {thread.orphan && <p className="deck-thread-note">{copy?.orphan ?? C.orphan /* P3-E */}</p>}
      {thread.messages.length > 0 && (
        <ol className="deck-thread-messages">
          {thread.messages.map((message) => {
            const who = actorDisplay(message.by);
            return (
              <li key={message.id} className="deck-thread-message">
                <span className="deck-thread-author">
                  <span className="deck-thread-chip" style={{ background: `var(${who.color})` }} aria-hidden />
                  {who.name}
                </span>
                <span className="deck-thread-body">{message.body}</span>
              </li>
            );
          })}
        </ol>
      )}
      {thread.status === 'open' && !readOnly && <ReplyField text={draft} setText={onDraftChange} onReply={onReply} />}
      <div className="deck-thread-actions">
        {thread.status === 'open' ? (
          <button type="button" className="deck-button" disabled={readOnly} onClick={onResolve}>
            {C.resolve}
          </button>
        ) : (
          <button type="button" className="deck-button" disabled={readOnly} onClick={onReopen}>
            {C.reopen}
          </button>
        )}
      </div>
    </article>
  );
}

// The thread's reply field: Enter posts (Shift+Enter breaks a line; an input method's composition keeps its Enter).
// P4-B2: its text the editor's draft.
function ReplyField({ text, setText, onReply }: { text: string; setText(text: string): void; onReply(body: string): void }) {
  const body = text.trim();
  const post = () => {
    if (body === '') return;
    onReply(body);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    post();
  };
  return (
    <form
      className="deck-thread-reply"
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <textarea className="deck-thread-reply-field" aria-label={C.reply} placeholder={C.replyPlaceholder} rows={1} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
      <button type="submit" className="deck-button" disabled={body === ''}>
        {C.reply}
      </button>
    </form>
  );
}
