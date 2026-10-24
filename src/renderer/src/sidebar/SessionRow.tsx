// UX1 D7: titles own the row; worktree at left, status and age at right, detail in the hover card.
import type { SessionRecord } from '@shared/graph/session';
import { PinIcon } from '../app/IconButton';
import { sessionActionsFor } from '../app/session-actions';
import { SessionOverflow } from './menus';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { selectEndedWithErrorOf, selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { lineageCaption, sessionAge } from './derive';
import { SessionHoverCard } from './HoverCard';
import { ReleasedMark } from '../budget/ReleasedMark'; // C12
import { sessionNodeId, useTree } from './tree';
import { setSessionUnread } from '../keymap/session-navigation';
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
  const ended = useAttention((s) => selectEndedWithErrorOf(s, id)); // E11 F2b
  const glyph = glyphFor(record, digest ?? null, pending, ended, now);
  const selected = tree.selected === id;
  const title = displayTitle(record);
  const hasActions = sessionActionsFor(record).includes('rename');

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
        className={`group/session relative flex h-(--row-h) cursor-default items-center gap-[5px] rounded-sm ${nested ? 'pr-[7px] pl-[30px]' : 'px-[7px]'} outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? 'bg-bg-active' : ''}`}
      >
        {record.worktree !== null && <span data-testid="row-branch" role="img" aria-label="Worktree" className="shrink-0 text-ui-sm text-fg-faint">⎇</span>}
        {/* E3 */}
        {nested && (
          <span aria-hidden data-testid="row-nested" className="-mr-[3px] shrink-0 text-ui text-fg">
            ↳
          </span>
        )}
        <span data-session-title className="min-w-0 flex-1 truncate text-ui text-fg">{title}</span>
        {/* E3: the lineage caption takes the branch's place; a nested side thread shares its parent's branch */}
        {caption !== null && (
          <span data-testid="row-lineage" title={caption} className={`max-w-[45%] shrink-0 truncate text-ui-sm text-fg-muted`}>
            {caption}
          </span>
        )}
        {/* C12: the memory budget's released mark */}
        <ReleasedMark released={digest?.released} />
        {record.pinned && (
          <span role="img" aria-label="Pinned" className={`shrink-0 text-fg-faint`}>
            <PinIcon className="size-[11px]" />
          </span>
        )}
        <GlyphMark glyph={glyph} className="w-[12px] shrink-0" />
        {/* Approved mockup: overflow replaces age in one fixed slot, never the title or unread target. */}
        <span className="relative flex h-[22px] w-[26px] shrink-0 items-center justify-end [&:has([data-state=open])>[data-session-age]]:invisible">
          <span data-session-age className={`text-ui-sm text-fg-muted tabular-nums ${hasActions ? 'group-hover/session:invisible group-focus-within/session:invisible' : ''}`}>{sessionAge(record, digest, now)}</span>
          {hasActions && <span className="absolute inset-0 flex items-center justify-end"><SessionOverflow appSessionId={id} title={title} /></span>}
        </span>
        <button type="button" tabIndex={-1} aria-label={record.unread ? 'Mark read' : 'Mark unread'}
          onClick={(event) => { event.stopPropagation(); void setSessionUnread(id, !record.unread); }}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm outline-accent focus-visible:outline-2">
          <span role={record.unread ? 'img' : undefined} aria-label={record.unread ? 'Unread' : undefined} aria-hidden={!record.unread}
            className={`size-[5px] rounded-full ${record.unread ? 'bg-info' : 'bg-fg-faint opacity-0 group-hover/session:opacity-100'}`} />
        </button>
      </div>
    </SessionHoverCard>
  );
}
