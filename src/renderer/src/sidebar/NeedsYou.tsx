// M2 (§2 O1): cross-project attention stays above the tree, independent of its search and hidden projects.
// The attention store supplies one wait-ordered row per session; the existing hover card supplies the request preview.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AppSessionId } from '@shared/graph/ids'; // P2-C
import { openAnchor, ownerAnchorOf } from '../attention/anchor'; // P2-C
import type { NeedsYouRow } from '../attention/derive';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import type { OpenSessionOptions } from '../stores/layout-model'; // P2-C
import { useSessions } from '../stores/sessions';
import { SessionHoverCard } from './HoverCard';
import { projectLabels } from './project-labels';
import { SectionHeading } from './SectionHeading';

export function NeedsYou({ rows, selected, onEmptyFocus }: { rows: NeedsYouRow[]; selected: string | null; onEmptyFocus(): void }) {
  const records = useSessions((s) => s.records);
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
      <SectionHeading title={`Needs you · ${rows.length}`} />
      <ul ref={list} aria-label="Needs you" className="m-0 flex list-none flex-col gap-px p-0">
        {rows.map((row, index) => {
          const record = records.get(row.appSessionId)!; // needsYou excludes missing and archived records.
          const project = record.projectId === null ? 'Other sessions' : (labels.get(record.projectId) ?? 'Other sessions');
          const title = displayTitle(record);
          const anchor = ownerAnchorOf(row.oldest); // P2-C: a question left or a must-read reads its summary and opens at its mark
          const reason = anchor !== null ? row.oldest.summary : ATTENTION_HEADINGS[row.oldest.kind].text;
          // every activation opens the session its way (a click takes the focused pane's place; ⌘-click and a middle
          // click give it a tab of its own), and an owner item's lands on its mark (P2-C)
          const open = (how: OpenSessionOptions) => {
            const openSession = (id: AppSessionId) => useLayout.getState().openSession(id, how);
            if (anchor !== null) openAnchor(row.appSessionId, anchor, openSession);
            else openSession(row.appSessionId);
          };
          return (
            <li key={row.appSessionId}>
              <SessionHoverCard record={record}>
                <button
                  type="button"
                  data-needs-you={row.appSessionId}
                  data-menu={`session:${row.appSessionId}`}
                  aria-label={`${project} · ${title} · ${reason}`}
                  aria-current={selected === row.appSessionId ? 'page' : undefined}
                  tabIndex={tabStop === row.appSessionId ? 0 : -1}
                  onFocus={() => {
                    focusOwner.current = { id: row.appSessionId, index };
                    setFocused(row.appSessionId);
                  }}
                  onBlur={() => { focusOwner.current = null; }}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onClick={(event) => open(event.metaKey ? { how: 'tab' } : {})}
                  onAuxClick={(event) => event.button === 1 && open({ how: 'tab' })}
                  className={`flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm px-[9px] text-left outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected === row.appSessionId ? 'bg-bg-active' : ''}`}
                >
                  <span aria-hidden className="shrink-0 text-warning">◐</span>
                  <span className="min-w-0 flex-1 truncate text-ui text-fg">{title}</span>
                  <span className="max-w-[30%] truncate text-ui-sm text-fg-muted">{project}</span>
                </button>
              </SessionHoverCard>
            </li>
          );
        })}
      </ul>
    </>
  );
}
