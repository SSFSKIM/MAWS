// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck's threads rail beside the stage, B's
// ThreadsRail (src/artifacts/document/editor/comments/ThreadsRail.tsx) for a deck: every thread oldest first, each
// with its slide, the element's quote, its messages (the person's, an agent's `artifact_reply`), a reply field and
// Resolve; an orphan (open, its element deleted) says so and keeps the element's last text; resolved threads are listed
// apart, each reopenable. Showing a thread shows its slide and selects its element. A reply, resolve and reopen write
// the thread only, under the comments' origin (outside undo); the active thread (its card's, a clicked pin's) is the
// rail's selected one, scrolled into view. App chrome, so it reads the app's tokens.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { slideOrder } from '../../model';
import { newThreadId, reopen, reply, resolve, type DeckThreadState } from '../../threads';
import { COMMENTS_ORIGIN, type DeckCommentsApi } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useDeckThreadStates } from './use-threads';
import './comments.css';

export function CommentsRail({ api, onClose }: { api: DeckCommentsApi; onClose(): void }) {
  const { session, author, readOnly, active } = api;
  const doc = session.doc;
  const threads = useDeckThreadStates(doc);
  const [showResolved, setShowResolved] = useState(true);
  const numbers = new Map(slideOrder(doc).map((id, i) => [id, i + 1])); // read on each render: the list follows the deck
  const open = threads.filter((thread) => thread.status === 'open');
  const resolved = threads.filter((thread) => thread.status === 'resolved');
  const item = (thread: DeckThreadState) => (
    <ThreadItem
      key={thread.id}
      thread={thread}
      slide={numbers.get(thread.slideId) ?? null}
      selected={thread.id === active}
      readOnly={readOnly}
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
        {open.length === 0 ? <p className="deck-comments-empty">{C.empty}</p> : open.map(item)}
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
  thread: DeckThreadState;
  slide: number | null;
  selected: boolean;
  readOnly: boolean;
  onShow(): void;
  onReply(body: string): void;
  onResolve(): void;
  onReopen(): void;
}

function ThreadItem({ thread, slide, selected, readOnly, onShow, onReply, onResolve, onReopen }: ItemProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <article
      ref={ref}
      className="deck-thread"
      aria-current={selected ? 'true' : undefined}
      aria-label={C.thread(thread.quote)}
      data-thread={thread.id}
      data-status={thread.status}
      data-orphan={thread.orphan ? '' : undefined}
      data-element={thread.elementId}
    >
      <button type="button" className="deck-thread-quote" aria-label={C.show(thread.quote)} onClick={onShow}>
        <span className="deck-thread-slide">{C.slide(slide)}</span>
        <span className="deck-thread-quote-text">{thread.quote}</span>
      </button>
      {thread.orphan && <p className="deck-thread-note">{C.orphan}</p>}
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
      {thread.status === 'open' && !readOnly && <ReplyField onReply={onReply} />}
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
function ReplyField({ onReply }: { onReply(body: string): void }) {
  const [text, setText] = useState('');
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
