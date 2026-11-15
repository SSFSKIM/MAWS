// A session tab's content (§5.4; C10's ask of C5). A session with a record reads as the transcript slot over the
// composer zone: the composer slot, and nothing under it (W2: §5.5 as amended 2026-10-01, the status line is gone). UX
// wave U1b: a waiting request is drawn in the session's transcript (its call's row, or the transcript's end), never in
// the composer zone. A session with no controls port (P5 O9 M4: a foreign-live one, held by a terminal or a background
// job) gets the holder notice in place of the composer (D-12); P5 O9 M5: a foreign-live session whose sminos bridge is
// live gets lane A's port, so the composer, and the notice only while it has none, with the reason its bridge gave when
// one answered but can't be driven. A session with no record yet is unstarted: the `newSession` slot
// (C10's heading and setup) with the composer frame centred beneath it and nothing else; it swaps to the ordinary pane
// when the record arrives. In both placements the composer sits in the column the transcript's rows use
// (`.thread-column`, W2: §5.4 as amended 2026-10-01, Codex's shared class), so the frame is exactly the transcript's
// width. P5 O9 M9: another machine's terminal session (a listed lane A row) has no record and reads as started: its
// transcript from its machine's plane, its composer driven through the lane A port.
// P5 O7 M2: another machine's lane B session is started once main has read its record there (main emits it as
// `session.changed`, so the pane is a record's like a local one's); until then it reads "Opening on <machine>…", and
// "<machine> can't place this session" (or whatever reason main says) with Try again once main gave up. The pane's mount
// is its announcement to main (lane-b/remote-connect.ts), so a reloaded page or a second window gets the session again.
// Board 525: another member's session on either lane whose read its machine refused at the member's grade (Can message)
// reads as what the member can do there and whom to ask for View, with no transcript and no composer; a pane opening the
// session asks afresh (sessions/share/reader-connect.ts).
// UX wave U1b (M5; acceptance 10): the compact composer of a closed floating card, which shows no transcript, has one
// line above it while requests of the session wait, "Waiting for you · N"; its click opens the card and goes to the oldest
// of them. The composer's own toolbar is not touched (the architect's ruling A4).
import { useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SurfaceViewportProvider } from '../engine-surface/viewport';
import { useSlot } from '../app/slots';
import { useLaneAState } from '../stores/lane-a'; // P5 O9 M5
import { useSessions } from '../stores/sessions';
import { useRemoteLaneA } from '../lane-a/remote-session'; // P5 O9 M9
import { retryRemoteSession, useRemotePaneOpening } from '../lane-b/remote-connect'; // P5 O7 M2
import { useIsRemoteLaneB, useRemoteLaneBState } from '../lane-b/remote-session'; // P5 O7 M2
import { useMachineMark } from '../app/machine-mark'; // P5 O7 M2
import { HolderNotice } from './HolderNotice';
import { useSessionControls } from './controls/controls-for'; // P5 O9 M4
import { SessionTabNotes } from '../sessions/SessionDialogs'; // C10
import { ReportBar } from '../owner/report/ReportBar'; // P2-C
import { READ_REFUSED } from '@shared/org/reader'; // board 525
import { READER } from '../sessions/share/copy'; // board 525
import { useCantRead, useWhomToAsk } from '../sessions/share/reader'; // board 525
import { useReaderPane } from '../sessions/share/reader-connect'; // board 525
import { ComputerUseStrip } from '../computer-use/Strip'; // UX wave U12a
import { BtwCard } from '../side/BtwCard'; // UX wave U4a
import { selectWaitingRequests, useAttention } from '../stores/attention'; // UX wave U1b
import { showWaiting } from '../request-card/show-waiting'; // UX wave U1b
import { openCard } from '../shell/floating'; // UX wave U1b

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
  useReaderPane(appSessionId); // board 525
  const cantRead = useCantRead(appSessionId); // board 525
  const envelope = useRef<HTMLDivElement>(null);
  return <div ref={envelope} className="h-full min-h-0 min-w-0"><SurfaceViewportProvider element={envelope}>
    {cantRead ? <CantReadPane appSessionId={appSessionId} /> : record || remote ? <StartedPane appSessionId={appSessionId} record={record ?? null} paneIndex={paneIndex} compact={compact} /> : remoteB ? <OpeningRemotePane appSessionId={appSessionId} /> : <UnstartedPane appSessionId={appSessionId} paneIndex={paneIndex} compact={compact} />}
  </SurfaceViewportProvider></div>;
}

