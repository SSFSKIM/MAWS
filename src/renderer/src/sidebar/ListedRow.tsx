// Another machine's session as its listing says it (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// "Drawing"): the title, `@<name>` (T1), greyed in place with "offline" while its machine is not up (T2), the state's glyph
// and the age of its listing, in a session row's slots. A click calls its lane's opener (`remote-openers.ts`); with none,
// the row is selected and its hover card shows. No drag, pin or unread: those act on a record. P5 O8 M5: its owners after
// the title when they aren't you alone. P5 O8 M6b: its reach mark, and Share for a session you own in its menu (the
// listing-capable session menu, menus.tsx). UX wave U7 (O-38, ticket 559): it opens like a local row, through its lane's opener
// (`openListed`): its menu (always named) and its three dots offer Open and Open in new tab, and a ⌘-click or a middle click
// asks for a tab of its own; with no opener each of them selects the row and shows its card, as a click does. UX wave U7
// (O-16): under its project's Hidden row it is `indented` one step. The UX wave, U9: its menu also holds the acts
// another machine offers for a listing (Fork, and Rename… and Archive for one you own).
import { useState } from 'react';
import { MachineChip } from '../app/MachineChip';
import { greyWords, useMachineMark } from '../app/machine-mark';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { listedGlyph } from '../attention/glyph';
import { openListed } from '../sessions/remote-openers';
import { selectPendingOf, useAttention } from '../stores/attention'; // P5 O7 M6
import type { ListedSession } from '../stores/sessions';
import { formatAge, listedTitle } from './derive';
import { ListedHoverCard } from './HoverCard';
import { RowHideButton, SessionOverflow } from './menus';
import { rowInset } from './SessionRow';
import { RowTitle, useOwnersLabel } from './RowTitle'; // P5 O8 M5
import { ReachMark } from './ReachMark'; // P5 O8 M6b
import { sessionNodeId, useTree } from './tree';

const NEW_TAB = { newTab: true };

export function ListedRow({ listed, level, indented = false }: { listed: ListedSession; level: number; indented?: boolean }) {
  const id = listed.appId;
  const tree = useTree();
  const nodeId = sessionNodeId(id);
  const machine = useMachineMark(id);
  const now = useNow();
  const [card, setCard] = useState(false);
  const title = listedTitle(listed);
  const owners = useOwnersLabel(id);
  const pending = useAttention((s) => selectPendingOf(s, id)); // P5 O7 M6: its machine's attention feed
  const glyph = listedGlyph(listed.state, pending);
  const issued = Date.parse(listed.issued);
  const activate = (how?: { newTab: boolean }) => {
    if (openListed(id, how)) return;
    tree.onPick?.(id);
    setCard(true);
  };

  return (
    <ListedHoverCard appId={id} title={title} open={card} onOpenChange={setCard}>
      <div
        role="treeitem"
        aria-level={level}
        aria-selected={tree.selected === id}
        aria-label={machine.offline ? `${title}, ${greyWords(machine)}` : title}
        data-offline={machine.offline || undefined}
        tabIndex={tree.tabStop === nodeId ? 0 : -1}
        data-tree-id={nodeId}
        data-kind="listed"
        data-menu={`session:${id}`}
        data-indented={indented || undefined}
        onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(nodeId)}
        onClick={(event) => activate(event.metaKey ? NEW_TAB : undefined)}
        onAuxClick={(event) => event.button === 1 && activate(NEW_TAB)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
          event.preventDefault();
          activate();
        }}
        className={`group/session relative flex h-(--row-h) cursor-default items-center gap-[5px] rounded-sm ${rowInset(false, indented)} outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${tree.selected === id ? 'bg-bg-active' : ''}`}
      >
        <RowTitle title={title} owners={owners} offline={machine.offline} />
        <MachineChip address={id} className="max-w-[35%]" />
        <ReachMark address={id} />
        <GlyphMark glyph={glyph} className="w-[12px] shrink-0" />
        <RowHideButton appSessionId={id} /* UX wave U7, O-16: shown with the three dots, it takes its 27 px from the title alone */ />
        <span className="relative flex h-[22px] w-[26px] shrink-0 items-center justify-end [&:has([data-state=open])>[data-session-age]]:invisible">
          <span data-session-age className="text-ui-sm text-fg-muted tabular-nums group-hover/session:invisible group-focus-within/session:invisible">{Number.isFinite(issued) ? formatAge(now - issued) : null}</span>
          <span className="absolute inset-0 flex items-center justify-end"><SessionOverflow appSessionId={id} title={title} /></span>
        </span>
        <span aria-hidden className="size-4 shrink-0" />
      </div>
    </ListedHoverCard>
  );
}
