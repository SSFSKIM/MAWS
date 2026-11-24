// The sessions of a machine that have something on their sheet (the C3 plan's §G, "The overview", and S16): C4's `/`,
// not mounted in the app. A session with an open or queued question, an accepted outcome or a hidden question is listed,
// as is one whose record this build cannot read; the stopped ones (`live === false`) apart, a session the index does not
// hold (`live === null`) with the running. Each row is its title, its counts and its oldest open question's age; with
// `hrefOf` it is a real anchor, a plain click still opening through `onOpen`, so the page routes and a link can be kept.
import { useEffect, useState, type MouseEvent } from 'react';
import type { SheetSummary } from '@shared/sheet/model';
import { SHEET_WORDS } from './copy';

export interface SheetOverviewProps {
  sessions: readonly SheetSummary[];
  onOpen(session: string): void;
  hrefOf?: (session: string) => string; // given: each row is a real anchor with that href (C4's `/s/<session>`)
}

const WORDS = SHEET_WORDS.overview;
const ROW = 'flex w-full min-w-0 items-baseline gap-2 rounded-sm px-2.5 py-1.5 text-left text-fg no-underline outline-accent hover:bg-bg-hover focus-visible:outline-2';
const listed = (summary: SheetSummary) => summary.unreadable || summary.open + summary.queued + summary.pending + summary.hidden > 0;

function countsOf(summary: SheetSummary): string {
  if (summary.unreadable) return WORDS.unreadable;
  const parts = [summary.open > 0 && WORDS.open(summary.open), summary.queued > 0 && WORDS.queued(summary.queued), summary.pending > 0 && WORDS.accepted(summary.pending), summary.hidden > 0 && WORDS.hidden(summary.hidden)];
  return parts.filter((part) => part !== false).join(' · ');
}

function Row({ summary, now, onOpen, hrefOf }: { summary: SheetSummary; now: number; onOpen(session: string): void; hrefOf?: (session: string) => string }) {
  const age = summary.oldestAskedAt === null ? null : WORDS.age(now - Date.parse(summary.oldestAskedAt));
  const inner = (
    <>
      <span className="min-w-0 flex-1 truncate font-medium">{summary.title ?? WORDS.untitled(summary.session)}</span>
      <span className="shrink-0 text-ui-sm text-fg-muted">{countsOf(summary)}</span>
      {age !== null && <span className="w-8 shrink-0 text-right text-ui-sm text-fg-muted tabular-nums">{age}</span>}
    </>
  );
  const open = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // the browser's own
    event.preventDefault();
    onOpen(summary.session);
  };
  return (
    <li data-sheet-session={summary.session} className="min-w-0">
      {hrefOf ? (
        <a href={hrefOf(summary.session)} onClick={open} className={ROW}>
          {inner}
        </a>
      ) : (
        <button type="button" onClick={() => onOpen(summary.session)} className={ROW}>
          {inner}
        </button>
      )}
    </li>
  );
}

export function SheetOverview({ sessions, onOpen, hrefOf }: SheetOverviewProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const shown = sessions.filter(listed);
  const groups = [
    { name: WORDS.running, rows: shown.filter((summary) => summary.live !== false) },
    { name: WORDS.stopped, rows: shown.filter((summary) => summary.live === false) },
  ].filter((group) => group.rows.length > 0);
  if (groups.length === 0) return <p className="m-0 p-6 text-center text-fg-muted">{WORDS.empty}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-4 text-ui text-fg" data-sheet-overview="">
      {groups.map((group) => (
        <section key={group.name} className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 px-2.5 text-ui-sm font-semibold tracking-[0.08em] text-fg-muted uppercase">{group.name}</h2>
          <ul aria-label={group.name} className="m-0 flex list-none flex-col p-0">
            {group.rows.map((summary) => (
              <Row key={summary.session} summary={summary} now={now} onOpen={onOpen} hrefOf={hrefOf} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