// P5 O7 M2: another machine's lane B session whose record main hasn't read there yet, or couldn't: main's reason (opening,
// can't place, the device refused, the link closed), with Try again once it gave up, unless the machine removed this device.
function OpeningRemotePane({ appSessionId }: { appSessionId: AppSessionId }) {
  const state = useRemoteLaneBState(appSessionId);
  const machine = useMachineMark(appSessionId).name;
  const ended = state?.stream === 'ended';
  const retry = ended && state.link.refusal === null;
  // board 525: main's refused read on a session the member owns is the machine not placing it yet (one word for both)
  const reason = state?.reason === READ_REFUSED ? (ended ? `${machine} can’t place this session` : null) : (state?.reason ?? null);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div role="status" className="flex flex-col items-center gap-3 text-ui text-fg-muted">
        <p className="m-0">{reason ?? `Opening on ${machine}…`}</p>
        {retry && (
          <button type="button" onClick={() => retryRemoteSession()} className="rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

// Board 525: another member's session the member can't read (its machine refused the read at their grade).
function CantReadPane({ appSessionId }: { appSessionId: AppSessionId }) {
  const whom = useWhomToAsk(appSessionId);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div role="status" aria-label="Your access" className="flex max-w-md flex-col items-center gap-1 text-center text-ui text-fg-muted">
        <p className="m-0 text-fg">{READER.cantRead}</p>
        <p className="m-0">{READER.askForView(whom)}</p>
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
  const holder = record?.holder ?? null;
  const readOnly = useSessionControls(id) === null; // P5 O9 M4: no port drives the session
  const bridgeReason = useLaneAState(id)?.reason ?? null; // P5 O9 M5: a bridge that answered but can't be driven
  const noticed = readOnly && holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job'); // the holder notice stands in the composer's place

  return (
    <div className="flex h-full flex-col">
      {/* P2-C (2026-10-09): while the session's owner-channel lane is on, the header with the view toggle */}
      {!compact && <ReportBar appSessionId={id} />}
      {!compact && <ComputerUseStrip appSessionId={id} /> /* UX wave U12a: no height, its line over the transcript's top edge */}
      {/* UX wave U4a (M7): a positioned box around the transcript's scroller, so the session's `/btw` card is a layer of the
          pane over the transcript's bottom right corner and not of the scroller */}
      {!compact && <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="scroll-gutter-scope min-h-0 flex-1 overflow-auto">
          {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
          <Transcript appSessionId={id} agentId={null} paneIndex={paneIndex} waiting={noticed ? undefined : 'stacked'} /* UX wave U4a: the composer's stack draws a waiting message */ />
        </div>
        <BtwCard appSessionId={id} />
      </div>}
      <div className={`shrink-0 ${compact ? "py-2" : "scroll-gutter-under pt-4 pb-4"}`}>
        <ComposerColumn>
          {compact && <WaitingLine appSessionId={id} /* UX wave U1b: no transcript here, so the count above the composer */ />}
          {compact && <BtwCard appSessionId={id} placement="flow" /* UX wave U4a: no transcript here, so directly above the frame */ />}
          {/* C10 start: an interrupted delete's Finish deleting or Keep, and the card a resume waits on */}
          <SessionTabNotes appSessionId={id} />
          {/* C10 end */}
          {noticed ? (
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

// UX wave U1b (M5): how many requests of the session wait, as one line above the compact composer; the card opens on a
// click, and the oldest of them is shown in its transcript once that mounts.
function WaitingLine({ appSessionId }: { appSessionId: AppSessionId }) {
  const waiting = useAttention((s) => selectWaitingRequests(s, appSessionId).length);
  if (waiting === 0) return null;
  const go = () => {
    openCard();
    showWaiting(appSessionId, null);
  };
  return (
    <button type="button" data-waiting-count={waiting} onClick={go} className="flex w-full min-w-0 items-center rounded-sm px-2 py-1 text-left text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
      Waiting for you · {waiting}
    </button>
  );
}
