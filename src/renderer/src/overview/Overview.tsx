// The Overview board (§5.2; residue *Overview card*): one card per live or unread session, grouped Needs you first,
// then the projects in sidebar order, then other sessions (`overviewGroups`). A scrolling `role="list"` of groups; the
// cards share one tab stop and the arrow keys move focus across them in reading order (Home and End to the ends),
// Enter opens the focused card's session and ⌘Enter opens it in the split. A sidebar Needs-you row deep-links here
// through `focusCard`, which reveals and focuses that card once.
// Debt wave 5 (the cold first paint): while the engine host's discovery pass reads the store (a cold index, the owner's
// first open), the board renders the cards it has and says above them, or in place of the empty board, that indexing
// continues and how far it has come.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { selectProjectOrder, useSessions } from '../stores/sessions';
import { CardGroup } from './CardGroup';
import { overviewGroups } from './derive';

type PaneIndex = 0 | 1;

const NEXT = new Set(['ArrowDown', 'ArrowRight']);
const PREVIOUS = new Set(['ArrowUp', 'ArrowLeft']);

export function Overview({ paneIndex }: { paneIndex: PaneIndex }) {
  const sessions = useSessions(
    useShallow((s) => ({ loaded: s.loaded, records: s.records, recordsVersion: s.recordsVersion, digests: s.digests, projects: selectProjectOrder(s), indexing: s.indexing })),
  );
  const attention = useAttention(useShallow((a) => ({ loaded: a.loaded, bySession: a.bySession, version: a.version })));
  const rows = selectNeedsYou(attention, sessions);
  const groups = overviewGroups({ records: sessions.records, digests: sessions.digests, projects: sessions.projects, rows });
  const order = groups.flatMap((g) => g.sessions);

  const board = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<AppSessionId | null>(null);
  const stop = current !== null && order.includes(current) ? current : (order[0] ?? null);

  // A deep link from the sidebar: reveal and focus the card, then forget the request.
  const focusRequest = useLayout((s) => s.focusedCardAppId);
  useEffect(() => {
    if (!focusRequest) return;
    const card = board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(focusRequest)}"]`);
    if (!card) return;
    card.scrollIntoView?.({ block: 'nearest' });
    card.focus();
    useLayout.getState().focusCard(null);
  }, [focusRequest, order.length]);

  const focusCard = (index: number) => board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(order[index])}"]`)?.focus();

  const onCardKeyDown = (appSessionId: AppSessionId) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.defaultPrevented) return;
    const at = order.indexOf(appSessionId);
    if (NEXT.has(event.key)) focusCard(Math.min(at + 1, order.length - 1));
    else if (PREVIOUS.has(event.key)) focusCard(Math.max(at - 1, 0));
    else if (event.key === 'Home') focusCard(0);
    else if (event.key === 'End') focusCard(order.length - 1);
    else if (event.key === 'Enter') useLayout.getState().openSession(appSessionId, { split: event.metaKey });
    else return;
    event.preventDefault();
  };

  if (!sessions.loaded || !attention.loaded) return null;
  if (groups.length === 0) return <EmptyBoard indexing={sessions.indexing} />;

  const list = (
    <div ref={board} role="list" aria-label="Overview" className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-6 py-5">
      {groups.map((group) => (
        <CardGroup
          key={group.id}
          group={group}
          count={group.id === 'needs-you' ? group.sessions.length : null}
          paneIndex={paneIndex}
          stop={stop}
          onCardFocus={setCurrent}
          onCardKeyDown={onCardKeyDown}
        />
      ))}
    </div>
  );
  return (
    <div className="flex h-full flex-col">
      {sessions.indexing && <IndexingNote indexing={sessions.indexing} className="px-6 pt-4" />}
      {list}
    </div>
  );
}

const count = new Intl.NumberFormat('en-US');

function IndexingNote({ indexing, className = '' }: { indexing: { scanned: number; total: number }; className?: string }) {
  return (
    <p role="status" className={`m-0 text-ui-sm text-fg-muted ${className}`}>
      Indexing sessions · {count.format(indexing.scanned)} of {count.format(indexing.total)}
    </p>
  );
}

function EmptyBoard({ indexing }: { indexing: { scanned: number; total: number } | null }) {
  const canCreate = useSessionCreatorRegistered();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ui text-fg-muted">
      {indexing ? <IndexingNote indexing={indexing} /> : <p className="m-0">Nothing live or unread</p>}
      <button
        type="button"
        disabled={!canCreate}
        title={canCreate ? undefined : 'Not available here'}
        onClick={() => void createSession(null)}
        className="rounded-sm border border-border-strong px-2.5 py-1 text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
      >
        New session
      </button>
    </div>
  );
}
