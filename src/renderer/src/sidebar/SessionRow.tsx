// One session in the sidebar tree (§5.1; mockup 01 `.session`): status glyph, title (with a worktree session's branch
// chip), secondary line, age and unread dot, with pin and archive revealed on hover and on focus. A click opens its tab; dragging carries its id to a tab strip
// (`application/x-maws-session`, residue *Tab strip*). A foreign-live session shows its holder and no actions (D-12).
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { ArchiveIcon, PinIcon } from '../app/IconButton';
import { runSessionAction, sessionActionsFor, useSessionActionEnabled } from '../app/session-actions';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { rowBranch, secondaryLine, sessionAge } from './derive';
import { ReleasedMark } from '../budget/ReleasedMark'; // C12
import { sessionNodeId, useTree } from './tree';

export const SESSION_DRAG_TYPE = 'application/x-maws-session';

export function SessionRow({ record, level }: { record: SessionRecord; level: 1 | 2 }) {
  const id = record.appId;
  const digest = useSessions((s) => s.digests.get(id));
  const pending = useAttention((s) => selectPendingOf(s, id));
  const now = useNow();
  const tree = useTree();
  const nodeId = sessionNodeId(id);
  const glyph = glyphFor(record, digest ?? null, pending);
  const secondary = secondaryLine(record, digest, pending);
  const selected = tree.selected === id;
  const title = record.title.text;
  const branch = rowBranch(record);
  const offered = sessionActionsFor(record);
  const hoverActions = HOVER_ACTIONS.filter((action) => offered.includes(action));

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-label={title}
      tabIndex={tree.tabStop === nodeId ? 0 : -1}
      data-tree-id={nodeId}
      data-kind="session"
      data-menu={`session:${id}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SESSION_DRAG_TYPE, id);
        event.dataTransfer.effectAllowed = 'copyMove';
      }}
      onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)}
      onClick={() => useLayout.getState().openSession(id)}
      className={`group/session relative grid min-h-[47px] cursor-default grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-[7px] rounded-sm px-[9px] py-[7px] outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? 'bg-bg-active' : ''}`}
    >
      <GlyphMark glyph={glyph} className="leading-[17px]" />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-[5px] group-hover/session:pr-12 group-focus-within/session:pr-12">
          <span className="truncate text-ui-sm leading-[17px] text-fg">{title}</span>
          {branch && (
            <span
              title={`Branch ${branch}`}
              data-testid="session-row-branch"
              className="max-w-[55%] shrink-0 truncate rounded-sm border border-border px-1 text-ui-sm leading-[15px] text-fg-muted"
            >
              ⎇ {branch}
            </span>
          )}
          <ReleasedMark released={digest?.released} /> {/* C12: the memory budget's released mark */}
        </span>
        {secondary && (
          <span className="mt-[3px] truncate text-ui-sm leading-[15px] text-fg-muted group-hover/session:text-fg">{secondary}</span>
        )}
      </span>
      <span className="flex flex-col items-end text-ui-sm leading-[17px] text-fg-muted tabular-nums">
        {sessionAge(record, digest, now)}
        {record.unread && <span aria-label="Unread" role="img" className="mt-1.5 block size-[5px] rounded-full bg-info" />}
      </span>
      {hoverActions.length > 0 && <RowActions actions={hoverActions} appSessionId={id} title={title} pinned={record.pinned} />}
    </div>
  );
}

type HoverAction = 'pin' | 'archive';
const HOVER_ACTIONS: HoverAction[] = ['pin', 'archive'];

// Pin and archive (§5.1 hover actions), those of them the session's menus offer (`sessionActionsFor`): out of the tab
// order, since the row is the tree's stop and its context menu carries the same actions for the keyboard.
function RowActions({ actions, appSessionId, title, pinned }: { actions: HoverAction[]; appSessionId: AppSessionId; title: string; pinned: boolean }) {
  const canPin = useSessionActionEnabled('pin');
  const canArchive = useSessionActionEnabled('archive');
  const button =
    'inline-flex size-[23px] items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent';
  return (
    <span className="absolute top-1 right-[7px] hidden rounded-sm bg-bg-overlay group-hover/session:flex group-focus-within/session:flex">
      {actions.includes('pin') && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
          title={canPin ? (pinned ? 'Unpin' : 'Pin') : 'Arrives with C10'}
          disabled={!canPin}
          onClick={(event) => {
            event.stopPropagation();
            runSessionAction('pin', appSessionId);
          }}
          className={button}
        >
          <PinIcon className="size-[13px]" />
        </button>
      )}
      {actions.includes('archive') && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Archive ${title}`}
          title={canArchive ? 'Archive' : 'Arrives with C10'}
          disabled={!canArchive}
          onClick={(event) => {
            event.stopPropagation();
            runSessionAction('archive', appSessionId);
          }}
          className={button}
        >
          <ArchiveIcon className="size-[13px]" />
        </button>
      )}
    </span>
  );
}
