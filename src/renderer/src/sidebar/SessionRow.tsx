// UX1 D7: titles own the row; worktree at left, status and age at right, detail in the hover card. P5 O6 M5 (P5 Decision
// Log 28): another machine's row carries `@<name>` after its title (T1); an offline machine's greys in place, "offline"
// where the chip was (T2). P5 O8 M5: a record at a listed address names the listing's owners after its title when they
// aren't you alone. P5 O8 M6b: its reach mark (a lock for Private, a people mark for wider access or shares). UX wave U7
// (O-16, O-38): every row's three dots, where only a row that could be renamed had them. UX wave U7 (O-16): whether it is
// nested under its lineage parent is a prop (`nested`), and a row under its project's Hidden row is `indented` one step.
import type { SessionRecord } from '@shared/graph/session';
import { workingWorktree } from '@shared/sessions/working-folder'; // UX wave U8c-2: the mark follows the agent
import { PinIcon } from '../app/IconButton';
import { MachineChip } from '../app/MachineChip';
import { greyWords, useMachineMark } from '../app/machine-mark';
import { RowHideButton, SessionOverflow } from './menus';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { selectSeenAt, useSessions } from '../stores/sessions';
import { lineageCaption, sessionAge } from './derive';
import { SessionHoverCard } from './HoverCard';
import { ReleasedMark } from '../budget/ReleasedMark'; // C12
import { sessionNodeId, useTree } from './tree';
import { RowTitle, useOwnersLabel } from './RowTitle'; // P5 O8 M5
import { ReachMark } from './ReachMark'; // P5 O8 M6b
import { setSessionUnread } from '../keymap/session-navigation';
import { displayTitle } from '../sessions/title';

export const SESSION_DRAG_TYPE = 'application/x-maws-session';

// The left inset: one step for each of nested under its lineage parent and indented under the Hidden row (UX wave U7).
export const rowInset = (nested: boolean, indented: boolean): string => ['px-[7px]', 'pr-[7px] pl-[30px]', 'pr-[7px] pl-[53px]'][Number(nested) + Number(indented)];

export function SessionRow({ record, level, nested, indented = false }: { record: SessionRecord; level: number; nested: boolean; indented?: boolean }) {
  const id = record.appId;
  const digest = useSessions((s) => s.digests.get(id));
  const seenAt = useSessions((s) => selectSeenAt(s, id)); // P5 O7 M10: a remote record's activity past the record
  const listing = useSessions((s) => s.listed.get(id)); // P5 O7 M10: a remote lane B record's state (`listedStateOf`)
  // E3 start: a side thread or fork nested under its parent (level 3 and deeper, its real depth for assistive tech) is
  // indented one step whatever its depth, marked `↳` and captioned by its anchor's label; one listed as a root says
  // whose it is (the parent's title when the store holds it)
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
  const glyph = glyphFor(record, digest ?? null, pending, listing);
  const selected = tree.selected === id;
  const title = displayTitle(record);
  const machine = useMachineMark(id);
  const owners = useOwnersLabel(id);

  return (
    <SessionHoverCard record={record}>
      <div
        role="treeitem"
        aria-level={level}
        aria-selected={selected}
        aria-label={machine.offline ? `${title}, ${greyWords(machine)}` : title}
        data-offline={machine.offline || undefined}
        tabIndex={tree.tabStop === nodeId ? 0 : -1}
        data-tree-id={nodeId}
        data-kind="session"
        data-menu={`session:${id}`}
        data-indented={indented || undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(SESSION_DRAG_TYPE, id);
          event.dataTransfer.effectAllowed = 'copyMove';
        }}
        onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)} // the card's shell guards a pointer's focus
        // I2: a click replaces the focused pane's session; ⌘-click and a middle-click open a tab of its own (Chrome's rule)
        onClick={(event) => useLayout.getState().openSession(id, event.metaKey ? { how: 'tab' } : {})}
        onAuxClick={(event) => event.button === 1 && useLayout.getState().openSession(id, { how: 'tab' })}
        className={`group/session relative flex h-(--row-h) cursor-default items-center gap-[5px] rounded-sm ${rowInset(nested, indented)} outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? 'bg-bg-active' : ''}`}
      >
        {workingWorktree(record) !== null && <span data-testid="row-branch" role="img" aria-label="Worktree" className="shrink-0 text-ui-sm text-fg-faint">⎇</span>}
        {/* E3 */}
        {nested && (
          <span aria-hidden data-testid="row-nested" className="-mr-[3px] shrink-0 text-ui text-fg">
            ↳
          </span>
        )}
        <RowTitle title={title} owners={owners} offline={machine.offline} />
        <MachineChip address={id} className="max-w-[35%]" />
        {/* E3: the lineage caption takes the branch's place; a nested side thread shares its parent's branch */}
        {caption !== null && (
          <span data-testid="row-lineage" title={caption} className={`max-w-[45%] shrink-0 truncate text-ui-sm text-fg-muted`}>
            {caption}
          </span>
        )}
        {/* C12: the memory budget's released mark */}
        <ReleasedMark released={digest?.released} />
        {/* P5 O8 M6b: its reach, when it isn't Listed or it has shares */}
        <ReachMark address={id} />
        {record.pinned && (
          <span role="img" aria-label="Pinned" className={`shrink-0 text-fg-faint`}>
            <PinIcon className="size-[11px]" />
          </span>
        )}
        <GlyphMark glyph={glyph} className="w-[12px] shrink-0" />
        <RowHideButton appSessionId={id} /* UX wave U7, O-16: shown with the three dots, it takes its 27 px from the title alone */ />
        {/* Approved mockup: overflow replaces age in one fixed slot, never the title or unread target. */}
        <span className="relative flex h-[22px] w-[26px] shrink-0 items-center justify-end [&:has([data-state=open])>[data-session-age]]:invisible">
          <span data-session-age className="text-ui-sm text-fg-muted tabular-nums group-hover/session:invisible group-focus-within/session:invisible">{sessionAge(record, digest, now, seenAt, listing)}</span>
          <span className="absolute inset-0 flex items-center justify-end"><SessionOverflow appSessionId={id} title={title} /></span>
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
