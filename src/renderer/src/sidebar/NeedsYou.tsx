// M2 (§2 O1): cross-project attention stays above the tree, independent of its search and hidden projects.
// The attention store supplies one wait-ordered row per session; the existing hover card supplies the request preview.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { NeedsYouRow } from '../attention/derive';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { SessionHoverCard } from './HoverCard';
import { SectionHeading } from './SectionHeading';

export function NeedsYou({ rows, selected, onEmptyFocus }: { rows: NeedsYouRow[]; selected: string | null; onEmptyFocus(): void }) {
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
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
          const project = record.projectId === null ? 'Other sessions' : (projects.get(record.projectId)?.name ?? 'Other sessions');
          const title = displayTitle(record);
          const reason = ATTENTION_HEADINGS[row.oldest.kind].text;
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
                  onClick={(event) => useLayout.getState().openSession(row.appSessionId, event.metaKey ? { how: 'tab' } : {})}
                  onAuxClick={(event) => event.button === 1 && useLayout.getState().openSession(row.appSessionId, { how: 'tab' })}
                  className={`flex w-full cursor-default flex-col rounded-sm px-[9px] py-1.5 text-left outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected === row.appSessionId ? 'bg-bg-active' : ''}`}
                >
                  <span className="w-full truncate text-ui-sm text-fg-muted">{project}</span>
                  <span className="w-full truncate text-ui text-fg">{title}</span>
                  <span className="w-full truncate text-ui-sm text-fg-muted">{reason}</span>
                </button>
              </SessionHoverCard>
            </li>
          );
        })}
      </ul>
    </>
  );
}
