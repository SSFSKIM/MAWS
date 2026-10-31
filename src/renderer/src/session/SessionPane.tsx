// A session tab's content (§5.4; C10's ask of C5). A session with a record reads as the transcript slot over the
// composer zone: the docked request (the X4 slot, `placement: 'docked'`) above the composer slot, and nothing under it
// (W2: §5.5 as amended 2026-10-01, the status line is gone). A session with no controls port (P5 O9 M4: a foreign-live
// one, held by a terminal or a background job) gets the holder notice in place of the composer and never a docked
// request (D-12); P5 O9 M5: a foreign-live session whose sminos bridge is live gets lane A's port, so the composer, and the
// notice only while it has none, with the reason its bridge gave when one answered but can't be driven; M6: its requests
// dock as any session's, and one its terminal answered first stays docked 3 s, settled in place (the owner's Q3). A session with
// no record yet is unstarted: the `newSession` slot
// (C10's heading and setup) with the composer frame centred beneath it and nothing else; it swaps to the ordinary pane
// when the record arrives. In both placements the composer sits in the column the transcript's rows use
// (`.thread-column`, W2: §5.4 as amended 2026-10-01, Codex's shared class), so the frame is exactly the transcript's
// width. P5 O9 M9: another machine's terminal session (a listed lane A row) has no record and reads as started: its
// transcript from its machine's plane, its composer driven through the lane A port, its requests docked as cards.
// P5 O7 M2: another machine's lane B session is started once main has read its record there (main emits it as
// `session.changed`, so the pane is a record's like a local one's); until then it reads "Opening on <machine>…", and
// "<machine> can't place this session" (or whatever reason main says) with Try again once main gave up. The pane's mount
// is its announcement to main (lane-b/remote-connect.ts), so a reloaded page or a second window gets the session again.
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
import { useLaneAState } from '../stores/lane-a'; // P5 O9 M5
import { useSettling } from '../lane-a/race'; // P5 O9 M6
import { useSessions } from '../stores/sessions';
import { useRemoteLaneA } from '../lane-a/remote-session'; // P5 O9 M9
import { retryRemoteSession, useRemotePaneOpening } from '../lane-b/remote-connect'; // P5 O7 M2
import { useIsRemoteLaneB, useRemoteLaneBState } from '../lane-b/remote-session'; // P5 O7 M2
import { useMachineMark } from '../app/machine-mark'; // P5 O7 M2
import { HolderNotice } from './HolderNotice';
import { useSessionControls } from './controls/controls-for'; // P5 O9 M4
import { SessionTabNotes } from '../sessions/SessionDialogs'; // C10
import { ReportBar } from '../owner/report/ReportBar'; // P2-C

type PaneIndex = 0 | 1;

// The column the composer, and what docks with it, sit in: the transcript's (W2).
export function ComposerColumn({ children }: { children: ReactNode }) {
  return <div className="thread-column flex flex-col gap-3">{children}</div>;
}

export function SessionPane({ appSessionId, paneIndex, compact = false }: { appSessionId: AppSessionId; paneIndex: PaneIndex; compact?: boolean }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const remote = useRemoteLaneA(appSessionId); // P5 O9 M9
  const remoteB = useIsRemoteLaneB(appSessionId); // P5 O7 M2
  useRemotePaneOpening(appSessionId); // P5 O7 M2
  const envelope = useRef<HTMLDivElement>(null);
  return <div ref={envelope} className="h-full min-h-0 min-w-0"><SurfaceViewportProvider element={envelope}>
    {record || remote ? <StartedPane appSessionId={appSessionId} record={record ?? null} paneIndex={paneIndex} compact={compact} /> : remoteB ? <OpeningRemotePane appSessionId={appSessionId} /> : <UnstartedPane appSessionId={appSessionId} paneIndex={paneIndex} compact={compact} />}
  </SurfaceViewportProvider></div>;
}

// P5 O7 M2: another machine's lane B session whose record main hasn't read there yet, or couldn't: main's reason (opening,
// can't place, the device refused, the link closed), with Try again once it gave up, unless the machine removed this device.
function OpeningRemotePane({ appSessionId }: { appSessionId: AppSessionId }) {
  const state = useRemoteLaneBState(appSessionId);
  const machine = useMachineMark(appSessionId).name;
  const ended = state?.stream === 'ended';
  const retry = ended && state.link.refusal === null;
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div role="status" className="flex flex-col items-center gap-3 text-ui text-fg-muted">
        <p className="m-0">{state?.reason ?? `Opening on ${machine}…`}</p>
        {retry && (
          <button type="button" onClick={() => retryRemoteSession()} className="rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function UnstartedPane({ appSessionId, paneIndex, compact }: { appSessionId: AppSessionId; paneIndex: PaneIndex; compact: boolean }) {
  const NewSession = useSlot('newSession');
  const Composer = useSlot('composer');
  return (
    <div className={`flex h-full flex-col justify-center overflow-auto ${compact ? "py-2" : "py-6"}`}>
      <ComposerColumn>
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        {!compact && <NewSession appSessionId={appSessionId} />}
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        <Composer appSessionId={appSessionId} paneIndex={paneIndex} />
      </ComposerColumn>
    </div>
  );
}

function StartedPane({ appSessionId: id, record, paneIndex, compact }: { appSessionId: AppSessionId; record: SessionRecord | null; paneIndex: PaneIndex; compact: boolean }) {
  const Transcript = useSlot('transcript');
  const Composer = useSlot('composer');
  const pending = useAttention((s) => selectPendingOf(s, id));
  const holder = record?.holder ?? null;
  const readOnly = useSessionControls(id) === null; // P5 O9 M4: no port drives the session
  const bridgeReason = useLaneAState(id)?.reason ?? null; // P5 O9 M5: a bridge that answered but can't be driven
  // A docked request is the session's oldest actionable item (the one its Needs-you row shows); held peer messages
  // are not requests.
  const waiting = waitingItem(pending);
  const docked = useSettling(!readOnly && waiting?.tier === 1 && Composer === FALLBACKS.composer ? waiting.oldest : null); // C7: a registered composer is the one docked swap (it docks the request itself)

  return (
    <div className="flex h-full flex-col">
      {/* P2-C (2026-10-09): while the session's owner-channel lane is on, the header with the view toggle */}
      {!compact && <ReportBar appSessionId={id} />}
      {!compact && <div className="min-h-0 flex-1 overflow-auto">
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        <Transcript appSessionId={id} agentId={null} paneIndex={paneIndex} />
      </div>}
      <div className={`shrink-0 ${compact ? "py-2" : "pt-4 pb-4"}`}>
        <ComposerColumn>
          {docked && <DockedRequest item={docked} paneIndex={paneIndex} />}
          {/* C10 start: an interrupted delete's Finish deleting or Keep, and the card a resume waits on */}
          <SessionTabNotes appSessionId={id} />
          {/* C10 end */}
          {readOnly && holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job') ? (
            // C10: the notice carries the session's id for its actions
            <HolderNotice appSessionId={id} holder={holder} reason={bridgeReason} />
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
