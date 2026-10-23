// The threads rail (D9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the editor's right-hand list of the
// document's comment threads, every tab's, oldest first: each with its quoted passage, its messages (any author's: the
// person's, an agent's `artifact_reply`), a reply field and Resolve; an orphan (open, its passage gone) says so;
// resolved threads are listed apart, each reopenable. Showing a thread selects
// its passage in the editor (switching to its tab). A reply, resolve and reopen write the threads map only, never the
// text, and sit outside undo; a reply is the surface's identity's (the person's). The editor's active thread (its card's, a shown one's, a clicked passage's) is the rail's selected
// one, scrolled into view. App chrome beside the page, so it reads the app's tokens (chrome.css). M5 adds History
// beside it.
//
// P4-B1 (docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D9; the prior art's Z4): the rail is now the All
// comments panel, still the complementary "Comments" (the margin and the panel are never on screen together). Each
// thread is X36's card (src/artifacts/comments/ThreadCard.tsx) drawn whole with its quoted passage; a click on the card
// or its quote shows the thread. The panel filters by status (All: the open threads, then the collapsible Resolved
// section; Open; Resolved), by tab (All tabs; This tab) and by a search over the messages, the quotes and the authors'
// names. Each card's reply draft is the editor's (DocumentEditor holds one per thread, the margin draws the same), so a
// filter hiding the card or the panel closing loses none. J and K move the focus between the cards.
// WR 49: deleted-target conversations are hidden in every status filter until explicitly revealed.
import { useEffect, useId, useRef, useState } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { ThreadCard } from '../../../comments/ThreadCard';
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
  /** The store is read-only: threads are listed and shown, not replied to, resolved or reopened. */
  readOnly?: boolean;
  /** The threads' reply drafts, the editor's: the panel closing loses none, and the margin draws the same (X36). */
  drafts: ReadonlyMap<string, string>;
  onDraftChange(threadId: string, text: string): void;
  onShow(thread: ThreadState): void;
  onClose(): void;
}

type StatusFilter = 'all' | 'open' | 'resolved';
type ScopeFilter = 'all' | 'tab';
const STATUS: [StatusFilter, string][] = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['all', 'All'],
];
const SCOPE: [ScopeFilter, string][] = [
  ['tab', 'This tab'],
  ['all', 'All tabs'],
];

// A thread matches a search when any message's body, its quote, or the name of anyone who wrote in it holds the text.
function matches(thread: ThreadState, needle: string): boolean {
  if (needle === '') return true;
  const has = (text: string) => text.toLowerCase().includes(needle);
  return has(thread.quote) || has(actorDisplay(thread.createdBy).name) || thread.messages.some((message) => has(message.body) || has(actorDisplay(message.by).name));
}

export function CommentsPanel({ doc, tabs, activeTab, activeThread, author, readOnly = false, drafts, onDraftChange, onShow, onClose }: Props) {
  const threads = useThreadStates(doc);
  const [showResolved, setShowResolved] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const name = useId();

  const needle = query.trim().toLowerCase();
  // WR 49: a resolved thread can also have a missing target, so filter by liveness, not just `orphan`.
  const shown = threads.filter((thread) => (showDeleted || thread.live) && (scope === 'all' || thread.tabId === activeTab) && matches(thread, needle));
  const open = status === 'resolved' ? [] : shown.filter((thread) => thread.status === 'open');
  const resolved = status === 'open' ? [] : shown.filter((thread) => thread.status === 'resolved');
  const listed = [...open, ...(status === 'all' && !showResolved ? [] : resolved)];

  // the editor's active thread, scrolled into view when it changes (and when the panel opens on one)
  useEffect(() => {
    if (activeThread === null) return;
    body.current?.querySelector(`[data-thread="${CSS.escape(activeThread)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeThread]);

  const focusCard = (threadId: string) => body.current?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(threadId)}"]`)?.focus();
  const tabTitle = (thread: ThreadState) => (thread.tabId === activeTab ? null : (tabs.find((tab) => tab.id === thread.tabId)?.title ?? null));
  const card = (thread: ThreadState) => {
    const at = listed.indexOf(thread);
    const next = listed[at + 1];
    const previous = listed[at - 1];
    return (
      <ThreadCard
        key={thread.id}
        thread={thread}
        active={thread.id === activeThread}
        compact={false}
        showQuote
        tabTitle={tabTitle(thread)}
        readOnly={readOnly}
        position={{ index: at + 1, count: listed.length }}
        draft={drafts.get(thread.id) ?? ''}
        onDraftChange={(text) => onDraftChange(thread.id, text)}
        onActivate={() => onShow(thread)}
        onReply={(text) => !readOnly && reply(doc, thread.id, { id: `${thread.id}:${nanoid8()}`, by: author.actor, at: author.now(), body: text }, COMMENTS_ORIGIN)}
        onResolve={() => !readOnly && resolve(doc, thread.id, author.actor, author.now(), COMMENTS_ORIGIN)}
        onReopen={() => !readOnly && reopen(doc, thread.id, author.actor, author.now(), COMMENTS_ORIGIN)}
        {...(next && { onNext: () => focusCard(next.id) })}
        {...(previous && { onPrevious: () => focusCard(previous.id) })}
      />
    );
  };
  // nothing to list: under All, a search that only resolved threads match lists those without a note
  const empty = status === 'resolved' ? resolved.length === 0 : open.length === 0 && (needle === '' || resolved.length === 0);
  const emptyText = needle !== '' ? 'No comments match the search.' : status === 'resolved' ? 'No resolved comments.' : 'No open comments. Select text and choose Comment.';

  return (
    <aside className="doc-rail" aria-label="Comments">
      <header className="doc-rail-header">
        <h2 className="doc-rail-title">All comments</h2>
        <button type="button" className="doc-tool" aria-label="Close comments" title="Close comments" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="doc-rail-filters">
        <Segments<StatusFilter> name={`${name}-status`} label="Status" options={STATUS} value={status} onChange={setStatus} />
        <Segments<ScopeFilter> name={`${name}-scope`} label="Scope" options={SCOPE} value={scope} onChange={setScope} />
        <input type="search" className="doc-rail-search" aria-label="Search comments" placeholder="Search comments" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div ref={body} className="doc-rail-body">
        {threads.some((thread) => !thread.live) && (
          <button type="button" className="doc-rail-section" aria-pressed={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>
            {showDeleted ? 'Hide deleted-target comments' : 'Show deleted-target comments'}
          </button>
        )}
        {empty && <p className="doc-rail-empty">{emptyText}</p>}
        {open.map(card)}
        {status === 'resolved' && resolved.map(card)}
        {status === 'all' && resolved.length > 0 && (
          <section className="doc-rail-resolved" aria-label={`Resolved (${resolved.length})`}>
            <button type="button" className="doc-rail-section" aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>
              Resolved ({resolved.length})
            </button>
            {showResolved && resolved.map(card)}
          </section>
        )}
      </div>
    </aside>
  );
}

// A segmented control: one choice of a few, as radio buttons (arrow keys move between them).
function Segments<T extends string>({ name, label, options, value, onChange }: { name: string; label: string; options: [T, string][]; value: T; onChange(value: T): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="doc-rail-segments">
      {options.map(([option, text]) => (
        <label key={option} className="doc-rail-segment">
          <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
          {text}
        </label>
      ))}
    </div>
  );
}
