// M2 (§2 O1): cross-project attention stays above the tree, independent of its search and hidden projects.
// The attention store supplies one wait-ordered row per session; the existing hover card supplies the request preview.
// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6): another machine's session with no record is
// drawn from its listed row (its title, its machine for a project, the listing's hover card) and opens through its lane's
// opener; a greyed machine's rows (`greyed`, main's word: its link went down and no snapshot has come since) follow the
// live ones, drawn muted with the reason in their label, and the heading counts only the live ones.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AppSessionId } from '@shared/graph/ids'; // P2-C
import type { SessionRecord } from '@shared/graph/session'; // P5 O7 M6
import { MachineChip } from '../app/MachineChip';
import { greyWords, useMachineMark } from '../app/machine-mark';
import { openAnchor, ownerAnchorOf } from '../attention/anchor'; // P2-C
import type { NeedsYouRow } from '../attention/derive';
import { openListed } from '../sessions/remote-openers'; // P5 O7 M6
import { displayTitle, listedTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import type { OpenSessionOptions } from '../stores/layout-model'; // P2-C
import { useSessions } from '../stores/sessions';
import { ListedHoverCard, SessionHoverCard } from './HoverCard';
import { projectLabels } from './project-labels';
import { SectionHeading } from './SectionHeading';

// P5 O7 M6: a greyed row while its machine is up again, before main's next snapshot
export const RECONNECTING = 'reconnecting';

export function NeedsYou({ rows: live, greyed = NO_ROWS, selected, onEmptyFocus }: { rows: NeedsYouRow[]; greyed?: NeedsYouRow[]; selected: string | null; onEmptyFocus(): void }) {
  const rows = useMemo(() => (greyed.length === 0 ? live : [...live, ...greyed]), [live, greyed]);
  const projects = useSessions((s) => s.projects);
  const labels = useMemo(() => projectLabels([...projects.values()]), [projects]);
  const [focused, setFocused] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusOwner = useRef<{ id: string; index: number } | null>(null);
  // Removing a focused button leaves focus on body. Remember ownership only until a real blur, so a live update
  // never takes focus back from the session pane, the preview, or another sidebar control.
  useLayoutEffect(() => {
    const owner = focusOwner.current;
    if (!owner) return;
    const index = rows.findIndex((row) => row.appSessionId === owner.id);
    if (index !== -1) {
      owner.index = index;
      return;
    }
    focusOwner.current = null;
    if (document.activeElement !== document.body) return;
    const neighbour = list.current?.querySelectorAll<HTMLButtonElement>('[data-needs-you]')[Math.min(owner.index, rows.length - 1)];
    if (neighbour) neighbour.focus();
    else onEmptyFocus();
  }, [rows, onEmptyFocus]);
  const tabStop = rows.find((row) => row.appSessionId === focused)?.appSessionId ?? rows[0]?.appSessionId;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
    if (next === null) return; // Enter and Space activate the button; neither answers a request.
    event.preventDefault();
    list.current?.querySelectorAll<HTMLButtonElement>('[data-needs-you]')[next]?.focus();
  };
  if (rows.length === 0) return null;
  return (
    <>
      <SectionHeading title={`Needs you · ${live.length}`} />
      <ul ref={list} aria-label="Needs you" className="m-0 flex list-none flex-col gap-px p-0">
        {rows.map((row, index) => (
          <NeedsYouItem
            key={row.appSessionId}
            row={row}
            labels={labels}
            selected={selected === row.appSessionId}
            tabStop={tabStop === row.appSessionId}
            onFocus={() => {
              focusOwner.current = { id: row.appSessionId, index };
              setFocused(row.appSessionId);
            }}
            onBlur={() => { focusOwner.current = null; }}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        ))}
      </ul>
    </>
  );
}

const NO_ROWS: NeedsYouRow[] = [];

