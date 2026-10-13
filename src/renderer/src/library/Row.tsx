// One artifact in the library (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 14): its kind's tile,
// its title (pinned marked), a line of facts (the kind, its Space as a chip that shows that Space, its project, "Edited
// <ago> by <You | the session's title | Claude>", and under a search the passage that matched), and the sessions that
// touched it as chips, up to three by last touch, "+N" for the rest, each opening its session beside the library with
// its roles in the tooltip; then the row's menu. The whole row opens the artifact in a main tab of its own; its own
// controls keep their clicks. One tab stop for the list (the caller's roving `current`); the caller moves the keyboard.
import type { KeyboardEvent, MouseEvent } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import type { LibraryRow, LibrarySession } from '@shared/ipc/schema/library';
import { formatAgo } from '../app/date-format';
import { PinIcon } from '../app/IconButton';
import { useNow } from '../app/use-now';
import { useLayout } from '../stores/layout';
import { openArtifactTab } from './actions';
import { KIND_LABELS, ROW_COPY } from './copy';
import { KindIcon } from './icons';
import { RowContextMenu, RowMenu } from './RowMenu';
import { showSpace } from './view';

const SHOWN_SESSIONS = 3;
const CHIP = 'inline-flex h-5 max-w-40 min-w-0 shrink-0 items-center rounded-sm border border-border px-1.5 text-ui-sm text-fg-muted';

const onControl = (event: MouseEvent<HTMLElement>) =>
  event.target !== event.currentTarget && (event.target as HTMLElement).closest('button, a, input, [role="menuitem"], [role="menu"]') !== null;

export interface RowProps {
  row: LibraryRow;
  stop: boolean; // the list's one tab stop
  menuOpen: boolean;
  onMenuOpen(open: boolean): void;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

const sessionName = (session: LibrarySession) => session.title.trim() || ROW_COPY.untitledSession;

function SessionChip({ session, now, tabIndex }: { session: LibrarySession; now: number; tabIndex: number }) {
  const roles = session.roles.map((role) => ROW_COPY.roles[role]).join(', ');
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      title={ROW_COPY.sessionTitle(sessionName(session), roles, formatAgo(Math.max(0, now - session.lastAt)))}
      onClick={() => useLayout.getState().openSession(session.appSessionId, { how: 'tab' })}
      className={`${CHIP} outline-accent hover:border-border-strong hover:bg-bg-hover hover:text-fg focus-visible:outline-2`}
    >
      <span className="truncate">{sessionName(session)}</span>
    </button>
  );
}

function Sessions({ sessions, now, tabIndex }: { sessions: LibrarySession[]; now: number; tabIndex: number }) {
  const rest = sessions.slice(SHOWN_SESSIONS);
  return (
    <span data-part="sessions" className="flex min-w-0 flex-wrap items-center gap-1 @2xl:flex-nowrap @2xl:justify-end">
      {sessions.slice(0, SHOWN_SESSIONS).map((session) => (
        <SessionChip key={session.appSessionId} session={session} now={now} tabIndex={tabIndex} />
      ))}
      {rest.length > 0 && (
        <span title={ROW_COPY.moreTitle(rest.map(sessionName))} className="shrink-0 px-1 text-ui-sm text-fg-muted tabular-nums">
          {ROW_COPY.more(rest.length)}
        </span>
      )}
    </span>
  );
}

const Dot = () => (
  <span aria-hidden className="text-fg-faint">
    ·
  </span>
);

export function Row({ row, stop, menuOpen, onMenuOpen, onFocus, onKeyDown }: RowProps) {
  const now = useNow();
  const editor = row.lastEditor;
  const editorTitle = editor.kind === 'session' ? row.sessions.find((s) => s.appSessionId === editor.appSessionId)?.title : undefined;
  const by = actorDisplay(editor, editorTitle).name;
  const tabIndex = stop ? 0 : -1; // the row's own controls are reachable by Tab from the list's stop row only
  return (
    <RowContextMenu row={row}>
      <article
        aria-label={row.title}
        tabIndex={tabIndex}
        data-artifact-row={row.id}
        data-kind={row.kind}
        onFocus={(event) => event.target === event.currentTarget && onFocus()}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (onControl(event)) return;
          openArtifactTab(row.id);
        }}
        className="group grid cursor-default grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-2 outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 @2xl:grid-cols-[2rem_minmax(0,1fr)_auto_auto]"
      >
        <span aria-hidden className="row-span-2 flex size-8 items-center justify-center self-start rounded-md border border-border bg-bg-raised text-fg-muted">
          <KindIcon kind={row.kind} />
        </span>
        <span className="col-start-2 flex min-w-0 items-center gap-1.5">
          <span data-part="title" className="truncate text-ui font-medium text-fg">
            {row.title}
          </span>
          {row.pinned && (
            <span role="img" aria-label={ROW_COPY.pinned} title={ROW_COPY.pinned} className="shrink-0 text-fg-faint">
              <PinIcon className="size-3.5" />
            </span>
          )}
        </span>
        <span data-part="facts" className="col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
          <span className="shrink-0">{KIND_LABELS[row.kind]}</span>
          {row.space && (
            <>
              <Dot />
              <button
                type="button"
                tabIndex={tabIndex}
                onClick={() => showSpace(row.space!.id)}
                className="inline-flex h-5 max-w-36 shrink-0 items-center rounded-sm bg-bg-active px-1.5 text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2"
              >
                <span className="truncate">{row.space.name}</span>
              </button>
            </>
          )}
          {row.project && (
            <>
              <Dot />
              <span className="max-w-40 shrink-0 truncate">{row.project.name}</span>
            </>
          )}
          <Dot />
          <span className="truncate">{ROW_COPY.edited(formatAgo(Math.max(0, now - row.lastEditedAt)), by)}</span>
        </span>
        {row.snippet && (
          <span data-part="snippet" className="col-start-2 row-start-3 truncate text-ui-sm text-fg-faint">
            {row.snippet}
          </span>
        )}
        {row.sessions.length > 0 && (
          <span className="col-start-2 min-w-0 pt-1 @2xl:col-start-3 @2xl:row-span-2 @2xl:row-start-1 @2xl:pt-0">
            <Sessions sessions={row.sessions} now={now} tabIndex={tabIndex} />
          </span>
        )}
        <span className="col-start-3 row-span-2 row-start-1 flex self-center @2xl:col-start-4">
          <RowMenu row={row} open={menuOpen} onOpenChange={onMenuOpen} tabIndex={tabIndex} />
        </span>
      </article>
    </RowContextMenu>
  );
}
