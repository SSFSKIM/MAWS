// One session in an expanded project (§5.1 as amended 2026-10-01, W5, D2 and W11, I4; Codex's and Claude Desktop's 30px
// rows): one line of 13px text, the status glyph, the title, a worktree session's ⎇ branch (Codex marks those rows with
// an environment icon; MAWS names the branch, the flat list having no worktree groups), a pin mark when pinned, the
// unread dot and the age, with pin and archive taking the age's place on hover and on keyboard focus. Everything else
// (the worktree's folder, holder or activity, the last answer, the pending request, context) is in the hover card. A
// click shows it in place of the focused pane's session, ⌘-click or a middle-click in a new tab (I2); dragging carries
// its id to a tab strip (`application/x-maws-session`, residue *Tab strip*). A foreign-live session shows no actions
// (D-12). E3: a side thread or fork drawn under its parent is indented a step and marked `↳`.
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
import { lineageCaption, rowBranch, sessionAge } from './derive';
import { SessionHoverCard } from './HoverCard';
import { ReleasedMark } from '../budget/ReleasedMark'; // C12
import { sessionNodeId, useTree } from './tree';
import { displayTitle } from '../sessions/title';

export const SESSION_DRAG_TYPE = 'application/x-maws-session';

export function SessionRow({ record, level }: { record: SessionRecord; level: number }) {
  const id = record.appId;
  const digest = useSessions((s) => s.digests.get(id));
  // E3 start: a side thread or fork nested under its parent (level 3 and deeper, its real depth for assistive tech) is
  // indented one step whatever its depth, marked `↳` and captioned by its anchor's label; one listed as a root says
  // whose it is (the parent's title when the store holds it)
  const nested = level >= 3;
  const parentTitle = useSessions((s) => {
    const parent = record.lineage === null ? undefined : s.records.get(record.lineage.parentAppSessionId);
    return parent === undefined ? null : displayTitle(parent);
  });
  const caption = lineageCaption(record, nested, parentTitle);
  // E3 end
  const pending = useAttention((s) => selectPendingOf(s, id));
  const now = useNow();
  const tree = useTree();
  const nodeId = sessionNodeId(id);
  const glyph = glyphFor(record, digest ?? null, pending);
  const selected = tree.selected === id;
  const title = displayTitle(record);
  const branch = rowBranch(record); // W9 (H2): a branch the record does not name is left out, never guessed as "detached"
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
        onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)} // the card's shell guards a pointer's focus
        // I2: a click replaces the focused pane's session; ⌘-click and a middle-click open a tab of its own (Chrome's rule)
        onClick={(event) => useLayout.getState().openSession(id, event.metaKey ? { how: 'tab' } : {})}
        onAuxClick={(event) => event.button === 1 && useLayout.getState().openSession(id, { how: 'tab' })}
        className={`group/session relative flex h-(--row-h) cursor-default items-center gap-[7px] rounded-sm ${nested ? 'pr-[9px] pl-[30px]' : 'px-[9px]'} outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? 'bg-bg-active' : ''}`}
      >
        <GlyphMark glyph={glyph} className="w-[14px] shrink-0" />
        {/* E3 */}
        {nested && (
          <span aria-hidden data-testid="row-nested" className="-mr-[3px] shrink-0 text-ui text-fg">
            ↳
          </span>
        )}
        <span className={`min-w-0 flex-1 truncate text-ui text-fg ${hoverActions.length > 0 ? 'group-hover/session:pr-7 group-focus-visible/session:pr-7' : ''}`}>{title}</span>
        {/* E3: the lineage caption takes the branch's place; a nested side thread shares its parent's branch */}
        {caption !== null && (
          <span data-testid="row-lineage" title={caption} className={`max-w-[45%] shrink-0 truncate text-ui-sm text-fg-muted ${yields}`}>
            {caption}
          </span>
        )}
        {branch !== null && caption === null && !(nested && record.lineage?.kind === 'side-thread') && (
          <span data-testid="row-branch" title={record.worktree?.path} className={`max-w-[40%] shrink-0 truncate text-ui-sm text-fg-faint ${yields}`}>
            ⎇ {branch}
          </span>
        )}
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
