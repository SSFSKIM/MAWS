// The transcript as the shell mounts it (C8's ask, Public surface): one Transcript over the session's IPC source (a
// child agent's when `agentId` is given), with the actions every child registered merged over the defaults and the
// latest registered request-card renderer (C7's), re-rendered when either changes. A session transcript gets the
// receipt's rewind over `session.rewindFiles`; a child's does not (its turns are not the session's prompts, so there is
// nothing to rewind to). C5's `transcript` slot renders it through `transcript/shell.tsx`, registered from `App.tsx`.
// W1: a session's transcript also shows the messages held in MAWS's queue at its tail, dimmed with "Sends when this
// turn ends", and hides the bubble of a steer held back into that queue. It attaches C7's queue store itself, as the
// composer does, so a session transcript shown without its composer reads the live queue.
// W8: a session's transcript names the effort the session runs at in its live thinking label, the effort the model
// selector shows (W3's `useShownEffort`); a child's names none.
// P2-E1: three additive options for a mount that shows a session in a smaller place (the comment card's thread): the
// first row to show (`startAt`), actions overriding the registered ones for this mount, and the presentation forced
// local (`Transcript`'s). Absent, the slot draws as before.
// P2-C (2026-10-09): a session's slot follows its owner channel (`stores/owner-channel.ts`) and tells the transcript
// whether the lane is on, which the report view and the report module read.
// P5 O9 M5: a terminal session driven through its bridge streams its reply into the tail (`lane-a/stream/overlay.ts`),
// keeps what an interrupt cut of it in its turn, and is at rest while its controls port says no main turn runs.
// L197: the slot gives the transcript the session's agents from its task graph (agent-lookup.ts), so a message to an
// agent no loaded turn launched names it.
// P5 O9 M9: another machine's terminal session (a listed lane A row) draws through `lane-a/view/RemoteTranscriptSlot.tsx`,
// from its machine's plane. 2026-11-06: a subagent's own transcript there draws through
// `lane-a/view/RemoteAgentTranscript.tsx`, where its machine's endpoint carries it; elsewhere its port's gap is said in
// its place.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useWorkingFolder } from '../../sessions/working-folder';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShownEffort } from '../../composer/effective-effort';
import { useOwnerChannel } from '../../stores/owner-channel'; // P2-C
import { attachQueue, EMPTY_QUEUE, useQueueStore } from '../../stores/queue';
import { usePromptAuthor } from '../../sessions/share/reader'; // board 525
import { useTranscriptStore } from '../../stores/transcript'; // L276
import { askAnsweredHere, askSteerOf, heldRow } from '../model/derive';
import type { Row } from '../model/rows';
import { ipcRewind, ipcSource } from '../source/ipc';
import { useAgentLookup } from './agent-lookup'; // L197
import type { TranscriptActions } from './context';
import { useLaneAStreaming } from '../../lane-a/stream/use-overlay'; // P5 O9 M5
import { useRemoteLaneA } from '../../lane-a/remote-session'; // P5 O9 M9
import { useSessionControls } from '../../session/controls/controls-for'; // P5 O9 M5
import { useRegisteredActions, useRegisteredRequestRenderer } from './registry';
import { storeKeyOf, Transcript } from './Transcript';

// P5 O9 M9: loaded only when another machine's session is shown, so the plane transcript it draws through stays out of
// the chunk every local transcript loads.
const RemoteTranscriptSlot = lazy(() => import('../../lane-a/view/RemoteTranscriptSlot').then((module) => ({ default: module.RemoteTranscriptSlot })));
const RemoteAgentTranscript = lazy(() => import('../../lane-a/view/RemoteAgentTranscript').then((module) => ({ default: module.RemoteAgentTranscript }))); // 2026-11-06

export interface TranscriptSlotProps {
  appSessionId: AppSessionId;
  agentId?: AgentId;
  className?: string;
  startAt?: (rows: readonly Row[], loaded: boolean) => number | null; // P2-E1: the first row shown; null: none yet
  presentation?: 'local'; // P2-E1: the owner channel through MAWS's presenter, whatever the surface's attachment
  actions?: Partial<TranscriptActions>; // P2-E1: merged over the registered actions, for this mount only
  // UX wave U4a (decision 12): the mount has a stack (the session's pane, where it mounts the composer), which draws the
  // held messages and a message while it is unread: no held rows at the tail, and no row marked unread. Absent (the
  // side thread's card, which mounts no composer), the held bubble is its only drawing of a reply that waits.
  waiting?: 'stacked';
}

export function TranscriptSlot(props: TranscriptSlotProps) {
  const remote = useRemoteLaneA(props.appSessionId); // P5 O9 M9
  if (!remote) return <LocalTranscriptSlot {...props} />;
  if (props.agentId !== undefined) return <RemoteAgentSlot {...props} agentId={props.agentId} />;
  return (
    <Suspense fallback={null}>
      <RemoteTranscriptSlot {...props} />
    </Suspense>
  );
}

