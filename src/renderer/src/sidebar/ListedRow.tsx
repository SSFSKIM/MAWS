// Another machine's session as its listing says it (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// "Drawing"): the title, `@<name>` (T1), greyed in place with "offline" while its machine is not up (T2), the state's glyph
// and the age of its listing, in a session row's slots. A click calls its lane's opener (`remote-openers.ts`); with none,
// the row is selected and its hover card shows. No menu, drag, pin or unread: those act on a record. P5 O8 M5: its
// owners after the title when they aren't you alone.
import { useState } from 'react';
import { MachineChip } from '../app/MachineChip';
import { MACHINE_OFFLINE, useMachineMark } from '../app/machine-mark';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { listedGlyph } from '../attention/glyph';
import { remoteOpenerFor } from '../sessions/remote-openers';
import type { ListedSession } from '../stores/sessions';
import { formatAge, listedTitle } from './derive';
import { ListedHoverCard } from './HoverCard';
import { RowTitle, useOwnersLabel } from './RowTitle'; // P5 O8 M5
import { sessionNodeId, useTree } from './tree';

export function ListedRow({ listed, level }: { listed: ListedSession; level: number }) {
  const id = listed.appId;
  const tree = useTree();
  const nodeId = sessionNodeId(id);
  const machine = useMachineMark(id);
  const now = useNow();
  const [card, setCard] = useState(false);
  const title = listedTitle(listed);
  const owners = useOwnersLabel(id);
  const glyph = listedGlyph(listed.state);
  const issued = Date.parse(listed.issued);
  const activate = () => {
    const open = remoteOpenerFor(listed.lane);
    if (open) return open(listed);
    tree.onPick?.(id);
    setCard(true);
  };

  return (
    <ListedHoverCard appId={id} title={title} open={card} onOpenChange={setCard}>
      <div
        role="treeitem"
        aria-level={level}
        aria-selected={tree.selected === id}
        aria-label={machine.offline ? `${title}, ${MACHINE_OFFLINE}` : title}
        data-offline={machine.offline || undefined}
        tabIndex={tree.tabStop === nodeId ? 0 : -1}
        data-tree-id={nodeId}
        data-kind="listed"
        data-menu="none" // no menu: not the project row's either
        onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
          event.preventDefault();
          activate();
        }}
        className={`relative flex h-(--row-h) cursor-default items-center gap-[5px] rounded-sm px-[7px] outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${tree.selected === id ? 'bg-bg-active' : ''}`}
      >
        <RowTitle title={title} owners={owners} offline={machine.offline} />
        <MachineChip address={id} className="max-w-[35%]" />
        <GlyphMark glyph={glyph} className="w-[12px] shrink-0" />
        <span className="flex h-[22px] w-[26px] shrink-0 items-center justify-end">
          <span data-session-age className="text-ui-sm text-fg-muted tabular-nums">{Number.isFinite(issued) ? formatAge(now - issued) : null}</span>
        </span>
        <span aria-hidden className="size-4 shrink-0" />
      </div>
    </ListedHoverCard>
  );
}
