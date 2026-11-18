// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §E `WaitingCard`;
// acceptance 6 and 7): the card column's first card, registered in U8b's slot `sessionCardWaiting`, which the column
// mounts only while a request of the session waits. "Waiting for you", with the count when more than one waits; one line
// per request of the session's list, oldest first: its kind's glyph in its tone, its summary, who asked when an agent
// did, how long it has waited, the summary in full as the line's tooltip. A line goes to its request (`showWaiting`); it
// answers nothing itself. In the column's own card chrome, with no fold. A settling receipt is no request and no line.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import { useNow } from '../app/use-now';
import { itemAge } from '../sidebar/derive';
import { selectWaitingRequests, useAttention } from '../stores/attention';
import { useTranscriptStore } from '../transcript';
import { TONE_CLASS } from './controls';
import { requesterName } from './requester';
import { showWaiting } from './show-waiting';

const TITLE = 'Waiting for you';
const LINE = 'flex h-7 w-full min-w-0 items-center gap-1.5 px-3 text-left text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2';

export function WaitingCard({ appSessionId }: { appSessionId: AppSessionId }) {
  const items = useAttention((s) => selectWaitingRequests(s, appSessionId));
  const rows = useTranscriptStore((s) => s.entries[appSessionId]?.rows);
  const now = useNow();
  if (items.length === 0) return null;
  return (
    <section aria-label={TITLE} className="shrink-0 overflow-hidden rounded-md border border-border bg-bg-raised text-ui text-fg shadow-strip">
      <h3 className="flex h-10 min-w-0 items-center px-3 font-medium">{items.length > 1 ? `${TITLE} · ${items.length}` : TITLE}</h3>
      <div className="flex min-w-0 flex-col pb-1">
        {items.map((item) => {
          const heading = ATTENTION_HEADINGS[item.kind];
          const from = item.request.agentId === null ? null : requesterName(rows ?? [], item.request.agentId as AgentId);
          return (
            <button key={item.id} type="button" className={LINE} title={item.summary} data-waiting-card-line={item.id} onClick={() => showWaiting(appSessionId, item.id)}>
              <span aria-hidden className={`shrink-0 ${TONE_CLASS[heading.tone]}`}>
                {heading.char}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.summary}</span>
              {from !== null && <span className="max-w-[40%] shrink-0 truncate text-fg-muted">from {from}</span>}
              <span className="shrink-0 text-fg-muted tabular-nums">{itemAge(item, now)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
