// A session tab's content (§5.4; C10's ask of C5). A session with a record reads as the transcript slot over the
// composer zone: the docked request (the X4 slot, `placement: 'docked'`) above the composer slot, and nothing under it
// (W2: §5.5 as amended 2026-10-01, the status line is gone). A foreign-live session gets the holder notice in place of
// the composer and never a docked request (D-12). A session with no record yet is unstarted: the `newSession` slot
// (C10's heading and setup) with the composer frame centred beneath it and nothing else; it swaps to the ordinary pane
// when the record arrives. In both placements the composer sits in the column the transcript's rows use
// (`.thread-column`, W2: §5.4 as amended 2026-10-01, Codex's shared class), so the frame is exactly the transcript's
// width.
import { useEffect, useRef, type ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SurfaceViewportProvider } from '../engine-surface/viewport';
import { useSlot } from '../app/slots';
import { FALLBACKS } from '../app/slot-fallbacks'; // C7
import { waitingItem } from '../attention/derive';
import { ipc } from '../ipc/client';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { HolderNotice } from './HolderNotice';
import { SessionTabNotes } from '../sessions/SessionDialogs'; // C10

type PaneIndex = 0 | 1;

// The column the composer, and what docks with it, sit in: the transcript's (W2).
export function ComposerColumn({ children }: { children: ReactNode }) {
  return <div className="thread-column flex flex-col gap-3">{children}</div>;
}

export function SessionPane({ appSessionId, paneIndex }: { appSessionId: AppSessionId; paneIndex: PaneIndex }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const envelope = useRef<HTMLDivElement>(null);
  return <div ref={envelope} className="h-full min-h-0 min-w-0"><SurfaceViewportProvider element={envelope}>
    {record ? <StartedPane record={record} paneIndex={paneIndex} /> : <UnstartedPane appSessionId={appSessionId} paneIndex={paneIndex} />}
  </SurfaceViewportProvider></div>;
}

function UnstartedPane({ appSessionId, paneIndex }: { appSessionId: AppSessionId; paneIndex: PaneIndex }) {
  const NewSession = useSlot('newSession');
  const Composer = useSlot('composer');
  return (
    <div className="flex h-full flex-col justify-center overflow-auto py-6">
      <ComposerColumn>
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        <NewSession appSessionId={appSessionId} />
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        <Composer appSessionId={appSessionId} paneIndex={paneIndex} />
      </ComposerColumn>
    </div>
  );
}

function StartedPane({ record, paneIndex }: { record: SessionRecord; paneIndex: PaneIndex }) {
  const id = record.appId;
  const Transcript = useSlot('transcript');
  const Composer = useSlot('composer');
  const pending = useAttention((s) => selectPendingOf(s, id));
  const { holder } = record;
  const foreign = holder.kind === 'terminal' || holder.kind === 'background_job';
  // A docked request is the session's oldest actionable item (the one its Needs-you row shows); held peer messages
  // are not requests.
  const waiting = waitingItem(pending);
  const docked = !foreign && waiting?.tier === 1 && Composer === FALLBACKS.composer ? waiting.oldest : null; // C7: a registered composer is the one docked swap (it docks the request itself)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        <Transcript appSessionId={id} agentId={null} paneIndex={paneIndex} />
      </div>
      <div className="shrink-0 pt-4 pb-4">
        <ComposerColumn>
          {docked && <DockedRequest item={docked} paneIndex={paneIndex} />}
          {/* C10 start: an interrupted delete's Finish deleting or Keep, and the card a resume waits on */}
          <SessionTabNotes appSessionId={id} />
          {/* C10 end */}
          {foreign ? (
            // C10: the notice carries the session's id for its actions
            <HolderNotice appSessionId={id} holder={holder} />
          ) : (
            // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
            <Composer appSessionId={id} paneIndex={paneIndex} />
          )}
        </ComposerColumn>
      </div>
    </div>
  );
}

function DockedRequest({ item, paneIndex }: { item: AttentionItem; paneIndex: PaneIndex }) {
  const Card = useSlot('requestCard');
  const request = useAttention((s) => s.requests.get(item.id) ?? null);
  useEffect(() => void useAttention.getState().loadRequest(ipc, item), [item]);
  return (
    <div className="rounded-lg border border-border-strong bg-bg-raised p-3">
      {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
      <Card item={item} request={request} placement="docked" paneIndex={paneIndex} />
    </div>
  );
}
