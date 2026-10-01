// One session on a project's page (§5.1 as amended 2026-10-01, W5, D2; Codex's and Claude Desktop's 30px rows): one
// line of 13px text, the status glyph, the title, a pin mark when pinned, the unread dot and the age, with pin and
// archive taking the age's place on hover and on keyboard focus. Everything else (branch and worktree, holder or activity, the
// last answer, the pending request, context) is in the hover card. A click opens its tab; dragging carries its id to a
// tab strip (`application/x-maws-session`, residue *Tab strip*). A foreign-live session shows no actions (D-12).
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
import { sessionAge } from './derive';
import { SessionHoverCard } from './HoverCard';
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
  const selected = tree.selected === id;
  const title = record.title.text;
  const offered = sessionActionsFor(record);
  const hoverActions = HOVER_ACTIONS.filter((action) => offered.includes(action));
  // While the actions show, the age and the dot give them the row's end.
  const yields = hoverActions.length > 0 ? 'group-hover/session:invisible group-focus-visible/session:invisible' : '';

  return (
    <SessionHoverCard record={record}>
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
        onFocus={(event) => {
          if (event.target === event.currentTarget) tree.onFocusItem(nodeId);
          // The hover card opens on keyboard focus only: a page opened with the pointer focuses its first row, and a
          // card for it would cover the main area unasked. Radix skips its open for a prevented focus event.
          if (!focusVisible(event.currentTarget)) event.preventDefault();
        }}
        onClick={() => useLayout.getState().openSession(id)}
        className={`group/session relative flex h-(--row-h) cursor-default items-center gap-[7px] rounded-sm px-[9px] outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? 'bg-bg-active' : ''}`}
      >
        <GlyphMark glyph={glyph} className="w-[14px] shrink-0" />
        <span className={`min-w-0 flex-1 truncate text-ui text-fg ${hoverActions.length > 0 ? 'group-hover/session:pr-7 group-focus-visible/session:pr-7' : ''}`}>{title}</span>
        {/* C12: the memory budget's released mark */}
        <ReleasedMark released={digest?.released} />
        {record.pinned && (
          <span role="img" aria-label="Pinned" className={`shrink-0 text-fg-faint ${yields}`}>
            <PinIcon className="size-[11px]" />
          </span>
        )}
        {record.unread && <span aria-label="Unread" role="img" className={`block size-[5px] shrink-0 rounded-full bg-info ${yields}`} />}
        <span className={`shrink-0 text-ui-sm text-fg-muted tabular-nums ${yields}`}>{sessionAge(record, digest, now)}</span>
        {hoverActions.length > 0 && <RowActions actions={hoverActions} appSessionId={id} title={title} pinned={record.pinned} />}
      </div>
    </SessionHoverCard>
  );
}

// `:focus-visible`, where the engine knows it (happy-dom does not: there every focus counts as the keyboard's).
function focusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
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
    <span className="absolute top-1/2 right-[5px] hidden -translate-y-1/2 rounded-sm bg-bg-overlay group-hover/session:flex group-focus-visible/session:flex">
      {actions.includes('pin') && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
          title={canPin ? (pinned ? 'Unpin' : 'Pin') : 'Not available here'}
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
          title={canArchive ? 'Archive' : 'Not available here'}
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