interface NeedsYouItemProps {
  row: NeedsYouRow;
  labels: ReadonlyMap<string, string>;
  selected: boolean;
  tabStop: boolean;
  onFocus(): void;
  onBlur(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}

// P5 O6 M5 (P5 Decision Log 28): a row marks its machine as the tree's session rows do, `@<name>` for another machine's
// (T1), its title greyed with "offline" in that place while the machine is offline (T2); a session of no project is
// labelled with its machine's name, as its machine's own row is (T3). P5 O7 M6: a listed session's row is labelled with
// its machine's name too (a listing names no project here), and a greyed row reads muted rather than faint, so it stays
// legible while it says why it is not counted.
function NeedsYouItem({ row, labels, selected, tabStop, onFocus, onBlur, onKeyDown }: NeedsYouItemProps) {
  // needsYou gives a row to a record that is not archived or, wanting one, to a listed session (P5 O7 M6)
  const record = useSessions((s) => s.records.get(row.appSessionId));
  const listed = useSessions((s) => (record === undefined ? s.listed.get(row.appSessionId) : undefined));
  const machine = useMachineMark(row.appSessionId);
  const project = (record === undefined || record.projectId === null ? undefined : labels.get(record.projectId)) ?? machine.name;
  const title = record !== undefined ? displayTitle(record) : listedTitle(listed ?? { title: '' });
  const anchor = ownerAnchorOf(row.oldest); // P2-C: a question left or a must-read reads its summary and opens at its mark
  const reason = anchor !== null ? row.oldest.summary : ATTENTION_HEADINGS[row.oldest.kind].text;
  // every activation opens the session its way (a click takes the focused pane's place; ⌘-click and a middle click give
  // it a tab of its own), and an owner item's lands on its mark (P2-C); P5 O7 M6: a plain click on another machine's
  // listed session goes through its lane's opener (M2's pane, which tries a session it could not place again)
  const open = (how: OpenSessionOptions) => {
    const openSession = (id: AppSessionId) => useLayout.getState().openSession(id, how);
    if (anchor !== null) openAnchor(row.appSessionId, anchor, openSession);
    else if (how.how !== 'tab' && openListed(row.appSessionId)) return;
    else openSession(row.appSessionId);
  };
  const label = `${project} · ${title} · ${reason}`;
  const greyed = row.greyed === true;
  const why = machine.offline ? greyWords(machine) : greyed ? RECONNECTING : null;
  return (
    <li>
      <RowCard record={record} appSessionId={row.appSessionId} title={title}>
        <button
          type="button"
          data-needs-you={row.appSessionId}
          data-menu={record !== undefined ? `session:${row.appSessionId}` : 'none'} // a listed row has no menu (ListedRow's rule)
          data-offline={machine.offline || undefined}
          data-greyed={greyed || undefined}
          aria-label={why === null ? label : `${label}, ${why}`}
          aria-current={selected ? 'page' : undefined}
          tabIndex={tabStop ? 0 : -1}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onClick={(event) => open(event.metaKey ? { how: 'tab' } : {})}
          onAuxClick={(event) => event.button === 1 && open({ how: 'tab' })}
          className={`flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm px-[9px] text-left outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? 'bg-bg-active' : ''}`}
        >
          <span aria-hidden className={`shrink-0 ${greyed ? 'text-fg-faint' : 'text-warning'}`}>◐</span>
          <span className={`min-w-0 flex-1 truncate text-ui ${greyed ? 'text-fg-muted' : machine.offline ? 'text-fg-faint' : 'text-fg'}`}>{title}</span>
          <MachineChip address={row.appSessionId} className="max-w-[25%]" />
          <span className="max-w-[30%] truncate text-ui-sm text-fg-muted">{project}</span>
        </button>
      </RowCard>
    </li>
  );
}

// The row's hover card: its record's, or (P5 O7 M6) its listing's, opened on hover as a listed tree row's is.
function RowCard({ record, appSessionId, title, children }: { record: SessionRecord | undefined; appSessionId: AppSessionId; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (record !== undefined) return <SessionHoverCard record={record}>{children}</SessionHoverCard>;
  return <ListedHoverCard appId={appSessionId} title={title} open={open} onOpenChange={setOpen}>{children}</ListedHoverCard>;
}
