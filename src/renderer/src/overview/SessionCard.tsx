// One Overview card (§5.2; residue *Overview card*): the title row (glyph, title, the project when the card sits in
// the Needs-you group, the branch, an unread dot), the activity line, the last answer on its own line, the pending
// request through the X4 slot (`placement: 'card'`), and the footer (context, cost since seen, running agents). A
// click opens the session, a ⌘-click opens it in the split. A foreign-live card shows its holder and holds no control
// but itself (D-12); P5 O9 M6: unless MAWS drives it through its bridge (it has a controls port), when its request is
// answered from the card as any session's.
// P5 O7 M6 (M6c fix wave 1): another machine's session with no record (no tab was opened) waiting in Needs you is carded
// from what the page has, its listing and its item: the glyph, the title, its machine in the project's place, what it
// waits for and the item's summary; no branch, digest or footer. A click opens it through its lane's opener (M2's pane).
import { useEffect, type KeyboardEvent, type MouseEvent } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { useSlot } from '../app/slots';
import { GlyphMark } from '../attention/GlyphMark';
import { waitingItem } from '../attention/derive';
import { glyphFor, listedGlyph } from '../attention/glyph'; // P5 O7 M6: listedGlyph
import { ipc } from '../ipc/client';
import { useSessionControls } from '../session/controls/controls-for'; // P5 O9 M6
import { branchLabel, recordBranch } from '../sessions/branch-label';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions, type ListedSession } from '../stores/sessions'; // P5 O7 M6: ListedSession
import { cardActivity, cardFooter } from './derive';
import { ReleasedMark } from '../budget/ReleasedMark'; // C12
import { displayTitle, listedTitle } from '../sessions/title';
import { previewLine } from '@shared/owner/preview'; // P5 O7 M6
import { isActionable } from '@shared/attention/kinds'; // P5 O7 M6
import { useMachineMark } from '../app/machine-mark'; // P5 O7 M6
import { openListed } from '../sessions/remote-openers'; // P5 O7 M6

type PaneIndex = 0 | 1;

export interface SessionCardProps {
  appSessionId: AppSessionId;
  paneIndex: PaneIndex;
  showProject: boolean;
  stop: boolean; // the board's one tab stop
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

// A click that lands on a control inside the card (the request slot's buttons) belongs to that control.
const onControl = (event: MouseEvent<HTMLElement>) =>
  (event.target as HTMLElement).closest('button, a, input, textarea, select, [role="button"]') !== null && event.target !== event.currentTarget;

export function SessionCard({ appSessionId, paneIndex, showProject, stop, onFocus, onKeyDown }: SessionCardProps) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const digest = useSessions((s) => s.digests.get(appSessionId) ?? null);
  const project = useSessions((s) => (record?.projectId ? (s.projects.get(record.projectId)?.name ?? null) : null));
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  const controlled = useSessionControls(appSessionId) !== null; // P5 O9 M6: none for a session held elsewhere with no live bridge
  const listed = useSessions((s) => (record === undefined ? s.listed.get(appSessionId) : undefined)); // P5 O7 M6
  if (!record) return listed ? <ListedCard listed={listed} showProject={showProject} stop={stop} onFocus={onFocus} onKeyDown={onKeyDown} /> : null;

  const waiting = waitingItem(pending);
  const request = controlled && waiting?.tier === 1 ? waiting.oldest : null;
  const title = displayTitle(record);
  const branch = branchLabel(recordBranch(record)); // W9 (H2)
  const footer = cardFooter(digest);

  return (
    <article
      aria-label={title}
      tabIndex={stop ? 0 : -1}
      data-card={appSessionId}
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (onControl(event)) return;
        useLayout.getState().openSession(appSessionId, { split: event.metaKey });
      }}
      className="flex min-w-0 cursor-default flex-col gap-1.5 rounded-md border border-border bg-bg-raised p-3 outline-accent hover:border-border-strong focus-visible:outline-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <GlyphMark glyph={glyphFor(record, digest, pending)} className="shrink-0" />
        <span className="truncate font-medium text-fg">{title}</span>
        {showProject && project && <span className="shrink-0 text-ui-sm text-fg-muted">{project}</span>}
        {branch && <span className="shrink-0 rounded-sm border border-border px-1.5 text-ui-sm text-fg-muted">⎇ {branch}</span>}
        <ReleasedMark released={digest?.released} /> {/* C12: the memory budget's released mark */}
        {record.unread && <span role="img" aria-label="Unread" className="ml-auto block size-[5px] shrink-0 rounded-full bg-info" />}
      </div>
      <p data-testid="card-activity" className="m-0 truncate text-ui-sm text-fg">
        {cardActivity(record, digest, pending)}
      </p>
      {digest?.lastAssistantLine && (
        <p data-testid="card-answer" className="m-0 truncate text-ui-sm text-fg-muted">
          {digest.lastAssistantLine}
        </p>
      )}
      {request && <CardRequest item={request} paneIndex={paneIndex} />}
      {footer.length > 0 && (
        <p className="m-0 flex flex-wrap gap-x-1.5 text-ui-sm text-fg-muted tabular-nums">
          {footer.map((part, i) => (
            <span key={part} className="flex gap-x-1.5">
              {i > 0 && <span aria-hidden>·</span>}
              <span>{part}</span>
            </span>
          ))}
        </p>
      )}
    </article>
  );
}

// P5 O7 M6: a listed session's card (the comment at the top).
function ListedCard({ listed, showProject, stop, onFocus, onKeyDown }: Omit<SessionCardProps, 'appSessionId' | 'paneIndex'> & { listed: ListedSession }) {
  const appSessionId = listed.appId;
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  const machine = useMachineMark(appSessionId);
  const glyph = listedGlyph(listed.state, pending);
  const waiting = waitingItem(pending);
  const activity = waiting !== null && isActionable(waiting.oldest) && waiting.oldest.kind === 'permission' ? 'Waiting for approval' : glyph.label;
  const summary = waiting === null || waiting.oldest.summary === '' ? null : (previewLine(waiting.oldest.summary, 200) ?? waiting.oldest.summary);
  const title = listedTitle(listed);
  return (
    <article
      aria-label={title}
      tabIndex={stop ? 0 : -1}
      data-card={appSessionId}
      data-listed-card
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (onControl(event)) return;
        if (event.metaKey || !openListed(appSessionId)) useLayout.getState().openSession(appSessionId, { split: event.metaKey });
      }}
      className="flex min-w-0 cursor-default flex-col gap-1.5 rounded-md border border-border bg-bg-raised p-3 outline-accent hover:border-border-strong focus-visible:outline-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <GlyphMark glyph={glyph} className="shrink-0" />
        <span className="truncate font-medium text-fg">{title}</span>
        {showProject && <span className="shrink-0 text-ui-sm text-fg-muted">{machine.name}</span>}
      </div>
      <p data-testid="card-activity" className="m-0 truncate text-ui-sm text-fg">
        {activity}
      </p>
      {summary && (
        <p data-testid="card-summary" className="m-0 truncate text-ui-sm text-fg-muted">
          {summary}
        </p>
      )}
    </article>
  );
}

function CardRequest({ item, paneIndex }: { item: AttentionItem; paneIndex: PaneIndex }) {
  const Card = useSlot('requestCard');
  const request = useAttention((s) => s.requests.get(item.id) ?? null);
  useEffect(() => void useAttention.getState().loadRequest(ipc, item), [item]);
  return (
    <div className="mt-1 rounded-sm border border-border bg-bg p-2.5">
      {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
      <Card item={item} request={request} placement="card" paneIndex={paneIndex} />
    </div>
  );
}