// 2026-11-06: a subagent's own transcript of another machine's terminal session, where its port carries it.
function RemoteAgentSlot({ appSessionId, agentId, className, actions: overrides }: TranscriptSlotProps & { agentId: AgentId }) {
  const registered = useRegisteredActions();
  const actions = useMemo(() => (overrides ? { ...registered, ...overrides } : registered), [registered, overrides]);
  const renderRequest = useRegisteredRequestRenderer();
  const gap = useSessionControls(appSessionId)?.capability('subagent-rows') ?? null;
  if (gap !== null && !gap.available) {
    return <p className={`m-0 px-4 py-3 text-ui-sm text-fg-muted ${className ?? ''}`} role="status" data-testid="remote-subagent-gap">{gap.reason}</p>;
  }
  return (
    <Suspense fallback={null}>
      <RemoteAgentTranscript appSessionId={appSessionId} agentId={agentId} actions={actions} renderRequest={renderRequest} className={className} />
    </Suspense>
  );
}

function LocalTranscriptSlot({ appSessionId, agentId, className, startAt, presentation, actions: overrides, waiting }: TranscriptSlotProps) {
  const registered = useRegisteredActions();
  const actions = useMemo(() => (overrides ? { ...registered, ...overrides } : registered), [registered, overrides]);
  const renderRequest = useRegisteredRequestRenderer(); // C7's card; the placeholder until it registers
  const source = ipcSource(appSessionId, agentId); // memoised per key
  const storeKey = storeKeyOf(source);
  useAgentLookup(storeKey, appSessionId); // L197: an agent no loaded turn launched, named from the session's task graph
  // P5 O9 M5: a session driven through its bridge keeps Restore files in place, disabled with its reason (acceptance 2)
  const controls = useSessionControls(appSessionId);
  const filesGap = controls !== null && controls.turn() !== null ? controls.capability('rewind-files') : null;
  // P5 O9 (the M8 sitting): such a session runs exactly while its port says a main turn is open, the one source custody
  // reads. Its disk rows leave turns open that nothing there ends (a turn the bridge interrupted), so while the port
  // says none runs those draw closed, as the desk draws a session its host calls idle.
  const atRest = agentId === undefined && controls?.turn()?.running === false;
  const filesReason = filesGap !== null && !filesGap.available ? filesGap.reason : null;
  const rewind = useMemo(() => (agentId === undefined ? { ...ipcRewind(appSessionId), unavailable: filesReason } : undefined), [appSessionId, agentId, filesReason]);
  // Where the session runs, from the selector: the engine's Bash input names no cwd, so a shell call shows the launch
  // folder, labelled as the session's directory. UX wave U8c-2 (§K): the launch folder and the agent's folder are handed
  // down only while the session is in its launch folder, and neither while it reads moved, so a live call never names a
  // folder its command may not have run in (a call read from rows names its own). Not for a child agent's transcript: a
  // worktree-isolated subagent's shell ran elsewhere.
  const folder = useWorkingFolder(appSessionId);
  const here = agentId === undefined && folder !== null && !folder.moved ? folder : null;
  const sessionDirectory = here?.launch ?? null;
  const sessionCwd = here?.cwd ?? null;
  useEffect(() => (agentId === undefined ? attachQueue(appSessionId) : undefined), [appSessionId, agentId]);
  const queue = useQueueStore((state) => (agentId === undefined ? (state.bySession.get(appSessionId) ?? EMPTY_QUEUE) : EMPTY_QUEUE));
  const held = useMemo(() => queue.entries.filter((entry) => entry.state === 'queued' && !entry.uncertain), [queue.entries]);
  // L276: an async ask's answer a Stop held back into the queue (its steer waited for the turn's next tool boundary) is
  // no bubble once the transcript recorded it answering the ask's capsule, as derive draws none for the steer; it stays
  // queued and sends as it is
  const askIds = useMemo(() => held.map((entry) => askSteerOf(entry.content)), [held]);
  const answered = useTranscriptStore(
    useShallow((store) => {
      const state = store.entries[storeKey]?.state;
      return askIds.map((askId) => askId !== null && state !== undefined && askAnsweredHere(state, askId));
    }),
  );
  // P5 O9 M5: a terminal session driven through its bridge draws its reply as it is written, after the rows on disk
  const streaming = useLaneAStreaming(agentId === undefined ? appSessionId : null, storeKey);
  const tail = useMemo(() => [...streaming.tail, ...(waiting === 'stacked' ? [] : held.filter((_, i) => !answered[i]).map(heldRow))], [streaming.tail, held, answered, waiting]); // UX wave U4a: a stack draws the held ones
  const withdrawn = useMemo(() => new Set<string>(queue.withdrawn), [queue.withdrawn]);
  const effort = useShownEffort(appSessionId);
  const ownerLane = useOwnerChannel(agentId === undefined ? appSessionId : null)?.lane.on ?? false; // P2-C: a session's, never a child's
  const promptAuthor = usePromptAuthor(agentId === undefined ? appSessionId : null); // board 525: another member's session names its prompts' authors
  return (
    <Transcript
      source={source}
      variant={agentId === undefined ? 'session' : 'child'}
      actions={actions}
      rewind={rewind}
      renderRequest={renderRequest}
      className={className}
      sessionDirectory={sessionDirectory}
      sessionCwd={sessionCwd}
      tail={tail}
      withdrawn={withdrawn}
      effort={agentId === undefined ? effort : null}
      startAt={startAt}
      presentation={presentation}
      ownerLane={agentId === undefined ? ownerLane : undefined}
      atRest={atRest}
      placed={streaming.kept}
      promptAuthor={promptAuthor}
      waiting={waiting}
    />
  );
}
