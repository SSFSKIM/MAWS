// The threads rail (D9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the editor's right-hand list of the
// document's comment threads, every tab's, oldest first: each with its quoted passage, its messages (any author's: the
// person's, an agent's `artifact_reply`), a reply field and Resolve; an orphan (open, its passage gone) says so;
// resolved threads are listed apart, each reopenable. Showing a thread selects
// its passage in the editor (switching to its tab). A reply, resolve and reopen write the threads map only, never the
// text, and sit outside undo; a reply is the surface's identity's (the person's). The editor's active thread (its card's, a shown one's, a clicked passage's) is the rail's selected
// one, scrolled into view. App chrome beside the page, so it reads the app's tokens (chrome.css). M5 adds History
// beside it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import type { Doc } from '../../../yjs';
import { nanoid8 } from '../../schema';
import { reopen, reply, resolve, type ThreadState } from '../../threads';
import type { TabInfo } from '../../tabs';
import { COMMENTS_ORIGIN } from './plugins';
import type { CommentAuthor } from './surface';
import { useThreadStates } from './use-threads';

interface Props {
  doc: Doc;
  tabs: TabInfo[];
  /** The tab the editor shows: a thread of another tab names its tab. */
  activeTab: string | null;
  /** The editor's active thread, selected here. */
  activeThread: string | null;
  author: CommentAuthor;
  onShow(thread: ThreadState): void;
  onClose(): void;
}

export function ThreadsRail({ doc, tabs, activeTab, activeThread, author, onShow, onClose }: Props) {
  const threads = useThreadStates(doc);
  const [showResolved, setShowResolved] = useState(true);
  const open = threads.filter((thread) => thread.status === 'open');
  const resolved = threads.filter((thread) => thread.status === 'resolved');
  const tabTitle = (thread: ThreadState) => (thread.tabId === activeTab ? null : (tabs.find((tab) => tab.id === thread.tabId)?.title ?? null));
  const item = (thread: ThreadState) => (
    <ThreadItem
      key={thread.id}
      thread={thread}
      tabTitle={tabTitle(thread)}
      selected={thread.id === activeThread}
      onShow={() => onShow(thread)}
      onReply={(body) => reply(doc, thread.id, { id: `${thread.id}:${nanoid8()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)}
      onResolve={() => resolve(doc, thread.id, author.actor, author.now(), COMMENTS_ORIGIN)}
      onReopen={() => reopen(doc, thread.id, author.actor, author.now(), COMMENTS_ORIGIN)}
    />
  );
  return (
    <aside className="doc-rail" aria-label="Comments">
      <header className="doc-rail-header">
        <h2 className="doc-rail-title">Comments</h2>
        <button type="button" className="doc-tool" aria-label="Close comments" title="Close comments" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="doc-rail-body">
        {open.length === 0 ? <p className="doc-rail-empty">No open comments. Select text and choose Comment.</p> : open.map(item)}
        {resolved.length > 0 && (
          <section className="doc-rail-resolved" aria-label={`Resolved (${resolved.length})`}>
            <button type="button" className="doc-rail-section" aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>
              Resolved ({resolved.length})
            </button>
            {showResolved && resolved.map(item)}
          </section>
        )}
      </div>
    </aside>
  );
}

interface ItemProps {
  thread: ThreadState;
  tabTitle: string | null;
  selected: boolean;
  onShow(): void;
  onReply(body: string): void;
  onResolve(): void;
  onReopen(): void;
}

function ThreadItem({ thread, tabTitle, selected, onShow, onReply, onResolve, onReopen }: ItemProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <article
      ref={ref}
      className="doc-thread"
      aria-current={selected ? 'true' : undefined}
      data-thread={thread.id}
      data-status={thread.status}
      data-orphan={thread.orphan ? '' : undefined}
      aria-label={`Comment on “${thread.quote}”`}
    >
      <button type="button" className="doc-thread-quote" aria-label={`Show passage: ${thread.quote}`} onClick={onShow}>
        {tabTitle !== null && <span className="doc-thread-tab">{tabTitle}</span>}
        <span className="doc-thread-quote-text">{thread.quote}</span>
      </button>
      {thread.orphan && <p className="doc-thread-note">The commented passage was removed.</p>}
      {thread.messages.length > 0 && (
        <ol className="doc-thread-messages">
          {thread.messages.map((message) => {
            const who = actorDisplay(message.by);
            return (
              <li key={message.id} className="doc-thread-message">
                <span className="doc-thread-author">
                  <span className="doc-thread-chip" style={{ background: `var(${who.color})` }} aria-hidden />
                  {who.name}
                </span>
                <span className="doc-thread-body">{message.body}</span>
              </li>
            );
          })}
        </ol>
      )}
      {thread.status === 'open' && <ReplyField onReply={onReply} />}
      <div className="doc-thread-actions">
        {thread.status === 'open' ? (
          <button type="button" className="doc-tool" onClick={onResolve}>
            Resolve
          </button>
        ) : (
          <button type="button" className="doc-tool" onClick={onReopen}>
            Reopen
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
      className="doc-thread-reply"
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <textarea className="doc-thread-reply-field" aria-label="Reply" placeholder="Reply…" rows={1} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
      <button type="submit" className="doc-tool" disabled={body === ''}>
        Reply
      </button>
    </form>
  );
}
