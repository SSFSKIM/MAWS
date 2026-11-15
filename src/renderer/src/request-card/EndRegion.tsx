// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §E `EndRegion`;
// decisions 13, 19 and 20): what a transcript's end row draws through the host seam. One element, `[data-request-end]`,
// in the transcript's column, holding the open card (`WaitingView.open`) and, while more wait, "Also waiting" with one
// line per other request: its kind's glyph in its tone, its summary, who asked when an agent did. Choosing a line goes
// through the transcript's one operation (`show`), which opens that card; the region keeps no selection of its own. Under
// them, each settling receipt held for this end as one status line with no control. The frame is the owner's card 1 of
// "The look" ("Column width, bordered"): `END_FRAME`, the one place it is set.
import { useLayoutEffect, useRef } from 'react';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AgentId, AppSessionId, AttentionId } from '@shared/graph/ids';
import { useAttention } from '../stores/attention';
import { useTranscriptStore } from '../transcript';
import { SettlingLine, useEndSettling, useWaitingView } from '../transcript/view/waiting-view';
import { Muted, TONE_CLASS } from './controls';
import { requesterName } from './requester';
import { RequestCard } from './RequestCard';

// The owner's card 1 (closed 2026-11-15: "Column width, bordered"): the docked frame's box, the transcript column's
// width, bordered and raised.
const END_FRAME = 'flex flex-col rounded-lg border border-border-strong bg-bg-raised p-3';
const LINE = 'flex w-full min-w-0 items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-left text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';

export function EndRegion({ appSessionId, agentId }: { appSessionId: AppSessionId; agentId: AgentId | null }) {
  const view = useWaitingView();
  const settling = useEndSettling();
  const deliveries = useAttention((s) => s.deliveries);
  const rows = useTranscriptStore((s) => s.entries[appSessionId]?.rows);
  const atEnd = view.placed.filter((p) => p.place === 'end' && deliveries.get(p.item.id)?.phase !== 'closed').map((p) => p.item);
  const open = atEnd.find((item) => item.id === view.open) ?? null;
  const others = atEnd.filter((item) => item !== open);

  const frame = useRef<HTMLDivElement>(null);
  const ids = atEnd.map((item) => item.id).join('\n');
  const { track } = view;
  useLayoutEffect(() => {
    const element = frame.current;
    const held = ids === '' ? [] : (ids.split('\n') as AttentionId[]);
    for (const id of held) track(id, element);
    return () => {
      for (const id of held) track(id, null);
    };
  }, [ids, track]);

  if (atEnd.length === 0 && settling.length === 0) return null;
  return (
    <div ref={frame} data-request-end={agentId === null ? appSessionId : `${appSessionId}:${agentId}`} className={END_FRAME}>
      {open !== null && <RequestCard key={open.id} item={open} request={null} placement="inline" region="end" askInPlace paneIndex={null} />}
      {others.length > 0 && (
        <div className={`flex flex-col gap-1 border-t border-border pt-2 ${open !== null ? 'mt-3' : ''}`} data-also-waiting="">
          <Muted className="pb-0.5">Also waiting</Muted>
          {others.map((item) => {
            const heading = ATTENTION_HEADINGS[item.kind];
            const from = item.request.agentId === null ? null : requesterName(rows ?? [], item.request.agentId as AgentId);
            return (
              <button key={item.id} type="button" className={LINE} data-waiting-line={item.id} onClick={() => view.show(item.id)}>
                <span aria-hidden className={TONE_CLASS[heading.tone]}>
                  {heading.char}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.summary}</span>
                {from !== null && <span className="shrink-0 text-fg-muted">from {from}</span>}
              </button>
            );
          })}
        </div>
      )}
      {settling.map((entry) => (
        <SettlingLine key={entry.id} entry={entry} className={open !== null || others.length > 0 ? 'mt-3' : ''} />
      ))}
    </div>
  );
}
